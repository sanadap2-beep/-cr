#!/usr/bin/env node
"use strict";

// =====================================================================
// scripts/wa-doctor.js — أداة تشخيص مستقلة لاتصال واتساب
// =====================================================================
// غرضها: تجاوب على سؤال واحد — "ليش ما يربط واتساب؟"
// لا علاقة لها بأوامر البوت، ولا تبعث أي رسالة لأي شخص.
//
// الاستخدام:
//   npm run doctor                    → فحص الاتصال بإصدار المكتبة
//   npm run doctor -- --pair 628xxx   → نفس الفحص + طلب كود ربط
//   npm run doctor -- --keep          → ما يحذف مجلد الفحص المؤقت
// =====================================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pino = require("pino");

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

const config = require("../config");

const ROOT = path.resolve(__dirname, "..");
const TMP_SESSION = path.join(ROOT, "session", "_doctor_tmp");

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const pairPhone = argValue("--pair");
const keepSession = args.includes("--keep");

// =====================================================================
// ترجمة أسباب الانفصال
// =====================================================================

const REASON_HELP = {
  401: "تسجيل الخروج — الجلسة ملغاة من الهاتف",
  403: "ممنوع — احتمال حظر مؤقت للرقم",
  405: "⚠️ إصدار العميل مرفوض — واتساب يرفض هذا البناء (المشكلة الأشيع)",
  408: "انتهت مهلة الاتصال",
  411: "تعارض تعدد الأجهزة",
  428: "أُغلق الاتصال",
  440: "اُستبدل الاتصال — الجلسة مفتوحة في مكان ثاني",
  500: "جلسة غير صالحة",
  503: "الخدمة غير متاحة مؤقتًا",
  515: "مطلوب إعادة تشغيل",
};

function describeReason(statusCode) {
  const name = DisconnectReason[statusCode];
  const known = REASON_HELP[statusCode];
  const parts = [];
  if (name) parts.push(name);
  if (known) parts.push(known);
  return parts.length ? parts.join(" — ") : String(statusCode);
}

// =====================================================================
// الخطوة 1: الإعدادات
// =====================================================================

function step(n, text) {
  console.log(`\n[${n}] ${text}`);
}
const ok = (t) => console.log(`    ✓ ${t}`);
const bad = (t) => console.log(`    ✗ ${t}`);
const warn = (t) => console.log(`    ⚠ ${t}`);
const info = (t) => console.log(`      ${t}`);

async function main() {
  console.log("════════════════════════════════════════");
  console.log("  فحص اتصال واتساب (Baileys)");
  console.log("════════════════════════════════════════");

  step(1, "فحص الإعدادات");

  const configErrors = config.validate();
  // التوكن مو مطلوب للفحص — نفحص المالك بس
  const relevant = configErrors.filter((e) => !e.includes("TELEGRAM_BOT_TOKEN"));

  if (relevant.length > 0) {
    relevant.forEach((e) => bad(e));
    console.log("\nانسخ .env.example إلى .env واملأ القيم.\n");
    process.exit(1);
  }
  ok("الإعدادات الأساسية سليمة");
  info(`Node: ${process.version}`);

  const pkg = require("../package.json");
  const baileysPkg = require("@whiskeysockets/baileys/package.json");
  info(`@whiskeysockets/baileys: ${baileysPkg.version} (مطلوب >= 6.7.22)`);

  const [major, minor] = baileysPkg.version.split(".").map(Number);
  const vulnerable =
    major < 6 ||
    (major === 6 && (minor < 7 || baileysPkg.version < "6.7.22")) ||
    (major === 7 && baileysPkg.version < "7.0.0-rc12");

  if (vulnerable) {
    warn("هذا الإصدار فيه ثغرة تزييف رسائل (GHSA-qvv5-jq5g-4cgg) — حدّث");
  } else {
    ok("الإصدار غير متأثر بالثغرة المعروفة");
  }

  // ===================================================================
  // الخطوة 2: إصدار العميل — التشخيص الأهم
  // ===================================================================

  step(2, "جلب إصدار عميل واتساب");

  let version;
  let isLatest = false;

  try {
    const fetched = await fetchLatestBaileysVersion();
    version = fetched.version;
    isLatest = fetched.isLatest === true;

    info(`الإصدار المُستخدم: ${version.join(".")}`);

    if (isLatest) {
      ok("هذا أحدث إصدار معروف");
    } else {
      warn("ما قدرت أجلب أحدث إصدار من الإنترنت");
      warn("سيُستخدم الإصدار المضمّن في المكتبة (قد يكون مرفوضًا)");
      info("⚠️ هذه هي المشكلة الأشيع لفشل الربط");
    }
  } catch (err) {
    bad(`فشل تحديد الإصدار: ${err.message}`);
    // بدون version سيستخدم Baileys الإصدار المضمّن القديم
  }

  // ===================================================================
  // الخطوة 3: محاولة الاتصال
  // ===================================================================

  step(3, "محاولة فتح اتصال (مهلة 30 ثانية)");

  fs.rmSync(TMP_SESSION, { recursive: true, force: true });
  fs.mkdirSync(TMP_SESSION, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(TMP_SESSION);

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ["Ubuntu", "Chrome", "22.04.4"],
    logger: pino({ level: "warn" }),
    printQRInTerminal: false,
    syncFullHistory: false,
    connectTimeoutMs: 30000,
  });

  sock.ev.on("creds.update", saveCreds);

  const verdict = await new Promise((resolve) => {
    const finish = (v) => {
      clearTimeout(timer);
      resolve(v);
    };

    const timer = setTimeout(() => {
      finish({
        status: "timeout",
        message: "ما صار أي رد خلال 30 ثانية — غالبًا حجب شبكي أو المنفذ مغلق",
      });
    }, 30000);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update || {};

      if (qr) {
        info("واتساب أرسل QR (لم نطلب كود ربط)");
      }

      if (connection === "open") {
        finish({ status: "open" });
        return;
      }

      if (connection === "close") {
        const statusCode =
          lastDisconnect?.error?.output?.statusCode ??
          lastDisconnect?.error?.statusCode ??
          null;

        finish({
          status: "closed",
          statusCode,
          rawError: lastDisconnect?.error?.message || null,
        });
      }
    });

    if (pairPhone) {
      const phone = String(pairPhone).replace(/[^0-9]/g, "");
      (async () => {
        try {
          await sock.waitForConnectionUpdate(
            (u) => u && u.connection === "connecting"
          );
          const code = await sock.requestPairingCode(phone);
          console.log(`\n    كود الربط للرقم ${phone}:  ${code}\n`);
        } catch (err) {
          warn(`تعذّر طلب كود الربط: ${err.message}`);
        }
      })();
    }
  });

  // ===================================================================
  // النتيجة
  // ===================================================================

  console.log("\n════════════════════════════════════════");
  console.log("  النتيجة");
  console.log("════════════════════════════════════════\n");

  if (verdict.status === "open") {
    ok("الاتصال ناجح");
    info("طبقة الاتصال والنسخة سليمة — المشكلة (إن وجدت) في مكان ثاني");
  } else if (verdict.status === "timeout") {
    bad(verdict.message);
  } else {
    bad(`اُغلق الاتصال — السبب: ${describeReason(verdict.statusCode)}`);
    if (verdict.rawError) info(`رسالة الخطأ: ${verdict.rawError}`);

    console.log("\n  ما تسويه:");
    if (verdict.statusCode === 405 || verdict.statusCode === 500) {
      info("1. حدّث المكتبة: npm i @whiskeysockets/baileys@latest");
      info("2. تأكد إن راجو يمرّر `version` إلى makeWASocket");
      info("3. امسح مجلد session/ وجرّب من جديد");
    } else if (verdict.statusCode === 401) {
      info("1. امسح مجلد session/");
      info("2. اربط الجلسة من جديد");
    } else if (verdict.statusCode === 440) {
      info("· الجلسة مفتوحة في مكان ثاني — أغلقها أو امسح session/");
    } else if (verdict.statusCode === 403) {
      info("· الرقم محظور مؤقتًا من واتساب — انتظر قبل إعادة المحاولة");
    } else {
      info("· فعّل اللوقات: LOG_LEVEL=debug ثم أعد التشغيل");
    }
  }

  console.log("");

  if (!keepSession) {
    fs.rmSync(TMP_SESSION, { recursive: true, force: true });
  }

  try {
    sock.end(undefined);
  } catch {}

  process.exit(verdict.status === "open" ? 0 : 1);
}

main().catch((err) => {
  console.error("\n✗ فشل الفحص:", err.message);
  process.exit(1);
});

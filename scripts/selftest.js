#!/usr/bin/env node
"use strict";

// =====================================================================
// scripts/selftest.js - اختبارات آلية بدون إنترنت ولا توكن
// =====================================================================
// يشغّل:
//   • اختبارات lib/store.js       (القراءة/الكتابة/الكاش/الذرّية)
//   • اختبارات lib/keyboards.js   (حدود callback_data، الترقيم)
//   • اختبارات lib/adminPanel.js  (توجيه الأزرار بمحاكاة ctx/bot)
//
// الاستخدام: node scripts/selftest.js
// ⚠️ ينسخ ملفات storage/database احتياطيًا ويعيدها كما كانت.
// =====================================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");

process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
process.env.OWNER_ID = process.env.OWNER_ID || "6707747395";

const ROOT = path.resolve(__dirname, "..");
const store = require("../lib/store");
const kb = require("../lib/keyboards");
const { registerAdminPanel, esc, fmtUptime } = require("../lib/adminPanel");
const cooldownModule = require("../controlSystem/sumemek");

// =====================================================================
// إطار اختبار بسيط
// =====================================================================

let pass = 0;
let fail = 0;
const failures = [];

function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    failures.push(`${name}: ${err.message}`);
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

function eq(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} — المتوقع ${b} لكن الناتج ${a}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || "التأكيد فشل");
}

// =====================================================================
// نسخ احتياطي للملفات التي قد تتغيّر
// =====================================================================

const FILES = [
  "./storage/access.json",
  "./storage/resellers.json",
  "./storage/blacklist.json",
  "./storage/whitelist.json",
  "./storage/cooldown1.json",
  "./database/settings.json",
];

const backup = new Map();
for (const f of FILES) {
  const fp = store.resolvePath(f);
  if (fs.existsSync(fp)) backup.set(f, fs.readFileSync(fp, "utf8"));
}

function restore() {
  for (const [f, content] of backup) {
    fs.writeFileSync(store.resolvePath(f), content, "utf8");
  }
  store.invalidateAll();
}

// =====================================================================
// 1) اختبارات lib/store.js
// =====================================================================

console.log("\n[1] lib/store.js");
{
  const tmp = "./storage/__selftest.json";
  store.writeJSON(tmp, { a: 1 });
  t("يكتب ويقرأ", () => eq(store.readJSON(tmp, {}), { a: 1 }));
  t("يرجع الافتراضي لملف مفقود", () =>
    eq(store.readJSON("./storage/__nope__.json", { x: 9 }), { x: 9 })
  );
  t("لا يكرش على ملف تالف", () => {
    fs.writeFileSync(store.resolvePath(tmp), "{ هذا ليس JSON", "utf8");
    eq(store.readJSON(tmp, { fallback: true }), { fallback: true });
  });
  t("الكاش يلتقط تعديلًا خارجيًا عبر mtime", () => {
    store.writeJSON(tmp, { a: 2 });
    eq(store.readJSON(tmp, {}), { a: 2 });
    fs.writeFileSync(store.resolvePath(tmp), JSON.stringify({ a: 3 }), "utf8");
    // نضمن اختلاف mtime ولو بالمللي ثانية
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(store.resolvePath(tmp), future, future);
    eq(store.readJSON(tmp, {}), { a: 3 });
  });
  t("المسارات تُحل من جذر المشروع", () =>
    ok(store.resolvePath("./x.json").startsWith(ROOT), "المسار ليس تحت الجذر")
  );
  try {
    fs.unlinkSync(store.resolvePath(tmp));
  } catch {}
}

// =====================================================================
// 2) اختبارات lib/keyboards.js
// =====================================================================

console.log("\n[2] lib/keyboards.js");
{
  const flat = (kbObj) => {
    const rows = kbObj.inline_keyboard || kbObj.reply_markup?.inline_keyboard || [];
    return rows.flat();
  };

  t("callback_data لكل الأزرار ≤ 64 بايت", () => {
    const keyboard = kb.listPage("a", ["6707747395", "7931956343", "8567647450"], 0);
    for (const btn of flat(keyboard)) {
      ok(
        Buffer.byteLength(btn.callback_data, "utf8") <= 64,
        `تجاوز الحد: ${btn.callback_data}`
      );
    }
  });

  t("كل الأزرار تستخدم namespace ap:", () => {
    const all = [kb.home(), kb.sessions([]), kb.usersMenu(), kb.tools()];
    for (const k of all) {
      for (const btn of flat(k)) {
        ok(btn.callback_data.startsWith("ap:"), `خارج النطاق: ${btn.callback_data}`);
      }
    }
  });

  t("الترقيم يوزّع العناصر صح", () => {
    const items = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const p0 = kb.listPage("a", items, 0);
    const p2 = kb.listPage("a", items, 2);
    const b0 = flat(p0).map((b) => b.text);
    const b2 = flat(p2).map((b) => b.text);
    ok(b0.includes("• 1") && b0.includes("• 8"), "الصفحة 0 ناقصة");
    ok(!b0.includes("• 9"), "الصفحة 0 تجاوزت الحجم");
    ok(b0.includes("1/3"), "مؤشر الصفحة غلط");
    ok(b2.includes("• 17") && b2.includes("• 20"), "الصفحة 2 ناقصة");
    ok(b2.includes("3/3"), "مؤشر الصفحة 2 غلط");
  });

  t("صفحة فارغة لا تكرش", () => {
    const k = kb.listPage("w", [], 0);
    ok(flat(k).length > 0, "لم ينتج أزرار");
  });

  t("أزرار التأكيد", () => {
    const k = kb.confirm("ap:s:cy", "ap:s");
    const texts = flat(k).map((b) => b.text);
    ok(texts.includes("✅ تأكيد") && texts.includes("❌ إلغاء"), "أزرار التأكيد ناقصة");
  });

  t("esc() يهرّب HTML", () => {
    eq(esc("<b>&"), "&lt;b&gt;&amp;");
  });

  t("fmtUptime يعمل", () => {
    eq(fmtUptime(3661), "1س 1د 1ث");
  });
}

// =====================================================================
// 3) اختبارات lib/adminPanel.js (محاكاة)
// =====================================================================

console.log("\n[3] lib/adminPanel.js");

const OWNER = process.env.OWNER_ID;

// --- محاكاة grammy -----------------------------------------------------
const handlers = { callback: [], text: [], commands: {} };
const nextCalls = [];

const fakeBot = {
  on(filter, handler) {
    if (filter === "callback_query") handlers.callback.push(handler);
    if (filter === "message:text") handlers.text.push(handler);
    return fakeBot;
  },
  command(name, handler) {
    handlers.commands[name] = handler;
    return fakeBot;
  },
};

const logs = [];
const waClients = {
  "111222333": { sock: null, status: "open", sessionPath: "/tmp/s1", lastActivity: Date.now() },
  "444555666": { sock: null, status: "closed", sessionPath: "/tmp/s2", lastActivity: 0 },
};

let clearAllCalled = 0;
let deletedSessions = [];
let shutdownCode = null;

registerAdminPanel(fakeBot, {
  log: { success: () => {}, info: (m) => logs.push(m), error: (m) => logs.push("ERR " + m), warning: () => {} },
  isOwner: (id) => String(id) === String(OWNER),
  isReseller: () => false,
  waClients,
  clearAllSessions: async () => { clearAllCalled++; return true; },
  deleteSessionForUser: async (id) => { deletedSessions.push(id); delete waClients[id]; return true; },
  initWhatsappForUser: async () => null,
  cooldownModule,
  cooldown: require("../controlSystem/cooldown"),
  store,
  getBlacklist: () => [],
  getWhitelist: () => [],
  saveBlacklist: () => true,
  saveWhitelist: () => true,
  gracefulShutdown: async (code) => { shutdownCode = code; },
  startedAt: Date.now() - 3661000,
});

const [onCallback] = handlers.callback;
const [onText] = handlers.text;

function makeCtx(data, userId = OWNER) {
  const ctx = {
    from: { id: userId },
    callbackQuery: { data },
    edits: [],
    alerts: [],
    replies: [],
    answerCallbackQuery: async (arg) => {
      if (arg && arg.show_alert) ctx.alerts.push(arg.text);
    },
    editMessageText: async (text, opts) => {
      ctx.edits.push({ text, markup: opts?.reply_markup });
    },
    editMessageReplyMarkup: async () => {},
    reply: async (text) => ctx.replies.push(text),
    message: { text: "" },
  };
  return ctx;
}

async function press(data, userId = OWNER) {
  const ctx = makeCtx(data, userId);
  nextCalls.length = 0;
  await onCallback(ctx, () => nextCalls.push("next"));
  return ctx;
}

(async () => {
  // ---- تمرير الأحداث غير الخاصة باللوحة ----
  {
    const ctx = await press("open_allmenu");
    t("أحداث البوت الأصلية تمرّر عبر next()", () => eq(nextCalls, ["next"]));
    t("لا يعدّل رسالة أحداث خارج نطاقه", () => eq(ctx.edits.length, 0));
  }

  // ---- الصلاحيات ----
  {
    const ctx = await press("ap:h", "999");
    t("غير المالك مرفوض", () => ok(ctx.alerts.length === 1, "ما صار تنبيه"));
    t("غير المالك ما يعدّل الرسالة", () => eq(ctx.edits.length, 0));
  }

  // ---- الشاشة الرئيسية ----
  {
    const ctx = await press("ap:h");
    t("الرئيسية تعرض إحصائيات", () => {
      eq(ctx.edits.length, 1);
      ok(ctx.edits[0].text.includes("لوحة التحكم"), "النص ناقص");
      ok(ctx.edits[0].text.includes("الجلسات"), "النص ناقص");
    });
    t("الرئيسية فيها أزرار الأقسام", () => {
      const texts = ctx.edits[0].markup.inline_keyboard.flat().map((b) => b.text);
      for (const label of ["📱 الجلسات", "👥 المستخدمون", "⚙️ الإعدادات", "⏱️ الكولدون"]) {
        ok(texts.includes(label), `زر ناقص: ${label}`);
      }
    });
  }

  // ---- الجلسات ----
  {
    const ctx = await press("ap:s");
    t("قائمة الجلسات تعرض الحالات", () => {
      const text = ctx.edits[0].text;
      ok(text.includes("111222333"), "معرف الجلسة ناقص");
      ok(text.includes("open"), "الحالة ناقصة");
    });

    const view = await press("ap:s:v:111222333");
    t("عرض جلسة واحدة", () => ok(view.edits[0].text.includes("111222333")));

    await press("ap:s:x:111222333");
    t("قطع الاتصال يغيّر الحالة", () => eq(waClients["111222333"].status, "closed"));

    await press("ap:s:d:444555666");
    t("حذف جلسة", () => ok(deletedSessions.includes("444555666")));

    const conf = await press("ap:s:c");
    t("حذف الكل يطلب تأكيد", () => ok(conf.edits[0].text.includes("حذف جميع الجلسات")));

    await press("ap:s:cy");
    t("تأكيد حذف الكل ينفّذ", () => eq(clearAllCalled, 1));
  }

  // ---- الإعدادات ----
  {
    const before = store.readJSON("./database/settings.json", {}).freeMode === true;
    await press("ap:e:f");
    const after = store.readJSON("./database/settings.json", {}).freeMode === true;
    t("زر الوضع الحر يبدّل القيمة فعليًا", () => ok(after !== before, "ما تبدّلت"));
    await press("ap:e:f"); // إرجاع
    t("التبديل الثاني يرجع القيمة", () =>
      eq(store.readJSON("./database/settings.json", {}).freeMode === true, before)
    );

    const mBefore = store.readJSON("./database/settings.json", {}).maintenanceMode === true;
    await press("ap:e:m");
    t("زر الصيانة يبدّل", () =>
      eq(store.readJSON("./database/settings.json", {}).maintenanceMode === true, !mBefore)
    );
    await press("ap:e:m");
  }

  // ---- الكولدون ----
  {
    const enabledBefore = cooldownModule.isCooldownEnabled();
    await press("ap:c:on");
    t("تفعيل الكولدون", () => eq(cooldownModule.isCooldownEnabled(), true));
    await press("ap:c:off");
    t("تعطيل الكولدون", () => eq(cooldownModule.isCooldownEnabled(), false));

    const st = await press("ap:c:st");
    t("شاشة حالة الكولدون", () => ok(st.edits[0].text.includes("حالة الكولدون")));

    if (enabledBefore) cooldownModule.enableCooldown();
  }

  // ---- القوائم: إضافة بحذف ----
  {
    const before = store.readJSON("./storage/access.json", { users: [] }).users.length;

    // اضغط "إضافة وصول" ثم أرسل المعرف كنص
    await press("ap:u:aadd");
    const msgCtx = {
      from: { id: OWNER },
      message: { text: "999888777" },
      replies: [],
      reply: async (x) => msgCtx.replies.push(x),
    };
    nextCalls.length = 0;
    await onText(msgCtx, () => nextCalls.push("next"));

    const after = store.readJSON("./storage/access.json", { users: [] }).users;
    t("إدخال نصي يضيف للقائمة", () => ok(after.includes("999888777"), "ما انضاف"));

    // حذف ما أضفناه
    await press("ap:u:arm:999888777");
    const final = store.readJSON("./storage/access.json", { users: [] }).users;
    t("زر الحذف يعمل", () => {
      ok(!final.includes("999888777"), "ما انحذف");
      eq(final.length, before);
    });
  }

  // ---- رسالة عادية تمرّر ----
  {
    const msgCtx = {
      from: { id: OWNER },
      message: { text: "مرحبا" },
      reply: async () => {},
    };
    nextCalls.length = 0;
    await onText(msgCtx, () => nextCalls.push("next"));
    t("الرسائل العادية تمرّر عبر next()", () => eq(nextCalls, ["next"]));
  }

  // ---- الصيانة ----
  {
    const ctx = await press("ap:t:rs");
    t("إعادة التشغيل تطلب تأكيد", () => ok(ctx.edits[0].text.includes("إعادة تشغيل")));
    await press("ap:t:rsy");
    t("تأكيد إعادة التشغيل يستدعي gracefulShutdown", () => eq(shutdownCode, 0));
  }

  // ---- أمر /panel ----
  {
    const ctx = { from: { id: OWNER }, replies: [], reply: async (t, o) => ctx.replies.push(t) };
    await handlers.commands.panel(ctx);
    t("/panel يعمل للمالك", () => eq(ctx.replies.length, 1));

    const ctx2 = { from: { id: "999" }, replies: [], reply: async (t) => ctx2.replies.push(t) };
    await handlers.commands.panel(ctx2);
    t("/panel يرفض غير المالك", () => ok(ctx2.replies[0].includes("🚫")));
  }

  // =====================================================================
  restore();

  console.log("\n════════════════════════════════════════");
  console.log(`  ناجح: ${pass}   فاشل: ${fail}`);
  console.log("════════════════════════════════════════");
  if (fail) {
    console.log("\nالإخفاقات:");
    failures.forEach((f) => console.log("  • " + f));
  }
  console.log("");
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  restore();
  console.error("\n✗ فشل الاختبار:", err);
  process.exit(1);
});

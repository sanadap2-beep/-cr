#!/usr/bin/env node
"use strict";

// =====================================================================
// scripts/selftest.js - اختبارات آلية بدون إنترنت ولا توكن
// =====================================================================
// يغطي: lib/store.js · lib/keyboards.js · lib/logBuffer.js · lib/adminPanel.js
//
// الاستخدام: node scripts/selftest.js   (أو npm test)
// ⚠️ ينسخ ملفات storage/database احتياطيًا ويعيدها كما كانت.
// =====================================================================

process.env.TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
process.env.OWNER_ID = process.env.OWNER_ID || "6707747395";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const store = require("../lib/store");
const kb = require("../lib/keyboards");
const logBuffer = require("../lib/logBuffer");
const { registerAdminPanel, esc, fmtUptime } = require("../lib/adminPanel");
const cooldownModule = require("../controlSystem/sumemek");

// =====================================================================
// إطار اختبار
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

async function ta(name, fn) {
  try {
    await fn();
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
// نسخ احتياطي
// =====================================================================

const FILES = [
  "./storage/access.json",
  "./storage/resellers.json",
  "./storage/blacklist.json",
  "./storage/whitelist.json",
  "./storage/cooldown1.json",
  "./database/settings.json",
  "./database/users.json",
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
// 1) lib/store.js
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
  t("الكاش يلتقط تعديلًا خارجيًا", () => {
    store.writeJSON(tmp, { a: 2 });
    eq(store.readJSON(tmp, {}), { a: 2 });
    fs.writeFileSync(store.resolvePath(tmp), JSON.stringify({ a: 3 }), "utf8");
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
// 2) lib/keyboards.js
// =====================================================================

console.log("\n[2] lib/keyboards.js");
{
  const flat = (k) => (k.inline_keyboard || []).flat();

  t("callback_data لكل الأزرار ≤ 64 بايت", () => {
    const all = [
      kb.home(),
      kb.sessions([{ id: "6707747395", status: "open" }]),
      kb.sessionView("6707747395"),
      kb.usersMenu(),
      kb.listPage("a", ["6707747395", "7931956343"], 0),
      kb.listPage("m", ["6707747395"], 0),
      kb.userCard("6707747395", { hasAccess: true, isReseller: false }),
      kb.settings({ freeMode: false, maintenance: false }),
      kb.advancedSettings({ antiSpam: true, autoReconnect: true, rateLimit: 30, maxSessions: 10, defaultCooldown: 20, maxRetries: 3 }),
      kb.cooldownMenu(true),
      kb.cooldownUsers([{ id: "6707747395", active: 2 }], 0),
      kb.broadcast(),
      kb.broadcastConfirm("all"),
      kb.logs(),
      kb.tools(),
    ];
    for (const k of all) {
      for (const btn of flat(k)) {
        ok(
          Buffer.byteLength(btn.callback_data, "utf8") <= 64,
          `تجاوز الحد: ${btn.callback_data}`
        );
      }
    }
  });

  t("كل الأزرار تستخدم namespace ap:", () => {
    const all = [kb.home(), kb.usersMenu(), kb.broadcast(), kb.logs(), kb.tools()];
    for (const k of all) {
      for (const btn of flat(k)) {
        ok(btn.callback_data.startsWith("ap:"), `خارج النطاق: ${btn.callback_data}`);
      }
    }
  });

  t("الترقيم يوزّع العناصر صح", () => {
    const items = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const b0 = flat(kb.listPage("a", items, 0)).map((b) => b.text);
    const b2 = flat(kb.listPage("a", items, 2)).map((b) => b.text);
    ok(b0.includes("• 1") && b0.includes("• 8"), "الصفحة 0 ناقصة");
    ok(!b0.includes("• 9"), "الصفحة 0 تجاوزت الحجم");
    ok(b0.includes("1/3"), "مؤشر الصفحة غلط");
    ok(b2.includes("• 17") && b2.includes("• 20"), "الصفحة 2 ناقصة");
    ok(b2.includes("3/3"), "مؤشر الصفحة 2 غلط");
  });

  t("قائمة المسجلين تعرضهم كأزرار قابلة للفتح", () => {
    const btns = flat(kb.listPage("m", ["111", "222"], 0));
    const open = btns.find((b) => b.callback_data === "ap:u:mv:111");
    ok(!!open, "ما فيه زر فتح بطاقة");
  });

  t("بطاقة المستخدم تعرض الإجراء المناسب", () => {
    const withAccess = flat(kb.userCard("7", { hasAccess: true, isReseller: false })).map((b) => b.callback_data);
    const noAccess = flat(kb.userCard("7", { hasAccess: false, isReseller: false })).map((b) => b.callback_data);
    ok(withAccess.includes("ap:u:mr:7"), "زر إلغاء الوصول ناقص");
    ok(noAccess.includes("ap:u:mg:7"), "زر منح الوصول ناقص");
    ok(noAccess.includes("ap:u:mp:7"), "زر الترقية ناقص");
  });

  t("صفحة فارغة لا تكرش", () => ok(flat(kb.listPage("w", [], 0)).length > 0));
  t("أزرار التأكيد", () => {
    const texts = flat(kb.confirm("ap:s:cy", "ap:s")).map((b) => b.text);
    ok(texts.includes("✅ تأكيد") && texts.includes("❌ إلغاء"));
  });
  t("esc() يهرّب HTML", () => eq(esc("<b>&"), "&lt;b&gt;&amp;"));
  t("fmtUptime", () => eq(fmtUptime(3661), "1س 1د 1ث"));
  t("short() يقصّر بدون كسر البيانات", () => {
    eq(kb.short("1234567890", 5), "12345…");
    eq(kb.short("123", 5), "123");
  });
}

// =====================================================================
// 3) lib/logBuffer.js
// =====================================================================

console.log("\n[3] lib/logBuffer.js");
{
  logBuffer.clear();
  const captured = [];
  const fake = {
    info: (m) => captured.push(m),
    error: (m) => captured.push("ERR:" + m),
  };
  const wrapped = logBuffer.wrapLogger(fake);

  wrapped.info("مرحبا");
  wrapped.error("فشل");

  t("التغليف يمرّر للكائن الأصلي", () => eq(captured, ["مرحبا", "ERR:فشل"]));
  t("التغليف يملأ الحلقة", () => eq(logBuffer.tail(10).length, 2));
  t("الأحدث أولًا", () => eq(logBuffer.tail(10)[0].msg, "فشل"));
  t("عدّ الأخطاء", () => eq(logBuffer.counts().errors, 1));
  t("الحلقة لا تتجاوز الحد", () => {
    for (let i = 0; i < logBuffer.MAX + 50; i++) wrapped.info("x" + i);
    ok(logBuffer.tail(1000).length <= logBuffer.MAX, "تجاوز الحد الأقصى");
  });
  logBuffer.clear();
  t("التفريغ", () => eq(logBuffer.tail(10).length, 0));
}

// =====================================================================
// 4) lib/adminPanel.js
// =====================================================================

console.log("\n[4] lib/adminPanel.js");

const OWNER = process.env.OWNER_ID;
const handlers = { callback: [], text: [], commands: {} };
const nextCalls = [];
const sent = [];

const fakeBot = {
  api: {
    sendMessage: async (id, text) => {
      sent.push({ id: String(id), text });
    },
  },
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
const blacklist = [];
const whitelist = [];
const waClients = {
  "111222333": { sock: null, status: "open", sessionPath: "/tmp/s1", lastActivity: Date.now() },
  "444555666": { sock: null, status: "closed", sessionPath: "/tmp/s2", lastActivity: 0 },
};

let clearAllCalled = 0;
let deletedSessions = [];
let shutdownCode = null;

registerAdminPanel(fakeBot, {
  log: {
    success: () => {},
    info: (m) => logs.push(m),
    error: (m) => logs.push("ERR " + m),
    warning: () => {},
  },
  isOwner: (id) => String(id) === String(OWNER),
  isReseller: () => false,
  hasAccess: (id) => {
    const access = store.readJSON("./storage/access.json", { users: [] }).users || [];
    return access.map(String).includes(String(id));
  },
  waClients,
  clearAllSessions: async () => {
    clearAllCalled++;
    return true;
  },
  deleteSessionForUser: async (id) => {
    deletedSessions.push(id);
    delete waClients[id];
    return true;
  },
  initWhatsappForUser: async () => null,
  cooldownModule,
  cooldown: require("../controlSystem/cooldown"),
  store,
  getBlacklist: () => blacklist,
  getWhitelist: () => whitelist,
  saveBlacklist: () => true,
  saveWhitelist: () => true,
  gracefulShutdown: async (code) => {
    shutdownCode = code;
  },
  logBuffer,
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
    editMessageText: async (text, opts) => ctx.edits.push({ text, markup: opts?.reply_markup }),
    editMessageReplyMarkup: async () => {},
    reply: async (text, opts) => ctx.replies.push({ text, markup: opts?.reply_markup }),
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

async function sendText(text, userId = OWNER) {
  const ctx = {
    from: { id: userId },
    message: { text },
    replies: [],
    reply: async (x, o) => ctx.replies.push({ text: x, markup: o?.reply_markup }),
  };
  nextCalls.length = 0;
  await onText(ctx, () => nextCalls.push("next"));
  return ctx;
}

(async () => {
  // ---- تمرير وصلاحيات ----
  {
    const ctx = await press("open_allmenu");
    t("أحداث البوت الأصلية تمرّر عبر next()", () => eq(nextCalls, ["next"]));
    t("لا يعدّل رسالة أحداث خارج نطاقه", () => eq(ctx.edits.length, 0));
    const denied = await press("ap:h", "999");
    t("غير المالك مرفوض", () => ok(denied.alerts.length === 1));
  }

  // ---- الرئيسية ----
  {
    const ctx = await press("ap:h");
    t("الرئيسية تعرض إحصائيات", () => {
      eq(ctx.edits.length, 1);
      ok(ctx.edits[0].text.includes("لوحة التحكم"));
      ok(ctx.edits[0].text.includes("الجلسات"));
    });
    t("الرئيسية فيها كل الأقسام", () => {
      const labels = ctx.edits[0].markup.inline_keyboard.flat().map((b) => b.text);
      for (const l of ["📱 الجلسات", "👥 المستخدمون", "⚙️ الإعدادات", "⏱️ الكولدون", "📢 البث", "📜 اللوقات", "🔧 الصيانة"]) {
        ok(labels.includes(l), `زر ناقص: ${l}`);
      }
    });
  }

  // ---- الجلسات ----
  {
    const ctx = await press("ap:s");
    t("قائمة الجلسات", () => ok(ctx.edits[0].text.includes("111222333")));
    await press("ap:s:x:111222333");
    t("قطع الاتصال", () => eq(waClients["111222333"].status, "closed"));
    await press("ap:s:d:444555666");
    t("حذف جلسة", () => ok(deletedSessions.includes("444555666")));
    const conf = await press("ap:s:c");
    t("حذف الكل يطلب تأكيد", () => ok(conf.edits[0].text.includes("حذف جميع الجلسات")));
    await press("ap:s:cy");
    t("تنفيذ حذف الكل", () => eq(clearAllCalled, 1));
  }

  // ---- المستخدمون: المسجلون والبطاقة ----
  {
    const list = await press("ap:u:m:0");
    t("قائمة المسجلين", () => ok(list.edits[0].text.includes("المستخدمون المسجلون")));

    const TEST_ID = "7931956343";
    const card = await press(`ap:u:mv:${TEST_ID}`);
    t("بطاقة المستخدم تفتح", () => {
      ok(card.edits[0].text.includes(TEST_ID), "المعرف ناقص");
      ok(card.edits[0].text.includes("الوصول"), "معلومات الوصول ناقصة");
    });

    // منح الوصول
    await press(`ap:u:mg:${TEST_ID}`);
    t("منح الوصول يكتب الملف", () =>
      ok(store.readJSON("./storage/access.json", { users: [] }).users.map(String).includes(TEST_ID))
    );
    const afterGrant = await press(`ap:u:mv:${TEST_ID}`);
    t("البطاقة تعكس الوصول الجديد", () => ok(afterGrant.edits[0].text.includes("نعم")));

    // إلغاء الوصول
    await press(`ap:u:mr:${TEST_ID}`);
    t("إلغاء الوصول", () =>
      ok(!store.readJSON("./storage/access.json", { users: [] }).users.map(String).includes(TEST_ID))
    );

    // ترقية / تنزيل راسيلر
    await press(`ap:u:mp:${TEST_ID}`);
    t("ترقية راسيلر", () =>
      ok(store.readJSON("./storage/resellers.json", { users: [] }).users.map(String).includes(TEST_ID))
    );
    await press(`ap:u:md:${TEST_ID}`);
    t("تنزيل راسيلر", () =>
      ok(!store.readJSON("./storage/resellers.json", { users: [] }).users.map(String).includes(TEST_ID))
    );

    // تصفير الكولدون
    cooldownModule.updateCooldown(TEST_ID, "masscrash");
    t("الكولدون مسجل قبل التصفير", () =>
      ok(Object.keys(cooldownModule.getAllUsersCooldown()[TEST_ID] || {}).length > 0)
    );
    await press(`ap:u:mc:${TEST_ID}`);
    t("تصفير كولدون المستخدم", () =>
      ok(Object.keys(cooldownModule.getAllUsersCooldown()[TEST_ID] || {}).length === 0)
    );
  }

  // ---- رسالة خاصة (إدخال نصي) ----
  {
    const TEST_ID = "7931956343";
    await press(`ap:u:mm:${TEST_ID}`);
    sent.length = 0;
    const r = await sendText("رسالة تجريبية");
    t("إرسال رسالة خاصة", () => {
      eq(sent.length, 1);
      eq(sent[0].id, TEST_ID);
      eq(sent[0].text, "رسالة تجريبية");
    });
    t("تأكيد الإرسال للمشرف", () => ok(r.replies[0].text.includes("تم الإرسال")));
  }

  // ---- القوائم بالإدخال النصي ----
  {
    const before = store.readJSON("./storage/access.json", { users: [] }).users.length;
    await press("ap:u:aadd");
    await sendText("999888777");
    t("إضافة للقائمة بالنص", () =>
      ok(store.readJSON("./storage/access.json", { users: [] }).users.includes("999888777"))
    );
    await press("ap:u:arm:999888777");
    t("حذف من القائمة", () => {
      ok(!store.readJSON("./storage/access.json", { users: [] }).users.includes("999888777"));
      eq(store.readJSON("./storage/access.json", { users: [] }).users.length, before);
    });
  }

  // ---- الإعدادات ----
  {
    const before = store.readJSON("./database/settings.json", {}).freeMode === true;
    await press("ap:e:f");
    t("تبديل الوضع الحر", () =>
      eq(store.readJSON("./database/settings.json", {}).freeMode === true, !before)
    );
    await press("ap:e:f");

    const mBefore = store.readJSON("./database/settings.json", {}).maintenanceMode === true;
    await press("ap:e:m");
    t("تبديل وضع الصيانة", () =>
      eq(store.readJSON("./database/settings.json", {}).maintenanceMode === true, !mBefore)
    );
    await press("ap:e:m");
  }

  // ---- إعدادات متقدمة ----
  {
    const adv = await press("ap:e2");
    t("شاشة الإعدادات المتقدمة", () => ok(adv.edits[0].text.includes("إعدادات متقدمة")));

    const ab = store.readJSON("./database/settings.json", {}).antiSpam !== false;
    await press("ap:e2:t:antiSpam");
    t("تبديل إعداد منطقي", () =>
      eq(store.readJSON("./database/settings.json", {}).antiSpam !== false, !ab)
    );
    await press("ap:e2:t:antiSpam");

    await press("ap:e2:s:rateLimit");
    const r = await sendText("55");
    t("تعديل إعداد رقمي", () =>
      eq(store.readJSON("./database/settings.json", {}).rateLimit, 55)
    );
    t("تأكيد التعديل للمشرف", () => ok(r.replies[0].text.includes("55")));

    const bad = await sendText2();
    t("قيمة غير رقمية مرفوضة", () => ok(bad.replies[0].text.includes("رقم")));
    async function sendText2() {
      await press("ap:e2:s:rateLimit");
      return sendText("ليس رقمًا");
    }
  }

  // ---- الكولدون ----
  {
    await press("ap:c:on");
    t("تفعيل الكولدون", () => eq(cooldownModule.isCooldownEnabled(), true));

    cooldownModule.updateCooldown("777000111", "masscrash");
    const users = await press("ap:c:u:0");
    t("قائمة مستخدمين عليهم كولدون", () => ok(users.edits[0].text.includes("777000111")));

    await press("ap:c:ur:777000111");
    t("تصفير كولدون من القائمة", () =>
      ok(Object.keys(cooldownModule.getAllUsersCooldown()["777000111"] || {}).length === 0)
    );

    await press("ap:c:off");
    t("تعطيل الكولدون", () => eq(cooldownModule.isCooldownEnabled(), false));

    const st = await press("ap:c:st");
    t("شاشة حالة الكولدون", () => ok(st.edits[0].text.includes("حالة الكولدون")));
  }

  // ---- البث ----
  {
    const menu = await press("ap:bc");
    t("قائمة البث", () => ok(menu.edits[0].text.includes("البث الجماعي")));

    await press("ap:bc:all");
    const preview = await sendText("رسالة بث تجريبية");
    t("معاينة البث قبل الإرسال", () => {
      ok(preview.replies[0].text.includes("معاينة البث"), "ما فيه معاينة");
      ok(!!preview.replies[0].markup, "ما فيه أزرار تأكيد");
    });

    sent.length = 0;
    const result = await press("ap:bc:y:all");
    t("تأكيد البث يرسل للجميع", () => {
      const members = store.readJSON("./database/users.json", []);
      eq(sent.length, members.length);
    });
    t("نتيجة البث تظهر", () => {
      const last = result.edits[result.edits.length - 1].text;
      ok(last.includes("نتيجة البث"), "ما فيه نتيجة");
      ok(last.includes("ناجح"), "ما فيه عدد الناجح");
    });

    // إلغاء
    await press("ap:bc:acc");
    await sendText("لن تُرسل");
    sent.length = 0;
    await press("ap:bc:n");
    const res2 = await press("ap:bc:y:acc");
    t("بعد الإلغاء ما يُرسل شيء", () => eq(sent.length, 0));
    t("رسالة انتهاء الصلاحية", () => ok(res2.edits[0].text.includes("انتهت")));
  }

  // ---- اللوقات ----
  {
    logBuffer.clear();
    logBuffer.push("error", "خطأ تجريبي");
    logBuffer.push("info", "معلومة تجريبية");
    const l = await press("ap:l");
    t("شاشة اللوقات تعرض الأسطر", () => {
      ok(l.edits[0].text.includes("خطأ تجريبي"), "السطر ناقص");
      ok(l.edits[0].text.includes("أخطاء"), "العدّ ناقص");
    });
    await press("ap:l:c");
    t("تفريغ اللوقات", () => eq(logBuffer.tail(10).length, 0));
  }

  // ---- الصيانة والأوامر ----
  {
    const conf = await press("ap:t:rs");
    t("إعادة التشغيل تطلب تأكيد", () => ok(conf.edits[0].text.includes("إعادة تشغيل")));
    await press("ap:t:rsy");
    t("تنفيذ إعادة التشغيل الآمن", () => eq(shutdownCode, 0));

    const ctx = { from: { id: OWNER }, replies: [], reply: async (x) => ctx.replies.push({ text: x }) };
    await handlers.commands.panel(ctx);
    t("/panel يعمل للمالك", () => eq(ctx.replies.length, 1));

    const ctx2 = { from: { id: "999" }, replies: [], reply: async (x) => ctx2.replies.push({ text: x }) };
    await handlers.commands.panel(ctx2);
    t("/panel يرفض غير المالك", () => ok(ctx2.replies[0].text.includes("🚫")));
  }

  // ---- رسالة عادية تمرّر ----
  {
    const ctx = { from: { id: OWNER }, message: { text: "مرحبا" }, reply: async () => {} };
    nextCalls.length = 0;
    await onText(ctx, () => nextCalls.push("next"));
    t("الرسائل العادية تمرّر عبر next()", () => eq(nextCalls, ["next"]));
  }

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

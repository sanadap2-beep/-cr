"use strict";

// =====================================================================
// lib/keyboards.js - مكتبة لوحات الأزرار (Inline Keyboards)
// =====================================================================
// كل الأزرار تستخدم namespace "ap:" حتى لا تتعارض مع أزرار البوت الأصلية.
//
// ⚠️ حد تليجرام: callback_data بحد أقصى 64 بايت.
//    IDs قد تطول → نقصّر المعروض ولا نقصّر البيانات.
//
// 🚫 هذه المكتبة لا تحتوي أي زر يشغّل أوامر الكراش/السبام.
// =====================================================================

const { InlineKeyboard } = require("grammy");

const NS = "ap";

function cb(...parts) {
  return [NS, ...parts].join(":");
}

/** تقصير معرّف طويل للعرض فقط */
function short(value, keep = 10) {
  const s = String(value);
  return s.length <= keep ? s : s.slice(0, keep) + "…";
}

// =====================================================================
// الشاشة الرئيسية
// =====================================================================

function home() {
  return new InlineKeyboard()
    .text("📱 الجلسات", cb("s"))
    .text("👥 المستخدمون", cb("u"))
    .row()
    .text("⚙️ الإعدادات", cb("e"))
    .text("⏱️ الكولدون", cb("c"))
    .row()
    .text("📊 الإحصائيات", cb("st"))
    .text("📢 البث", cb("bc"))
    .row()
    .text("📜 اللوقات", cb("l"))
    .text("🔧 الصيانة", cb("t"))
    .row()
    .text("🔄 تحديث", cb("h"));
}

// =====================================================================
// الجلسات
// =====================================================================

function sessions(entries) {
  const k = new InlineKeyboard();

  if (!entries || entries.length === 0) {
    k.text("— لا توجد جلسات —", cb("noop")).row();
  } else {
    for (const e of entries) {
      const icon =
        e.status === "open" ? "🟢" : e.status === "connecting" ? "🟡" : "🔴";
      k.text(`${icon} ${short(e.id, 14)}`, cb("s", "v", e.id)).row();
    }
  }

  return k
    .text("🔄 تحديث", cb("s", "r"))
    .text("🗑 حذف الكل", cb("s", "c"))
    .row()
    .text("🏠 الرئيسية", cb("h"));
}

function sessionView(id) {
  return new InlineKeyboard()
    .text("🔌 قطع", cb("s", "x", id))
    .text("♻️ إعادة وصل", cb("s", "n", id))
    .row()
    .text("🗑 حذف الجلسة", cb("s", "d", id))
    .row()
    .text("⬅️ الجلسات", cb("s"))
    .text("🏠 الرئيسية", cb("h"));
}

// =====================================================================
// المستخدمون
// =====================================================================

function usersMenu() {
  return new InlineKeyboard()
    .text("👤 المسجلون", cb("u", "m", 0))
    .text("🔑 الوصول", cb("u", "a", 0))
    .row()
    .text("💼 الراسيلرز", cb("u", "r", 0))
    .text("🚫 المحظورون", cb("u", "b", 0))
    .row()
    .text("✅ القائمة البيضاء", cb("u", "w", 0))
    .row()
    .text("🏠 الرئيسية", cb("h"));
}

const LIST_META = {
  a: { title: "قائمة الوصول", add: "➕ إضافة وصول", empty: "القائمة فارغة" },
  r: { title: "الراسيلرز", add: "➕ إضافة راسيلر", empty: "لا يوجد راسيلرز" },
  b: { title: "المحظورون", add: "➕ حظر رقم", empty: "لا يوجد محظورون" },
  w: { title: "القائمة البيضاء", add: "➕ إضافة رقم", empty: "القائمة فارغة" },
  m: { title: "المستخدمون المسجلون", add: "➕ إضافة مستخدم", empty: "لا يوجد مستخدمون" },
};

function listPage(kind, items, page, pageSize = 8) {
  const meta = LIST_META[kind] || LIST_META.a;
  const total = Math.max(1, Math.ceil(items.length / pageSize));
  const p = Math.min(Math.max(0, Number(page) || 0), total - 1);
  const slice = items.slice(p * pageSize, p * pageSize + pageSize);

  const k = new InlineKeyboard();

  if (slice.length === 0) {
    k.text(`— ${meta.empty} —`, cb("noop")).row();
  } else {
    for (const item of slice) {
      if (kind === "m") {
        // بطاقة مستخدم قابلة للفتح
        k.text(`👤 ${short(item, 14)}`, cb("u", "mv", item)).row();
      } else {
        k.text(`• ${short(item, 18)}`, cb("noop"))
          .text("🗑", cb("u", kind + "rm", item))
          .row();
      }
    }
  }

  // لا يوجد "إضافة" يدوية للمسجلين (يُضافون تلقائيًا عند أول استخدام)
  if (kind !== "m") {
    k.text(meta.add, cb("u", kind + "add")).row();
  }

  if (total > 1) {
    if (p > 0) k.text("◀️", cb("u", kind, p - 1));
    k.text(`${p + 1}/${total}`, cb("noop"));
    if (p < total - 1) k.text("▶️", cb("u", kind, p + 1));
    k.row();
  }

  return k.text("🔄", cb("u", kind, p)).text("⬅️", cb("u")).text("🏠", cb("h")).row();
}

/** بطاقة مستخدم: كل الإجراءات المتاحة عليه */
function userCard(userId, flags) {
  const k = new InlineKeyboard();

  if (flags.hasAccess) {
    k.text("🚫 إلغاء الوصول", cb("u", "mr", userId)).row();
  } else {
    k.text("✅ منح الوصول", cb("u", "mg", userId)).row();
  }

  if (flags.isReseller) {
    k.text("⬇️ تنزيل راسيلر", cb("u", "md", userId)).row();
  } else {
    k.text("⬆️ ترقية راسيلر", cb("u", "mp", userId)).row();
  }

  return k
    .text("⏱️ تصفير الكولدون", cb("u", "mc", userId))
    .text("✉️ رسالة خاصة", cb("u", "mm", userId))
    .row()
    .text("🗑 حذف من القوائم", cb("u", "mrm", userId))
    .row()
    .text("⬅️ المستخدمون", cb("u", "m", 0))
    .text("🏠 الرئيسية", cb("h"));
}

// =====================================================================
// الإعدادات
// =====================================================================

function settings(s) {
  return new InlineKeyboard()
    .text(`${s.freeMode ? "🟢" : "🔴"} الوضع الحر`, cb("e", "f"))
    .row()
    .text(`${s.maintenance ? "🟢" : "🔴"} وضع الصيانة`, cb("e", "m"))
    .row()
    .text("⚙️ إعدادات متقدمة", cb("e2"))
    .row()
    .text("🏠 الرئيسية", cb("h"));
}

const ADV_BOOL = {
  antiSpam: "الحماية من التكرار",
  autoReconnect: "إعادة الاتصال التلقائي",
};

const ADV_NUM = {
  rateLimit: "حد الطلبات/دقيقة",
  maxSessions: "أقصى عدد جلسات",
  defaultCooldown: "الكولدون الافتراضي (د)",
  maxRetries: "أقصى محاولات",
};

function advancedSettings(s) {
  const k = new InlineKeyboard();

  for (const [key, label] of Object.entries(ADV_BOOL)) {
    k.text(`${s[key] ? "🟢" : "🔴"} ${label}`, cb("e2", "t", key)).row();
  }

  for (const [key, label] of Object.entries(ADV_NUM)) {
    k.text(`${label}: ${s[key]}`, cb("e2", "s", key)).row();
  }

  return k.text("🏠 الرئيسية", cb("h"));
}

// =====================================================================
// الكولدون
// =====================================================================

function cooldownMenu(enabled) {
  return new InlineKeyboard()
    .text(
      enabled ? "🔴 تعطيل الكولدون" : "🟢 تفعيل الكولدون",
      enabled ? cb("c", "off") : cb("c", "on")
    )
    .row()
    .text("👥 المستخدمون عليه", cb("c", "u", 0))
    .text("📋 الحالة", cb("c", "st"))
    .row()
    .text("🧹 إعادة تعيين الكل", cb("c", "ra"))
    .row()
    .text("🏠 الرئيسية", cb("h"));
}

function cooldownUsers(entries, page = 0, pageSize = 8) {
  const total = Math.max(1, Math.ceil(entries.length / pageSize));
  const p = Math.min(Math.max(0, Number(page) || 0), total - 1);
  const slice = entries.slice(p * pageSize, p * pageSize + pageSize);

  const k = new InlineKeyboard();

  if (slice.length === 0) {
    k.text("— لا أحد عليه كولدون —", cb("noop")).row();
  } else {
    for (const e of slice) {
      k.text(`👤 ${short(e.id, 12)} (${e.active})`, cb("noop"))
        .text("🧹", cb("c", "ur", e.id))
        .row();
    }
  }

  if (total > 1) {
    if (p > 0) k.text("◀️", cb("c", "u", p - 1));
    k.text(`${p + 1}/${total}`, cb("noop"));
    if (p < total - 1) k.text("▶️", cb("c", "u", p + 1));
    k.row();
  }

  return k.text("🔄", cb("c", "u", p)).text("⬅️", cb("c")).text("🏠", cb("h")).row();
}

// =====================================================================
// البث
// =====================================================================

function broadcast() {
  return new InlineKeyboard()
    .text("📢 للجميع", cb("bc", "all"))
    .text("🔑 لأصحاب الوصول", cb("bc", "acc"))
    .row()
    .text("🏠 الرئيسية", cb("h"));
}

function broadcastConfirm(target) {
  return new InlineKeyboard()
    .text("✅ إرسال", cb("bc", "y", target))
    .text("❌ إلغاء", cb("bc", "n"))
    .row()
    .text("🏠 الرئيسية", cb("h"));
}

// =====================================================================
// اللوقات / الصيانة / تأكيد
// =====================================================================

function logs() {
  return new InlineKeyboard()
    .text("🔄 تحديث", cb("l", "r"))
    .text("🗑 تفريغ", cb("l", "c"))
    .row()
    .text("🏠 الرئيسية", cb("h"));
}

function tools() {
  return new InlineKeyboard()
    .text("🧹 تنظيف الكاش", cb("t", "cc"))
    .row()
    .text("♻️ إعادة التشغيل", cb("t", "rs"))
    .row()
    .text("🏠 الرئيسية", cb("h"));
}

function confirm(yesData, cancelData) {
  return new InlineKeyboard().text("✅ تأكيد", yesData).text("❌ إلغاء", cancelData);
}

function back(target = cb("h")) {
  return new InlineKeyboard().text("⬅️ رجوع", target);
}

module.exports = {
  NS,
  cb,
  short,
  home,
  sessions,
  sessionView,
  usersMenu,
  listPage,
  userCard,
  settings,
  advancedSettings,
  cooldownMenu,
  cooldownUsers,
  broadcast,
  broadcastConfirm,
  logs,
  tools,
  confirm,
  back,
  LIST_META,
  ADV_BOOL,
  ADV_NUM,
};

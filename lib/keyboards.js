"use strict";

// =====================================================================
// lib/keyboards.js - مكتبة لوحات الأزرار (Inline Keyboards)
// =====================================================================
// كل الأزرار تستخدم namespace "ap:" حتى لا تتعارض مع أزرار البوت الأصلية
// (open_allmenu / clearsender_* ...).
//
// ⚠️ حد تليجرام: callback_data بحد أقصى 64 بايت — كل المعرّفات هنا قصيرة.
//
// 🚫 هذه المكتبة لا تحتوي أي زر يشغّل أوامر الكراش/السبام.
// =====================================================================

const { InlineKeyboard } = require("grammy");

const NS = "ap";

/** بناء callback_data مُسمّى */
function cb(...parts) {
  return [NS, ...parts].join(":");
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
      k.text(`${icon} ${e.id}`, cb("s", "v", e.id)).row();
    }
  }

  return k
    .text("🔄 تحديث", cb("s", "r"))
    .text("🗑 حذف الكل", cb("s", "c"))
    .row()
    .text("⬅️ رجوع", cb("h"));
}

function sessionView(id) {
  return new InlineKeyboard()
    .text("🔌 قطع الاتصال", cb("s", "x", id))
    .text("♻️ إعادة وصل", cb("s", "n", id))
    .row()
    .text("🗑 حذف الجلسة", cb("s", "d", id))
    .row()
    .text("⬅️ رجوع", cb("s"));
}

// =====================================================================
// المستخدمون / القوائم
// =====================================================================

function usersMenu() {
  return new InlineKeyboard()
    .text("🔑 الوصول", cb("u", "a", 0))
    .text("💼 الراسيلرز", cb("u", "r", 0))
    .row()
    .text("🚫 المحظورون", cb("u", "b", 0))
    .text("✅ القائمة البيضاء", cb("u", "w", 0))
    .row()
    .text("⬅️ رجوع", cb("h"));
}

const LIST_META = {
  a: { title: "قائمة الوصول", add: "➕ إضافة وصول", empty: "القائمة فارغة" },
  r: { title: "الراسيلرز", add: "➕ إضافة راسيلر", empty: "لا يوجد راسيلرز" },
  b: { title: "المحظورون", add: "➕ حظر رقم", empty: "لا يوجد محظورون" },
  w: { title: "القائمة البيضاء", add: "➕ إضافة رقم", empty: "القائمة فارغة" },
};

/**
 * صفحة قائمة مع ترقيم.
 * @param {"a"|"r"|"b"|"w"} kind
 */
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
      // الصف = زر يعرض العنصر + زر حذف
      k.text(`• ${item}`, cb("noop")).text("🗑", cb("u", kind + "rm", item)).row();
    }
  }

  k.text(meta.add, cb("u", kind + "add")).row();

  if (total > 1) {
    if (p > 0) k.text("◀️ السابق", cb("u", kind, p - 1));
    k.text(`${p + 1}/${total}`, cb("noop"));
    if (p < total - 1) k.text("التالي ▶️", cb("u", kind, p + 1));
    k.row();
  }

  return k.text("🔄 تحديث", cb("u", kind, p)).row().text("⬅️ رجوع", cb("u"));
}

// =====================================================================
// الإعدادات / الكولدون / الصيانة
// =====================================================================

function settings(s) {
  return new InlineKeyboard()
    .text(
      `${s.freeMode ? "🟢" : "🔴"} الوضع الحر`,
      cb("e", "f")
    )
    .row()
    .text(
      `${s.maintenance ? "🟢" : "🔴"} وضع الصيانة`,
      cb("e", "m")
    )
    .row()
    .text("⬅️ رجوع", cb("h"));
}

function cooldownMenu(enabled) {
  return new InlineKeyboard()
    .text(enabled ? "🔴 تعطيل الكولدون" : "🟢 تفعيل الكولدون", enabled ? cb("c", "off") : cb("c", "on"))
    .row()
    .text("🧹 إعادة تعيين الكل", cb("c", "ra"))
    .text("📋 الحالة", cb("c", "st"))
    .row()
    .text("⬅️ رجوع", cb("h"));
}

function tools() {
  return new InlineKeyboard()
    .text("🧹 تنظيف الكاش", cb("t", "cc"))
    .row()
    .text("♻️ إعادة التشغيل", cb("t", "rs"))
    .row()
    .text("⬅️ رجوع", cb("h"));
}

// =====================================================================
// تأكيد / رجوع
// =====================================================================

function confirm(yesData, cancelData) {
  return new InlineKeyboard()
    .text("✅ تأكيد", yesData)
    .text("❌ إلغاء", cancelData);
}

function back(target = cb("h")) {
  return new InlineKeyboard().text("⬅️ رجوع", target);
}

module.exports = {
  NS,
  cb,
  home,
  sessions,
  sessionView,
  usersMenu,
  listPage,
  settings,
  cooldownMenu,
  tools,
  confirm,
  back,
  LIST_META,
};

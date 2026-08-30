"use strict";

// =====================================================================
// config.js - الإعدادات
// =====================================================================
// التغيير الجوهري: ما فيه أي سر داخل الكود.
// كل القيم الحسّاسة تُقرأ من ملف .env (غير مُرحّل في git).
//
// ⚠️ التوكن القديم كان مكشوف داخل هذا الملف ومُرحّل في تاريخ git
//    (commit b6cc94b). حذفه من هنا ما يكفي — لازم تسوي /revoke
//    من @BotFather. شوف REPORT.md.
// =====================================================================

require("dotenv").config();

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  return /^(1|true|yes|on)$/i.test(String(value).trim());
};

const toInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const config = {
  // =====================================================================
  // إعدادات مطلوبة (من .env)
  // =====================================================================

  // معرف المطور (صاحب البوت) — معرف تليجرام رقمي
  ownerId: (process.env.OWNER_ID || "").trim(),

  // توكن بوت التليجرام
  telegramBotToken: (process.env.TELEGRAM_BOT_TOKEN || "").trim(),

  // =====================================================================
  // إعدادات اختيارية
  // =====================================================================

  // اسم مجلد الجلسات
  sessionName: (process.env.SESSION_NAME || "session").trim(),

  // معرف القناة (بدون @)
  chanelid: (process.env.CHANNEL_ID || "").trim(),

  // معرف المجموعة (بدون @)
  chatgrupid: (process.env.GROUP_ID || "").trim(),

  // رابط الصورة الافتراضية
  thumburl: (process.env.THUMB_URL || "").trim(),

  // مدة الكولدون الافتراضية بالدقائق
  defaultCooldown: toInt(process.env.DEFAULT_COOLDOWN, 20),

  // الحد الأقصى لعدد المحاولات
  maxRetries: toInt(process.env.MAX_RETRIES, 3),

  // مدة انتظار إعادة الاتصال (بالملي ثانية)
  reconnectDelay: toInt(process.env.RECONNECT_DELAY, 2000),

  // وضع الصيانة
  maintenanceMode: toBool(process.env.MAINTENANCE_MODE, false),

  // الحد الأقصى لعدد الجلسات النشطة
  maxSessions: toInt(process.env.MAX_SESSIONS, 10),

  // إعادة الاتصال التلقائي
  autoReconnect: toBool(process.env.AUTO_RECONNECT, true),

  // الحماية من الهجمات
  antiSpam: toBool(process.env.ANTI_SPAM, true),

  // عدد الطلبات المسموحة في الدقيقة
  rateLimit: toInt(process.env.RATE_LIMIT, 30),

  // =====================================================================
  // إعدادات تشغيلية (جديدة)
  // =====================================================================

  // مستوى اللوق: silent | error | warn | info | debug | trace
  // ⚠️ القديم كان "silent" دائمًا — كان يخفي سبب فشل الاتصال تمامًا
  logLevel: (process.env.LOG_LEVEL || "info").trim(),

  // تعطيل جلب إصدار واتساب من الإنترنت (للبيئات بدون إنترنت)
  offlineVersionFallback: toBool(process.env.OFFLINE_VERSION_FALLBACK, true),
};

/**
 * التحقق من الإعدادات المطلوبة.
 * يُستدعى عند الإقلاع قبل إنشاء البوت — يعطي رسالة واضحة بدل كراش غامض.
 * @returns {string[]} قائمة الأخطاء (فارغة = الإعدادات سليمة)
 */
function validate() {
  const errors = [];

  if (!config.telegramBotToken) {
    errors.push(
      "TELEGRAM_BOT_TOKEN غير موجود — انسخ .env.example إلى .env وحط التوكن"
    );
  } else if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(config.telegramBotToken)) {
    errors.push(
      "TELEGRAM_BOT_TOKEN شكله مو صحيح — الصيغة: <رقم>:<35 حرف>"
    );
  }

  if (!config.ownerId) {
    errors.push("OWNER_ID غير موجود — حط معرف التليجرام الرقمي حقك في .env");
  } else if (!/^\d+$/.test(config.ownerId)) {
    errors.push("OWNER_ID لازم يكون رقم (معرف تليجرام)، مو اسم مستخدم");
  }

  if (config.maxSessions < 1) {
    errors.push("MAX_SESSIONS لازم يكون 1 أو أكثر");
  }

  if (config.rateLimit < 1) {
    errors.push("RATE_LIMIT لازم يكون 1 أو أكثر");
  }

  return errors;
}

module.exports = config;
module.exports.validate = validate;

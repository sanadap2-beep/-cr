"use strict";

// =====================================================================
// lib/logBuffer.js - حلقة تخزين للوقات في الذاكرة
// =====================================================================
// يسمح بعرض آخر الأحداث داخل لوحة التحكم بدل فتح ملفات السيرفر.
// حجم ثابت (FIFO) حتى لا ينفد الذاكرة مع الوقت.
// =====================================================================

const MAX = 200;

/** @type {{t:number, level:string, msg:string}[]} */
const buffer = [];

const LEVEL_ICON = {
  success: "✅",
  error: "❌",
  warning: "⚠️",
  info: "ℹ️",
  loading: "⏳",
  user: "👤",
  whatsapp: "📱",
  telegram: "✈️",
  system: "⚙️",
};

/** تسجيل سطر في الحلقة */
function push(level, msg) {
  buffer.push({ t: Date.now(), level, msg: String(msg) });
  if (buffer.length > MAX) buffer.shift();
}

/**
 * إرجاع آخر count سطر (الأحدث أولًا).
 * @param {number} count
 */
function tail(count = 30) {
  return buffer.slice(-count).reverse();
}

/** إحصائيات سريعة */
function counts() {
  const out = { total: buffer.length, errors: 0, warnings: 0 };
  for (const e of buffer) {
    if (e.level === "error") out.errors++;
    if (e.level === "warning") out.warnings++;
  }
  return out;
}

function clear() {
  buffer.length = 0;
}

/** تغليف كائن log الحالي ليغذّي الحلقة تلقائيًا */
function wrapLogger(logObject) {
  const wrapped = {};
  for (const level of Object.keys(logObject)) {
    const original = logObject[level];
    wrapped[level] = (msg, ...rest) => {
      push(level, msg);
      return original(msg, ...rest);
    };
  }
  return wrapped;
}

module.exports = { push, tail, counts, clear, wrapLogger, MAX, LEVEL_ICON };

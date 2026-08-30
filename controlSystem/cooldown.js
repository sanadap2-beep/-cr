"use strict";

// =====================================================================
// controlSystem/cooldown.js - نظام الكولدون لكل أمر
// =====================================================================
// إصلاحات:
//  🐛 كان الملف يُنشأ عند require عبر fs.writeFileSync على مسار نسبي
//     بدون mkdir → إذا مجلد storage ما كان موجود يكرش البوت عند الإقلاع.
//  🐛 المسارات النسبية → صارت عبر lib/store (تحل بالنسبة لجذر المشروع).
//  🐛 db[commandName] قد يكون null بعد تلف الملف → صار فيه تحقق.
//  📝 تنبيه مهم: هذا النظام "مو موصول" — /setcd يستدعي setCooldown بس
//     ما فيه أي مكان يستدعي checkCooldown. يعني الأمر يظهر رسالة نجاح
//     بس ما له أي أثر فعلي. مشروح في REPORT.md.
// =====================================================================

const store = require("../lib/store");

const CD_FILE = "./storage/cooldown.json";

// =====================================================================
// دوال الكولدون
// =====================================================================

function setCooldown(commandName, minutes) {
  const minutesNum = parseInt(minutes, 10);

  if (!Number.isFinite(minutesNum) || minutesNum < 1) {
    return { success: false, message: "❌ المدة لازم تكون رقمًا أكبر من صفر" };
  }

  const db = store.readJSON(CD_FILE, {});
  const entry = db[commandName] || {};

  db[commandName] = {
    duration: minutesNum,
    lastUsed: entry.lastUsed || 0,
  };

  store.writeJSON(CD_FILE, db);

  return {
    success: true,
    message: `⏳ تم ضبط الكولدون: /${commandName} → ${minutesNum} دقيقة`,
  };
}

function checkCooldown(commandName) {
  const db = store.readJSON(CD_FILE, {});
  const entry = db[commandName];

  if (!entry || !entry.duration) return { expired: true };

  const now = Date.now();
  const lastUsed = entry.lastUsed || 0;
  const durationMs = entry.duration * 60 * 1000;

  if (now - lastUsed >= durationMs) {
    return { expired: true };
  }

  return {
    expired: false,
    // دقّنا الدقة: القديم كان يقرب لأعلى (Math.ceil) فيطلع "1 دقيقة"
    // حتى لو باقي ثانية واحدة
    remainingMs: durationMs - (now - lastUsed),
    remaining: Math.max(1, Math.ceil((durationMs - (now - lastUsed)) / 60000)),
  };
}

function updateLastUsed(commandName) {
  const db = store.readJSON(CD_FILE, {});

  if (!db[commandName]) return false;

  db[commandName].lastUsed = Date.now();
  return store.writeJSON(CD_FILE, db);
}

function removeCooldown(commandName) {
  const db = store.readJSON(CD_FILE, {});

  if (!db[commandName]) return false;

  delete db[commandName];
  return store.writeJSON(CD_FILE, db);
}

function getCooldownList() {
  return Object.keys(store.readJSON(CD_FILE, {}));
}

function getCooldownInfo(commandName) {
  const db = store.readJSON(CD_FILE, {});
  const entry = db[commandName];

  if (!entry) return null;

  return {
    duration: entry.duration,
    lastUsed: entry.lastUsed || 0,
    lastUsedFormatted: entry.lastUsed
      ? new Date(entry.lastUsed).toLocaleString("ar")
      : "أبدًا",
  };
}

// =====================================================================
// التصدير
// =====================================================================

module.exports = {
  setCooldown,
  checkCooldown,
  updateLastUsed,
  removeCooldown,
  getCooldownList,
  getCooldownInfo,
};

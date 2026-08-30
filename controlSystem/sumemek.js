"use strict";

// =====================================================================
// controlSystem/sumemek.js - نظام الكولدون المتقدم (لكل مستخدم + أمر)
// =====================================================================
// إصلاحات:
//  🐛 COOLDOWN_DURATION كان معرّف (20 دقيقة) بس ما يُستخدم — الكود
//     يكتب الرقم 20 يدويًا في كل مكان. صار المتغير هو المصدر الوحيد.
//  🐛 checkCooldown تحسب الوقت بالدقائق الصحيحة (Math.floor) →
//     المستخدم يستنى 19:59 ويخلص كولدونه، أو يطلع له "باقي 1 دقيقة"
//     وهو باقيله ثانية. صارت الحسبة بالملي ثانية.
//  🐛 checkCooldown ترجع remaining: 0 و onCooldown: false لما النظام
//     معطّل — نفس القيمة لما ما فيه كولدون. صار فيه حقل enabled.
//  🐛 resetUserCommandCooldown يترك كائن المستخدم فاضي في الملف
//     (تضخم مستمر للملف). صار ينظّف.
//  🐛 getAllUsersCooldown/getCooldownStats ما كانا يتحققان من الشكل.
//  🐛 initCooldownFile ما كانت تُستدعى أبدًا. صار الملف يُنشأ تلقائيًا.
// =====================================================================

const store = require("../lib/store");

const COOLDOWN_FILE = "./storage/cooldown1.json";
const COOLDOWN_DURATION = 20 * 60 * 1000; // 20 دقيقة

const COOLDOWN_COMMANDS = [
  "Xzesoandro",
  "Delayxzeso",
  "Xzesoiosx",
  "Uixzeso",
  "Droidx",
  "Betaxzeso",
  "Betaxzosex",
  "invisisendx",
  "Xzesox",
  "masscrash",
  "spamcall",
  "floodmsg",
  "crashgroup",
  "crashstatus",
  "crashchannel",
];

// =====================================================================
// القراءة/الكتابة مع ضبط الشكل
// =====================================================================

function normalize(data) {
  return {
    enabled: data && data.enabled === true,
    users: data && typeof data.users === "object" && data.users !== null ? data.users : {},
  };
}

function readCooldownData() {
  return normalize(store.readJSON(COOLDOWN_FILE, { enabled: false, users: {} }));
}

function writeCooldownData(data) {
  return store.writeJSON(COOLDOWN_FILE, normalize(data));
}

// =====================================================================
// دوال التحكم في الكولدون
// =====================================================================

function isCooldownEnabled() {
  return readCooldownData().enabled;
}

function enableCooldown() {
  const data = readCooldownData();
  data.enabled = true;
  return writeCooldownData(data);
}

function disableCooldown() {
  const data = readCooldownData();
  data.enabled = false;
  return writeCooldownData(data);
}

// =====================================================================
// دوال التحقق من الكولدون
// =====================================================================

function checkCooldown(userId, command) {
  const data = readCooldownData();

  if (!data.enabled) {
    return { onCooldown: false, enabled: false, remaining: 0, remainingMs: 0, totalWait: COOLDOWN_DURATION / 60000 };
  }

  const userCooldowns = data.users[String(userId)] || {};
  const lastUsedTime = userCooldowns[command];

  if (!lastUsedTime) {
    return { onCooldown: false, enabled: true, remaining: 0, remainingMs: 0, totalWait: COOLDOWN_DURATION / 60000 };
  }

  const remainingMs = Math.max(0, COOLDOWN_DURATION - (Date.now() - lastUsedTime));

  return {
    onCooldown: remainingMs > 0,
    enabled: true,
    remainingMs,
    // نقرّب لأعلى عشان "باقي دقيقة" ما تطلع 0
    remaining: Math.ceil(remainingMs / 60000),
    totalWait: COOLDOWN_DURATION / 60000,
  };
}

// =====================================================================
// دوال تحديث الكولدون
// =====================================================================

function updateCooldown(userId, command) {
  const data = readCooldownData();
  const uid = String(userId);

  if (!data.users[uid]) data.users[uid] = {};

  data.users[uid][command] = Date.now();
  return writeCooldownData(data);
}

// =====================================================================
// دوال إعادة تعيين الكولدون
// =====================================================================

function resetUserCommandCooldown(userId, command) {
  const data = readCooldownData();
  const uid = String(userId);

  if (!data.users[uid] || !data.users[uid][command]) return false;

  delete data.users[uid][command];

  // تنظيف: لو المستخدم ما بقى له أوامر، احذف كائنه بالكامل
  if (Object.keys(data.users[uid]).length === 0) {
    delete data.users[uid];
  }

  return writeCooldownData(data);
}

function resetUserAllCooldowns(userId) {
  const data = readCooldownData();
  const uid = String(userId);

  if (!data.users[uid]) return false;

  delete data.users[uid];
  return writeCooldownData(data);
}

function resetAllCooldowns() {
  const data = readCooldownData();
  return writeCooldownData({ enabled: data.enabled, users: {} });
}

// =====================================================================
// دوال الحصول على معلومات الكولدون
// =====================================================================

function getUserCooldownStatus(userId) {
  const data = readCooldownData();
  const userCooldowns = data.users[String(userId)] || {};
  const status = {};

  for (const cmd of COOLDOWN_COMMANDS) {
    const info = checkCooldown(userId, cmd);
    status[cmd] = {
      onCooldown: info.onCooldown,
      remaining: info.remaining,
      remainingMs: info.remainingMs,
      lastUsed: userCooldowns[cmd]
        ? new Date(userCooldowns[cmd]).toLocaleString("ar")
        : "أبدًا",
    };
  }

  return status;
}

function getAllUsersCooldown() {
  return readCooldownData().users;
}

function getCooldownStats() {
  const data = readCooldownData();
  const users = Object.keys(data.users);
  let totalCommands = 0;
  let activeCooldowns = 0;

  for (const uid of users) {
    const cmds = data.users[uid] || {};
    for (const cmd of Object.keys(cmds)) {
      totalCommands += 1;
      if (Date.now() - cmds[cmd] < COOLDOWN_DURATION) activeCooldowns += 1;
    }
  }

  return {
    enabled: data.enabled,
    totalUsers: users.length,
    totalCommands,
    // القديم كان يرجع نفس رقم totalCommands — أي الكل "نشط" دائمًا
    activeCooldowns,
  };
}

/** حذف الإدخالات المنتهية — يمنع تضخم الملف مع الوقت */
function pruneExpired() {
  const data = readCooldownData();
  const now = Date.now();
  let changed = false;

  for (const uid of Object.keys(data.users)) {
    const cmds = data.users[uid] || {};
    for (const cmd of Object.keys(cmds)) {
      if (now - cmds[cmd] >= COOLDOWN_DURATION) {
        delete cmds[cmd];
        changed = true;
      }
    }
    if (Object.keys(cmds).length === 0) {
      delete data.users[uid];
      changed = true;
    }
  }

  if (changed) writeCooldownData(data);
  return changed;
}

// =====================================================================
// التصدير
// =====================================================================

module.exports = {
  checkCooldown,
  updateCooldown,
  resetUserCommandCooldown,
  resetUserAllCooldowns,
  resetAllCooldowns,
  isCooldownEnabled,
  enableCooldown,
  disableCooldown,
  getUserCooldownStatus,
  getAllUsersCooldown,
  getCooldownStats,
  pruneExpired,
  COOLDOWN_COMMANDS,
  COOLDOWN_DURATION,
};

"use strict";

// =====================================================================
// controlSystem/control.js - نظام التحكم في الصلاحيات
// =====================================================================
// إصلاحات:
//  🐛 كان يستخدم path.dirname بدون require("path") → ReferenceError
//     مع أي عملية كتابة (addAccess/addReseller/blockNumber...).
//  🐛 المسارات النسبية تعتمد على cwd → صارت عبر lib/store.
//  🐛 safeWriteJSON بدون mkdir للملفات الموجودة في مجلدات متداخلة.
//  🐛 hasAccess يقرأ settings.json من القرص مع كل رسالة → صار مخبّأ.
//  🐛 accessDb.users ممكن تكون undefined لو الملف تالف → صار فيه
//     تحقق Array.isArray في كل الدوال، مو بس في hasAccess.
//  📝 ملاحظة: هذا الملف غير مستورد من raju.js حاليًا (الكود مكرر هناك).
//     إمّا وصّله أو احذفه — مشروح في REPORT.md.
// =====================================================================

const config = require("../config");
const store = require("../lib/store");

const FILE_ACCESS = "./storage/access.json";
const FILE_RESELLERS = "./storage/resellers.json";
const FILE_SETTINGS = "./database/settings.json";
const FILE_BLACKLIST = "./storage/blacklist.json";
const FILE_WHITELIST = "./storage/whitelist.json";

const arr = (value) => (Array.isArray(value) ? value : []);

// =====================================================================
// دوال التحقق من الصلاحيات
// =====================================================================

function isOwner(userId) {
  return String(userId) === String(config.ownerId);
}

function isReseller(userId) {
  const db = store.readJSON(FILE_RESELLERS, { users: [] });
  return arr(db.users).includes(String(userId));
}

function isFreeMode() {
  const settings = store.readJSON(FILE_SETTINGS, { freeMode: false });
  return settings.freeMode === true;
}

function hasAccess(userId) {
  if (isFreeMode()) return true;
  if (isOwner(userId)) return true;
  if (isReseller(userId)) return true;

  const accessDb = store.readJSON(FILE_ACCESS, { users: [] });
  return arr(accessDb.users).includes(String(userId));
}

// =====================================================================
// دوال إدارة الراسيلرز
// =====================================================================

function addReseller(targetId) {
  const id = String(targetId);
  const db = store.readJSON(FILE_RESELLERS, { users: [] });
  const users = arr(db.users);

  if (users.includes(id)) return false;

  users.push(id);
  return store.writeJSON(FILE_RESELLERS, { ...db, users });
}

function removeReseller(targetId) {
  const id = String(targetId);
  const db = store.readJSON(FILE_RESELLERS, { users: [] });
  const users = arr(db.users).filter((x) => String(x) !== id);

  if (users.length === arr(db.users).length) return false;

  return store.writeJSON(FILE_RESELLERS, { ...db, users });
}

function getResellers() {
  return arr(store.readJSON(FILE_RESELLERS, { users: [] }).users);
}

// =====================================================================
// دوال إدارة الوصول
// =====================================================================

function addAccess(userId) {
  const id = String(userId);
  const access = store.readJSON(FILE_ACCESS, { users: [] });
  const users = arr(access.users);

  if (users.includes(id)) return false;

  users.push(id);
  return store.writeJSON(FILE_ACCESS, { ...access, users });
}

function removeAccess(userId) {
  const id = String(userId);
  const access = store.readJSON(FILE_ACCESS, { users: [] });
  const users = arr(access.users).filter((x) => String(x) !== id);

  if (users.length === arr(access.users).length) return false;

  return store.writeJSON(FILE_ACCESS, { ...access, users });
}

function getAccessList() {
  return arr(store.readJSON(FILE_ACCESS, { users: [] }).users);
}

// =====================================================================
// دوال الحظر والقوائم البيضاء
// =====================================================================

function getBlacklist() {
  return arr(store.readJSON(FILE_BLACKLIST, []));
}

function getWhitelist() {
  return arr(store.readJSON(FILE_WHITELIST, []));
}

function isBlocked(number) {
  return getBlacklist().map(String).includes(String(number));
}

function isWhitelisted(number) {
  return getWhitelist().map(String).includes(String(number));
}

function blockNumber(number) {
  const value = String(number);
  const list = getBlacklist();

  if (list.map(String).includes(value)) return false;

  list.push(value);
  return store.writeJSON(FILE_BLACKLIST, list);
}

function unblockNumber(number) {
  const value = String(number);
  const list = getBlacklist();
  const filtered = list.filter((n) => String(n) !== value);

  if (filtered.length === list.length) return false;

  return store.writeJSON(FILE_BLACKLIST, filtered);
}

function addWhitelist(number) {
  const value = String(number);
  const list = getWhitelist();

  if (list.map(String).includes(value)) return false;

  list.push(value);
  return store.writeJSON(FILE_WHITELIST, list);
}

function removeWhitelist(number) {
  const value = String(number);
  const list = getWhitelist();
  const filtered = list.filter((n) => String(n) !== value);

  if (filtered.length === list.length) return false;

  return store.writeJSON(FILE_WHITELIST, filtered);
}

// =====================================================================
// دوال الإحصائيات
// =====================================================================

function getStats() {
  return {
    ownerId: config.ownerId,
    freeMode: isFreeMode(),
    resellers: getResellers().length,
    accessUsers: getAccessList().length,
    blacklist: getBlacklist().length,
    whitelist: getWhitelist().length,
  };
}

// =====================================================================
// التصدير
// =====================================================================

module.exports = {
  // الصلاحيات
  isOwner,
  isReseller,
  isFreeMode,
  hasAccess,

  // الراسيلرز
  addReseller,
  removeReseller,
  getResellers,

  // الوصول
  addAccess,
  removeAccess,
  getAccessList,

  // الحظر والقوائم
  isBlocked,
  isWhitelisted,
  blockNumber,
  unblockNumber,
  getBlacklist,
  getWhitelist,
  addWhitelist,
  removeWhitelist,

  // إحصائيات
  getStats,
};

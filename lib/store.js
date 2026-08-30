"use strict";

// =====================================================================
// lib/store.js - طبقة تخزين JSON موحّدة
// =====================================================================
// المشاكل اللي تعالجها:
//  1) المسارات النسبية ("./storage/x.json") كانت تعتمد على مجلد التشغيل cwd،
//     فأي تشغيل من مجلد ثاني يخلق ملفات في مكان غلط. الحين كل المسارات
//     تُحل بالنسبة لجذر المشروع.
//  2) الكتابة كانت fs.writeFileSync مباشرة → لو انقطعت الكهربا في نص
//     الكتابة يصير الملف JSON مكسور. الحين كتابة ذرّية (tmp + rename).
//  3) القراءة كانت تتم من القرص مع كل طلب (hasAccess تستدعي settings.json
//     مع كل رسالة). الحين فيه كاش مع تحقق من mtime_file فالتعديلات
//     اليدوية على الملف تنعكس فورًا.
// =====================================================================

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/** @type {Map<string, {info:{mtimeMs:number,size:number}, data:any}>} */
const cache = new Map();

function resolvePath(file) {
  return path.isAbsolute(file) ? file : path.join(ROOT, file);
}

/**
 * بصمة خفيفة للملف: mtime + الحجم.
 *
 * ⚠️ ليش الحجم مع mtime؟
 * دقّة mtime قد تكون بالملي ثانية، فلو عُدّل الملف خارجيًا خلال نفس
 * الملي ثانية اللي قرأنا فيها، ما تتغيّر القيمة ويُقدَّم كاش قديم.
 * إضافة الحجم تقلّل احتمال التصادم بشكل كبير، وبتكلفة stat واحدة.
 */
function statInfo(fp) {
  try {
    const st = fs.statSync(fp);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

function sameInfo(a, b) {
  return !!a && !!b && a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/**
 * قراءة ملف JSON مع قيمة افتراضية آمنة.
 * لا ترمي استثناء أبدًا — ترجع القيمة الافتراضية وتسجّل الخطأ.
 */
function readJSON(file, fallback) {
  const fp = resolvePath(file);
  const info = statInfo(fp);

  if (info === null) {
    cache.delete(fp);
    return fallback;
  }

  const hit = cache.get(fp);
  if (hit && sameInfo(hit.info, info)) {
    return hit.data;
  }

  let data = fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    data = parsed === null || parsed === undefined ? fallback : parsed;
  } catch (err) {
    console.error(
      `[store] ${file} تالف أو غير قابل للتحليل (${err.message}) — استخدام القيمة الافتراضية`
    );
    data = fallback;
  }

  cache.set(fp, { info, data });
  return data;
}

/**
 * كتابة ذرّية: تُكتب في ملف مؤقت ثم rename (عملية ذرّية على نفس الـ FS).
 */
function writeJSON(file, data) {
  const fp = resolvePath(file);
  fs.mkdirSync(path.dirname(fp), { recursive: true });

  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, fp);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    console.error(`[store] فشل كتابة ${file}: ${err.message}`);
    return false;
  }

  cache.set(fp, { info: statInfo(fp), data });
  return true;
}

/** إنشاء الملف بالقيمة الافتراضية إذا ما كان موجودًا */
function ensureJSON(file, fallback) {
  const fp = resolvePath(file);
  if (statInfo(fp) === null) {
    writeJSON(file, fallback);
  }
  return readJSON(file, fallback);
}

function invalidate(file) {
  cache.delete(resolvePath(file));
}

function invalidateAll() {
  cache.clear();
}

module.exports = {
  ROOT,
  resolvePath,
  readJSON,
  writeJSON,
  ensureJSON,
  invalidate,
  invalidateAll,
};

"use strict";

// =====================================================================
// lib/adminPanel.js - لوحة تحكم تفاعلية بالأزرار
// =====================================================================
// الأقسام (كلها إدارية/تنظيمية):
//   🏠 الرئيسية       — نظرة عامة
//   📱 الجلسات        — عرض، قطع، إعادة وصل، حذف
//   👥 المستخدمون     — المسجلون (بطاقة لكل مستخدم)، الوصول، الراسيلرز،
//                       المحظورون، القائمة البيضاء
//   ⚙️ الإعدادات      — الوضع الحر، الصيانة، + إعدادات متقدمة
//   ⏱️ الكولدون       — تفعيل/تعطيل، مستخدمون عليه، إعادة تعيين
//   📢 البث           — رسالة جماعية مع معاينة وتأكيد
//   📜 اللوقات        — آخر الأحداث داخل تليجرام
//   📊 الإحصائيات / 🔧 الصيانة
//
// 🚫 لا يحتوي أي زر يشغّل أوامر الكراش/السبام/الإغراق.
//
// معماريًا: المعالج يتعرف على بياناته بالبادئة "ap:"، وأي حدث آخر
// يمرّره عبر next() إلى معالج الأزرار الأصلي.
// =====================================================================

const fs = require("fs");
const path = require("path");
const kb = require("./keyboards");

const PENDING_TTL = 5 * 60 * 1000;
const PAGE_SIZE = 8;

/** إجراءات بانتظار إدخال نصي: userId -> {action, at} */
const pending = new Map();
/** مسودة بث بانتظار التأكيد: userId -> {target, text} */
const broadcastDrafts = new Map();

// =====================================================================
// أدوات
// =====================================================================

function esc(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}س ${m}د ${s}ث`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeEdit(ctx, text, keyboard) {
  try {
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: "HTML" });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("message is not modified")) {
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
      } catch {}
      return;
    }
    throw err;
  }
}

// =====================================================================
// التسجيل
// =====================================================================

function registerAdminPanel(bot, deps) {
  const {
    log,
    isOwner,
    isReseller,
    hasAccess,
    waClients,
    clearAllSessions,
    deleteSessionForUser,
    initWhatsappForUser,
    cooldownModule,
    cooldown,
    store,
    getBlacklist,
    getWhitelist,
    saveBlacklist,
    saveWhitelist,
    gracefulShutdown,
    logBuffer,
    startedAt,
  } = deps;

  // ===================================================================
  // قراءة/كتابة القوائم
  // ===================================================================

  function readList(kind) {
    if (kind === "a") return store.readJSON("./storage/access.json", { users: [] }).users || [];
    if (kind === "r") return store.readJSON("./storage/resellers.json", { users: [] }).users || [];
    if (kind === "b") return getBlacklist() || [];
    if (kind === "w") return getWhitelist() || [];
    if (kind === "m") return store.readJSON("./database/users.json", []) || [];
    return [];
  }

  function writeList(kind, items) {
    if (kind === "a") return store.writeJSON("./storage/access.json", { users: items });
    if (kind === "r") return store.writeJSON("./storage/resellers.json", { users: items });
    if (kind === "m") return store.writeJSON("./database/users.json", items);
    if (kind === "b") {
      const list = getBlacklist();
      list.length = 0;
      items.forEach((i) => list.push(i));
      return saveBlacklist();
    }
    if (kind === "w") {
      const list = getWhitelist();
      list.length = 0;
      items.forEach((i) => list.push(i));
      return saveWhitelist();
    }
    return false;
  }

  // ===================================================================
  // الإحصائيات
  // ===================================================================

  function collectStats() {
    const entries = Object.entries(waClients || {});
    const settings = store.readJSON("./database/settings.json", {});
    const access = store.readJSON("./storage/access.json", { users: [] });
    const resellers = store.readJSON("./storage/resellers.json", { users: [] });
    const users = store.readJSON("./database/users.json", []);
    const cd = cooldownModule.getCooldownStats();

    return {
      sessions: entries.length,
      open: entries.filter(([, v]) => v && v.status === "open").length,
      connecting: entries.filter(([, v]) => v && v.status === "connecting").length,
      access: (access.users || []).length,
      resellers: (resellers.users || []).length,
      blacklist: (getBlacklist() || []).length,
      whitelist: (getWhitelist() || []).length,
      users: (users || []).length,
      freeMode: settings.freeMode === true,
      maintenance: settings.maintenanceMode === true,
      antiSpam: settings.antiSpam !== false,
      autoReconnect: settings.autoReconnect !== false,
      rateLimit: settings.rateLimit ?? 30,
      maxSessions: settings.maxSessions ?? 10,
      defaultCooldown: settings.defaultCooldown ?? 20,
      maxRetries: settings.maxRetries ?? 3,
      cooldownEnabled: !!cd.enabled,
      cooldownUsers: cd.totalUsers,
      cooldownActive: cd.activeCooldowns,
      uptime: fmtUptime(Math.floor((Date.now() - startedAt) / 1000)),
      mem: (process.memoryUsage().heapUsed / 1048576).toFixed(1),
      node: process.version,
    };
  }

  function homeText() {
    const s = collectStats();
    const lc = logBuffer ? logBuffer.counts() : { errors: 0, warnings: 0 };
    return (
      "<b>🎛 لوحة التحكم</b>\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `📱 الجلسات: <code>${s.open}</code> متصلة / <code>${s.sessions}</code> الكل\n` +
      `👥 المستخدمون: <code>${s.users}</code>\n` +
      `🔑 الوصول: <code>${s.access}</code>   💼 الراسيلرز: <code>${s.resellers}</code>\n` +
      `🚫 محظور: <code>${s.blacklist}</code>   ✅ بيضاء: <code>${s.whitelist}</code>\n` +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `⚙️ الوضع الحر: <code>${s.freeMode ? "مفعّل" : "معطّل"}</code>\n` +
      `⏱️ الكولدون: <code>${s.cooldownEnabled ? "مفعّل" : "معطّل"}</code>\n` +
      `❌ أخطاء مسجلة: <code>${lc.errors}</code>\n` +
      `⏰ التشغيل: <code>${s.uptime}</code>   💾 <code>${s.mem} MB</code>`
    );
  }

  function statsText() {
    const s = collectStats();
    return (
      "<b>📊 إحصائيات تفصيلية</b>\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `📱 جلسات كلية: <code>${s.sessions}</code>\n` +
      `🟢 متصلة: <code>${s.open}</code>   🟡 قيد الاتصال: <code>${s.connecting}</code>\n` +
      `🔴 مغلقة: <code>${Math.max(0, s.sessions - s.open - s.connecting)}</code>\n` +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `👥 مسجلون: <code>${s.users}</code>\n` +
      `🔑 وصول: <code>${s.access}</code>   💼 راسيلرز: <code>${s.resellers}</code>\n` +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `⏱️ الكولدون: <code>${s.cooldownEnabled ? "مفعّل" : "معطّل"}</code>\n` +
      `👤 مستخدمون عليه: <code>${s.cooldownUsers}</code>\n` +
      `🔥 كولدونات نشطة: <code>${s.cooldownActive}</code>\n` +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `🖥 Node: <code>${esc(s.node)}</code>\n` +
      `💾 الذاكرة: <code>${s.mem} MB</code>\n` +
      `⏰ التشغيل: <code>${s.uptime}</code>`
    );
  }

  // ===================================================================
  // العرض
  // ===================================================================

  const renderHome = (ctx) => safeEdit(ctx, homeText(), kb.home());
  const renderStats = (ctx) => safeEdit(ctx, statsText(), kb.back());

  async function renderSessions(ctx) {
    const entries = Object.entries(waClients || {}).map(([id, v]) => ({
      id,
      status: v?.status || "unknown",
    }));

    const text =
      "<b>📱 إدارة الجلسات</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
      (entries.length === 0
        ? "لا توجد جلسات حاليًا."
        : entries
            .map((e) => {
              const icon =
                e.status === "open" ? "🟢" : e.status === "connecting" ? "🟡" : "🔴";
              return `${icon} <code>${esc(e.id)}</code> — ${esc(e.status)}`;
            })
            .join("\n")) +
      "\n\nاضغط على جلسة لإدارتها.";

    await safeEdit(ctx, text, kb.sessions(entries));
  }

  async function renderSessionView(ctx, id) {
    const entry = waClients?.[id];
    if (!entry) {
      await safeEdit(ctx, "❌ هذه الجلسة لم تعد موجودة.", kb.sessions([]));
      return;
    }
    const text =
      `<b>📱 جلسة <code>${esc(id)}</code></b>\n━━━━━━━━━━━━━━━━━━━━\n` +
      `الحالة: <code>${esc(entry.status)}</code>\n` +
      `المسار: <code>${esc(entry.sessionPath || "-")}</code>\n` +
      `آخر نشاط: <code>${
        entry.lastActivity ? new Date(entry.lastActivity).toLocaleString("ar") : "-"
      }</code>`;
    await safeEdit(ctx, text, kb.sessionView(id));
  }

  // -----------------------------------------------------------------
  // بطاقة مستخدم
  // -----------------------------------------------------------------

  function userFlags(id, page = 0) {
    const access = readList("a").map(String);
    const resellers = readList("r").map(String);
    const cdStatus = cooldownModule.getUserCooldownStatus(id);
    const active = Object.values(cdStatus || {}).filter((x) => x && x.onCooldown).length;

    return {
      id,
      page,
      isOwner: isOwner(id),
      isReseller: resellers.includes(String(id)),
      hasAccess: hasAccess ? hasAccess(id) : access.includes(String(id)),
      sessions: waClients?.[id] ? (waClients[id].status === "open" ? 1 : 0) : 0,
      cooldownActive: active,
    };
  }

  function userCardText(f) {
    return (
      `<b>👤 مستخدم <code>${esc(f.id)}</code></b>\n━━━━━━━━━━━━━━━━━━━━\n` +
      `👑 المالك: <code>${f.isOwner ? "نعم" : "لا"}</code>\n` +
      `💼 راسيلر: <code>${f.isReseller ? "نعم" : "لا"}</code>\n` +
      `🔑 الوصول: <code>${f.hasAccess ? "نعم" : "لا"}</code>\n` +
      `📱 جلسة نشطة: <code>${f.sessions ? "نعم" : "لا"}</code>\n` +
      `⏱️ كولدونات نشطة: <code>${f.cooldownActive}</code>`
    );
  }

  // ===================================================================
  // التوجيه الرئيسي
  // ===================================================================

  async function route(ctx, parts) {
    const [, sec, a, b] = parts;

    switch (sec) {
      case "h":
        return renderHome(ctx);
      case "noop":
        return;
      case "st":
        return renderStats(ctx);
      case "s":
        return routeSessions(ctx, a, b);
      case "u":
        return routeUsers(ctx, a, b);
      case "e":
        return routeSettings(ctx, a);
      case "e2":
        return routeAdvanced(ctx, a, b);
      case "c":
        return routeCooldown(ctx, a, b);
      case "bc":
        return routeBroadcast(ctx, a, b);
      case "l":
        return routeLogs(ctx, a);
      case "t":
        return routeTools(ctx, a);
      default:
        return;
    }
  }

  // -----------------------------------------------------------------
  // الجلسات
  // -----------------------------------------------------------------

  async function routeSessions(ctx, a, b) {
    if (!a || a === "r") return renderSessions(ctx);
    if (a === "v" && b) return renderSessionView(ctx, b);

    if (a === "x" && b) {
      try {
        await waClients[b]?.sock?.end?.();
        if (waClients[b]) waClients[b].status = "closed";
      } catch (err) {
        await ctx.answerCallbackQuery({ text: `تعذّر: ${err.message}` });
      }
      return renderSessionView(ctx, b);
    }

    if (a === "n" && b) {
      await ctx.answerCallbackQuery({ text: "⏳ جارٍ إعادة الوصل..." });
      try {
        await initWhatsappForUser(b, false);
      } catch (err) {
        log.error(`AdminPanel reconnect ${b}: ${err.message}`);
      }
      return renderSessionView(ctx, b);
    }

    if (a === "d" && b) {
      await deleteSessionForUser(b);
      return renderSessions(ctx);
    }

    if (a === "c") {
      return safeEdit(
        ctx,
        "⚠️ <b>حذف جميع الجلسات؟</b>\n\nلا يمكن التراجع.",
        kb.confirm(kb.cb("s", "cy"), kb.cb("s"))
      );
    }

    if (a === "cy") {
      await clearAllSessions();
      return renderSessions(ctx);
    }

    return renderSessions(ctx);
  }

  // -----------------------------------------------------------------
  // المستخدمون
  // -----------------------------------------------------------------

  const MEMBER_ACTIONS = new Set(["mv", "mg", "mr", "mp", "md", "mc", "mm", "mrm"]);

  async function routeUsers(ctx, a, b) {
    if (!a) {
      return safeEdit(
        ctx,
        "<b>👥 إدارة المستخدمين</b>\n━━━━━━━━━━━━━━━━━━━━\nاختر قسمًا:",
        kb.usersMenu()
      );
    }

    // إجراءات على مستخدم: mv/mg/mr/mp/md/mc/mm/mrm
    if (MEMBER_ACTIONS.has(String(a)) && b !== undefined) {
      return routeMemberAction(ctx, String(a), String(b));
    }

    // صفحة قائمة: a في {a,r,b,w,m} و b رقم
    if (["a", "r", "b", "w", "m"].includes(a) && /^\d+$/.test(String(b || ""))) {
      const items = readList(a).map(String);
      const meta = kb.LIST_META[a];
      const text =
        `<b>${meta.title}</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
        (items.length === 0 ? meta.empty : `العدد: <code>${items.length}</code>`) +
        (a === "m"
          ? "\n\nاضغط على مستخدم لفتح بطاقته."
          : "\n\nاضغط 🗑 بجانب أي عنصر لحذفه.");
      return safeEdit(ctx, text, kb.listPage(a, items, Number(b)));
    }

    // حذف عنصر: <kind>rm
    if (/^[arbw]rm$/.test(String(a)) && b !== undefined) {
      const kind = String(a).slice(0, 1);
      const items = readList(kind).map(String);
      const filtered = items.filter((x) => x !== String(b));
      if (filtered.length !== items.length) writeList(kind, filtered);
      return routeUsers(ctx, kind, 0);
    }

    // إضافة عنصر (إدخال نصي)
    if (/^[arbw]add$/.test(String(a))) {
      const kind = String(a).slice(0, 1);
      pending.set(String(ctx.from.id), { action: "list:" + kind, at: Date.now() });
      return safeEdit(
        ctx,
        `➕ <b>${kb.LIST_META[kind].title}</b>\n\nأرسل القيمة كرسالة نصية الآن.\n` +
          "الإلغاء تلقائي بعد 5 دقائق.",
        kb.back(kb.cb("u"))
      );
    }

    return routeUsers(ctx);
  }

  async function routeMemberAction(ctx, action, id) {
    switch (action) {
      case "mv": {
        const f = userFlags(id);
        return safeEdit(ctx, userCardText(f), kb.userCard(id, f));
      }

      case "mg": {
        const items = readList("a").map(String);
        if (!items.includes(id)) {
          items.push(id);
          writeList("a", items);
        }
        break;
      }

      case "mr": {
        writeList("a", readList("a").map(String).filter((x) => x !== id));
        break;
      }

      case "mp": {
        const items = readList("r").map(String);
        if (!items.includes(id)) {
          items.push(id);
          writeList("r", items);
        }
        break;
      }

      case "md": {
        writeList("r", readList("r").map(String).filter((x) => x !== id));
        break;
      }

      case "mc": {
        cooldownModule.resetUserAllCooldowns(id);
        break;
      }

      case "mrm": {
        writeList("a", readList("a").map(String).filter((x) => x !== id));
        writeList("r", readList("r").map(String).filter((x) => x !== id));
        writeList("m", readList("m").map(String).filter((x) => x !== id));
        return routeUsers(ctx, "m", 0);
      }

      case "mm": {
        pending.set(String(ctx.from.id), { action: "dm:" + id, at: Date.now() });
        return safeEdit(
          ctx,
          `✉️ <b>رسالة إلى <code>${esc(id)}</code></b>\n\nأرسل نص الرسالة الآن.`,
          kb.back(kb.cb("u", "mv", id))
        );
      }
    }

    const f = userFlags(id);
    return safeEdit(ctx, userCardText(f), kb.userCard(id, f));
  }

  // -----------------------------------------------------------------
  // الإعدادات
  // -----------------------------------------------------------------

  async function routeSettings(ctx, a) {
    if (a === "f" || a === "m") {
      const s = store.readJSON("./database/settings.json", {});
      if (a === "f") s.freeMode = !s.freeMode;
      if (a === "m") s.maintenanceMode = !s.maintenanceMode;
      s.lastUpdated = new Date().toISOString();
      store.writeJSON("./database/settings.json", s);
    }

    const s = collectStats();
    const text =
      "<b>⚙️ الإعدادات</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
      `الوضع الحر: <code>${s.freeMode ? "مفعّل" : "معطّل"}</code>\n` +
      `وضع الصيانة: <code>${s.maintenance ? "مفعّل" : "معطّل"}</code>`;
    return safeEdit(ctx, text, kb.settings(s));
  }

  async function routeAdvanced(ctx, a, b) {
    if (!a) {
      const s = collectStats();
      return safeEdit(
        ctx,
        "<b>⚙️ إعدادات متقدمة</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
          "اضغط على إعداد لتغييره.",
        kb.advancedSettings(s)
      );
    }

    // تبديل قيمة منطقية: ["e2","t","<key>"]
    if (a === "t" && b) {
      const s = store.readJSON("./database/settings.json", {});
      s[b] = !(s[b] !== false);
      s.lastUpdated = new Date().toISOString();
      store.writeJSON("./database/settings.json", s);
    }

    // تعديل رقمي (إدخال نصي): ["e2","s","<key>"]
    if (a === "s" && b) {
      pending.set(String(ctx.from.id), { action: "setnum:" + b, at: Date.now() });
      return safeEdit(
        ctx,
        `🔢 <b>${kb.ADV_NUM[b] || b}</b>\n\nأرسل القيمة الرقمية الآن.`,
        kb.back(kb.cb("e2"))
      );
    }

    return routeAdvanced(ctx);
  }

  // -----------------------------------------------------------------
  // الكولدون
  // -----------------------------------------------------------------

  async function routeCooldown(ctx, a, b) {
    if (a === "on") cooldownModule.enableCooldown();
    if (a === "off") cooldownModule.disableCooldown();

    if (a === "ra") {
      return safeEdit(
        ctx,
        "⚠️ <b>إعادة تعيين كل الكولدونات؟</b>",
        kb.confirm(kb.cb("c", "ray"), kb.cb("c"))
      );
    }
    if (a === "ray") {
      cooldownModule.resetAllCooldowns();
      cooldownModule.pruneExpired();
    }

    // مستخدمون عليهم كولدون
    if (a === "u") {
      const page = Number(b) || 0;
      const allUsers = Object.keys(cooldownModule.getAllUsersCooldown() || {});
      const entries = allUsers
        .map((id) => {
          const st = cooldownModule.getUserCooldownStatus(id);
          return {
            id,
            active: Object.values(st || {}).filter((x) => x && x.onCooldown).length,
          };
        })
        .filter((e) => e.active > 0);

      // عرض أسماء الصفحة الحالية داخل النص (مو بس في الأزرار) —
      // أنفع للمشرف وأسهل للنسخ
      const start = page * PAGE_SIZE;
      const slice = entries.slice(start, start + PAGE_SIZE);

      const text =
        "<b>⏱️ المستخدمون عليهم كولدون</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
        (entries.length === 0
          ? "لا أحد حاليًا."
          : `العدد: <code>${entries.length}</code>\n\n` +
            slice
              .map(
                (e) =>
                  `👤 <code>${esc(e.id)}</code> — <code>${e.active}</code> كولدون نشط`
              )
              .join("\n") +
            "\n\nاضغط 🧹 بجانب أي مستخدم لتصفير كولدونه.");

      return safeEdit(ctx, text, kb.cooldownUsers(entries, page));
    }

    if (a === "ur" && b) {
      cooldownModule.resetUserAllCooldowns(b);
      return routeCooldown(ctx, "u", 0);
    }

    if (a === "st") {
      const s = cooldownModule.getCooldownStats();
      const text =
        "<b>⏱️ حالة الكولدون</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
        `الحالة: <code>${s.enabled ? "مفعّل" : "معطّل"}</code>\n` +
        `مستخدمون: <code>${s.totalUsers}</code>\n` +
        `أوامر مسجلة: <code>${s.totalCommands}</code>\n` +
        `نشطة: <code>${s.activeCooldowns}</code>`;
      return safeEdit(ctx, text, kb.back(kb.cb("c")));
    }

    const s = cooldownModule.getCooldownStats();
    return safeEdit(
      ctx,
      "<b>⏱️ إدارة الكولدون</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
        `الحالة: <code>${s.enabled ? "🟢 مفعّل" : "🔴 معطّل"}</code>`,
      kb.cooldownMenu(s.enabled)
    );
  }

  // -----------------------------------------------------------------
  // البث
  // -----------------------------------------------------------------

  function broadcastTargets(target) {
    if (target === "acc") return readList("a").map(String);
    return readList("m").map(String);
  }

  async function routeBroadcast(ctx, a, b) {
    if (!a) {
      const all = readList("m").length;
      const acc = readList("a").length;
      return safeEdit(
        ctx,
        "<b>📢 البث الجماعي</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
          `👥 المسجلون: <code>${all}</code>\n` +
          `🔑 أصحاب الوصول: <code>${acc}</code>\n\n` +
          "اختر الفئة المستهدفة ثم أرسل نص الرسالة.",
        kb.broadcast()
      );
    }

    if (a === "all" || a === "acc") {
      pending.set(String(ctx.from.id), { action: "bc:" + a, at: Date.now() });
      return safeEdit(
        ctx,
        `📝 <b>اكتب الرسالة</b>\n\nالفئة: <code>${a === "all" ? "الجميع" : "أصحاب الوصول"}</code>\n` +
          "أرسل النص الآن كرسالة عادية.",
        kb.back(kb.cb("bc"))
      );
    }

    if (a === "n") {
      broadcastDrafts.delete(String(ctx.from.id));
      return routeBroadcast(ctx);
    }

    if (a === "y" && b) {
      const draft = broadcastDrafts.get(String(ctx.from.id));
      broadcastDrafts.delete(String(ctx.from.id));

      if (!draft) {
        return safeEdit(ctx, "⚠️ انتهت صلاحية المسودة.", kb.broadcast());
      }

      const targets = broadcastTargets(draft.target);
      await safeEdit(ctx, `📤 جارٍ الإرسال إلى <code>${targets.length}</code>...`, kb.back());

      let sent = 0;
      let failed = 0;
      for (const id of targets) {
        try {
          await bot.api.sendMessage(id, draft.text, { parse_mode: "HTML" });
          sent++;
        } catch {
          failed++;
        }
        await sleep(35); // تخفيف الضغط على حدود تليجرام
      }

      log.info(`AdminPanel: broadcast sent=${sent} failed=${failed}`);
      return safeEdit(
        ctx,
        `<b>📢 نتيجة البث</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
          `✅ ناجح: <code>${sent}</code>\n❌ فاشل: <code>${failed}</code>`,
        kb.broadcast()
      );
    }

    return routeBroadcast(ctx);
  }

  // -----------------------------------------------------------------
  // اللوقات
  // -----------------------------------------------------------------

  async function routeLogs(ctx, a) {
    if (a === "c" && logBuffer) logBuffer.clear();

    if (!logBuffer) {
      return safeEdit(ctx, "📜 اللوقات غير مفعّلة.", kb.logs());
    }

    const lines = logBuffer.tail(20);
    const c = logBuffer.counts();
    const text =
      "<b>📜 آخر الأحداث</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
      (lines.length === 0
        ? "لا شيء مسجل بعد."
        : lines
            .map(
              (e) =>
                `${logBuffer.LEVEL_ICON[e.level] || "•"} <code>${new Date(e.t)
                  .toLocaleTimeString("ar")
                  .slice(0, 8)}</code> ${esc(e.msg).slice(0, 90)}`
            )
            .join("\n")) +
      `\n\n❌ أخطاء: <code>${c.errors}</code>   ⚠️ تحذيرات: <code>${c.warnings}</code>`;

    return safeEdit(ctx, text, kb.logs());
  }

  // -----------------------------------------------------------------
  // الصيانة
  // -----------------------------------------------------------------

  async function routeTools(ctx, a) {
    if (a === "cc") {
      let removed = 0;
      try {
        const tempDir = path.join(process.cwd(), "temp");
        if (fs.existsSync(tempDir)) {
          for (const f of fs.readdirSync(tempDir)) {
            try {
              fs.unlinkSync(path.join(tempDir, f));
              removed++;
            } catch {}
          }
        }
      } catch {}
      cooldownModule.pruneExpired();
      await ctx.answerCallbackQuery({ text: `🧹 تم التنظيف (${removed})` });
    }

    if (a === "rs") {
      return safeEdit(
        ctx,
        "⚠️ <b>إعادة تشغيل البوت؟</b>\n\nستُغلق الجلسات بأمان أولًا.",
        kb.confirm(kb.cb("t", "rsy"), kb.cb("t"))
      );
    }

    if (a === "rsy") {
      await ctx.answerCallbackQuery({ text: "♻️ جارٍ إعادة التشغيل" });
      return gracefulShutdown(0);
    }

    return safeEdit(
      ctx,
      "<b>🔧 الصيانة</b>\n━━━━━━━━━━━━━━━━━━━━\nاختر إجراءً:",
      kb.tools()
    );
  }

  // ===================================================================
  // معالج الأزرار
  // ===================================================================

  bot.on("callback_query", async (ctx, next) => {
    const data = ctx.callbackQuery?.data || "";

    if (!data.startsWith(kb.NS + ":")) return next();

    const userId = String(ctx.from.id);

    if (!isOwner(userId) && !isReseller(userId)) {
      await ctx.answerCallbackQuery({ text: "🚫 لا تملك صلاحية", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery().catch(() => {});

    try {
      await route(ctx, data.split(":"));
    } catch (err) {
      log.error(`AdminPanel error: ${err.message}`);
      await ctx.answerCallbackQuery({ text: "حدث خطأ غير متوقع", show_alert: true }).catch(
        () => {}
      );
    }
  });

  // ===================================================================
  // الإدخال النصي للإجراءات المعلّقة
  // ===================================================================

  bot.on("message:text", async (ctx, next) => {
    const userId = String(ctx.from.id);
    const p = pending.get(userId);

    if (!p) return next();

    pending.delete(userId);

    if (Date.now() - p.at > PENDING_TTL) return next();
    if (!isOwner(userId) && !isReseller(userId)) return next();

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return next();

    // --- إضافة إلى قائمة ---
    if (p.action.startsWith("list:")) {
      const kind = p.action.split(":")[1];
      if (!kb.LIST_META[kind]) return ctx.reply("❌ نوع قائمة غير معروف.");

      const value = kind === "b" || kind === "w" ? text.replace(/[^0-9]/g, "") : text.trim();
      if (!value) return ctx.reply("❌ قيمة غير صالحة — تم الإلغاء.");

      const items = readList(kind).map(String);
      if (items.includes(value)) return ctx.reply("⚠️ القيمة موجودة مسبقًا.");

      items.push(value);
      writeList(kind, items);
      log.info(`AdminPanel: added ${value} to list ${kind}`);
      return ctx.reply(`✅ تمت الإضافة إلى <b>${kb.LIST_META[kind].title}</b>`, {
        parse_mode: "HTML",
      });
    }

    // --- تعديل إعداد رقمي ---
    if (p.action.startsWith("setnum:")) {
      const key = p.action.split(":")[1];
      const value = parseInt(text.replace(/[^0-9-]/g, ""), 10);

      if (!Number.isFinite(value) || value < 0) {
        return ctx.reply("❌ القيمة لازم تكون رقمًا موجبًا.");
      }

      const s = store.readJSON("./database/settings.json", {});
      s[key] = value;
      s.lastUpdated = new Date().toISOString();
      store.writeJSON("./database/settings.json", s);
      log.info(`AdminPanel: setting ${key} = ${value}`);
      return ctx.reply(`✅ تم ضبط <b>${kb.ADV_NUM[key] || key}</b> = <code>${value}</code>`, {
        parse_mode: "HTML",
      });
    }

    // --- رسالة خاصة لمستخدم ---
    if (p.action.startsWith("dm:")) {
      const target = p.action.split(":")[1];
      try {
        await bot.api.sendMessage(target, text);
        return ctx.reply("✅ تم الإرسال.");
      } catch (err) {
        return ctx.reply(`❌ فشل الإرسال: ${err.message}`);
      }
    }

    // --- composing بث ---
    if (p.action.startsWith("bc:")) {
      const target = p.action.split(":")[1];
      const targets = broadcastTargets(target);
      broadcastDrafts.set(userId, { target, text });

      return ctx.reply(
        `<b>📢 معاينة البث</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
          `الفئة: <code>${target === "all" ? "الجميع" : "أصحاب الوصول"}</code>\n` +
          `المستلمون: <code>${targets.length}</code>\n\n` +
          `<pre>${esc(text).slice(0, 600)}</pre>`,
        {
          parse_mode: "HTML",
          reply_markup: kb.broadcastConfirm(target),
        }
      );
    }

    return next();
  });

  // ===================================================================
  // الأمر /panel
  // ===================================================================

  bot.command("panel", async (ctx) => {
    const userId = String(ctx.from.id);
    if (!isOwner(userId) && !isReseller(userId)) {
      return ctx.reply("🚫 هذه اللوحة للمالك والراسيلرز فقط.");
    }
    await ctx.reply(homeText(), { reply_markup: kb.home(), parse_mode: "HTML" });
  });

  log.success("Admin panel loaded (/panel)");
}

module.exports = { registerAdminPanel, esc, fmtUptime };

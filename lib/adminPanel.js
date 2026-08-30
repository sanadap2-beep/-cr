"use strict";

// =====================================================================
// lib/adminPanel.js - لوحة تحكم تفاعلية بالأزرار
// =====================================================================
// الأقسام (كلها إدارية/تنظيمية):
//   🏠 الرئيسية     — نظرة عامة
//   📱 الجلسات      — عرض، قطع، إعادة وصل، حذف
//   👥 المستخدمون   — الوصول، الراسيلرز، المحظورون، القائمة البيضاء
//   ⚙️ الإعدادات    — الوضع الحر، وضع الصيانة
//   ⏱️ الكولدون     — تفعيل/تعطيل، إعادة تعيين، الحالة
//   📊 الإحصائيات   — أرقام تفصيلية
//   🔧 الصيانة      — تنظيف الكاش، إعادة التشغيل
//
// 🚫 لا يحتوي أي زر يشغّل أوامر الكراش/السبام/الإغراق — ولا يُشغّلها.
//
// ملاحظة معمارية: المعالج يتعرف على بياناته بالبادئة "ap:"،
// وإذا ما كانت له يستدعي next() فيمرّر الحدث لمعالج الأزرار الأصلي.
// =====================================================================

const fs = require("fs");
const path = require("path");
const kb = require("./keyboards");

const PENDING_TTL = 5 * 60 * 1000;

/** إجراءات بانتظار إدخال نصي من الأدمن: userId -> {action, at} */
const pending = new Map();

// =====================================================================
// أدوات مساعدة
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

/** تعديل الرسالة مع تجاهل خطأ "message is not modified" الشائع */
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
    startedAt,
  } = deps;

  // ===================================================================
  // جمع الإحصائيات
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
      `⏰ مدة التشغيل: <code>${s.uptime}</code>\n` +
      `💾 الذاكرة: <code>${s.mem} MB</code>`
    );
  }

  function statsText() {
    const s = collectStats();
    return (
      "<b>📊 إحصائيات تفصيلية</b>\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `📱 الجلسات الكلية: <code>${s.sessions}</code>\n` +
      `🟢 متصلة: <code>${s.open}</code>\n` +
      `🟡 قيد الاتصال: <code>${s.connecting}</code>\n` +
      `🔴 مغلقة: <code>${s.sessions - s.open - s.connecting}</code>\n` +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `👥 مستخدمون مسجلون: <code>${s.users}</code>\n` +
      `🔑 لديهم وصول: <code>${s.access}</code>\n` +
      `💼 راسيلرز: <code>${s.resellers}</code>\n` +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `⏱️ الكولدون: <code>${s.cooldownEnabled ? "مفعّل" : "معطّل"}</code>\n` +
      `👤 مستخدمون عليه كولدون: <code>${s.cooldownUsers}</code>\n` +
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
  const renderStats = (ctx) =>
    safeEdit(ctx, statsText(), kb.back());

  async function renderSessions(ctx) {
    const entries = Object.entries(waClients || {}).map(([id, v]) => ({
      id,
      status: v?.status || "unknown",
    }));

    const text =
      "<b>📱 إدارة الجلسات</b>\n" +
      "━━━━━━━━━━━━━━━━━━━━\n" +
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
      `<b>📱 جلسة <code>${esc(id)}</code></b>\n` +
      "━━━━━━━━━━━━━━━━━━━━\n" +
      `الحالة: <code>${esc(entry.status)}</code>\n` +
      `المسار: <code>${esc(entry.sessionPath || "-")}</code>\n` +
      `آخر نشاط: <code>${
        entry.lastActivity ? new Date(entry.lastActivity).toLocaleString("ar") : "-"
      }</code>`;

    await safeEdit(ctx, text, kb.sessionView(id));
  }

  // ===================================================================
  // توجيه الأقسام
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

      case "c":
        return routeCooldown(ctx, a);

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
        log.info(`AdminPanel: disconnected session ${b}`);
        await ctx.answerCallbackQuery({ text: "🔌 تم قطع الاتصال" });
      } catch (err) {
        await ctx.answerCallbackQuery({ text: `تعذّر القطع: ${err.message}` });
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
      await ctx.answerCallbackQuery({ text: "🗑 تم حذف الجلسة" });
      return renderSessions(ctx);
    }

    if (a === "c") {
      return safeEdit(
        ctx,
        "⚠️ <b>حذف جميع الجلسات؟</b>\n\nسيُحذف مجلد الجلسات بالكامل ولا يمكن التراجع.",
        kb.confirm(kb.cb("s", "cy"), kb.cb("s"))
      );
    }

    if (a === "cy") {
      await clearAllSessions();
      await ctx.answerCallbackQuery({ text: "🗑 تم حذف جميع الجلسات" });
      return renderSessions(ctx);
    }

    return renderSessions(ctx);
  }

  // -----------------------------------------------------------------
  // المستخدمون والقوائم
  // -----------------------------------------------------------------

  function readList(kind) {
    if (kind === "a") return store.readJSON("./storage/access.json", { users: [] }).users || [];
    if (kind === "r") return store.readJSON("./storage/resellers.json", { users: [] }).users || [];
    if (kind === "b") return getBlacklist() || [];
    if (kind === "w") return getWhitelist() || [];
    return [];
  }

  function writeList(kind, items) {
    if (kind === "a") return store.writeJSON("./storage/access.json", { users: items });
    if (kind === "r") return store.writeJSON("./storage/resellers.json", { users: items });
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

  async function routeUsers(ctx, a, b) {
    if (!a) {
      return safeEdit(
        ctx,
        "<b>👥 إدارة المستخدمين</b>\n━━━━━━━━━━━━━━━━━━━━\nاختر قسمًا:",
        kb.usersMenu()
      );
    }

    // صفحة قائمة: ["u", "a", "0"]
    if (["a", "r", "b", "w"].includes(a) && b !== undefined && /^\d+$/.test(String(b))) {
      const items = readList(a).map(String);
      const meta = kb.LIST_META[a];
      const page = Number(b);
      const text =
        `<b>${meta.title}</b>\n━━━━━━━━━━━━━━━━━━━━\n` +
        (items.length === 0 ? meta.empty : `العدد: <code>${items.length}</code>`) +
        "\n\nاضغط 🗑 بجانب أي عنصر لحذفه.";
      return safeEdit(ctx, text, kb.listPage(a, items, page));
    }

    // حذف عنصر: ["u", "arm", "<item>"]
    if (/^[arbw]rm$/.test(String(a)) && b !== undefined) {
      const kind = String(a).slice(0, 1);
      const items = readList(kind).map(String);
      const filtered = items.filter((x) => x !== String(b));
      if (filtered.length !== items.length) {
        writeList(kind, filtered);
        await ctx.answerCallbackQuery({ text: "🗑 تم الحذف" });
      }
      return routeUsers(ctx, kind, 0);
    }

    // إضافة عنصر (يطلب إدخال نصي)
    if (/^[arbw]add$/.test(String(a))) {
      // a = kind + "add"  →  "aadd" | "radd" | "badd" | "wadd"
      // أول حرف هو نوع القائمة فقط
      const kind = String(a).slice(0, 1);
      pending.set(String(ctx.from.id), { action: "list:" + kind, at: Date.now() });
      const meta = kb.LIST_META[kind];
      await ctx.answerCallbackQuery({ text: "أرسل القيمة الآن" });
      return safeEdit(
        ctx,
        `➕ <b>${meta.title}</b>\n\nأرسل القيمة كرسالة نصية الآن.\n` +
          "الإلغاء تلقائي بعد 5 دقائق.",
        kb.back(kb.cb("u"))
      );
    }

    return routeUsers(ctx);
  }

  // -----------------------------------------------------------------
  // الإعدادات
  // -----------------------------------------------------------------

  async function routeSettings(ctx, a) {
    if (a === "f") {
      const s = store.readJSON("./database/settings.json", {});
      s.freeMode = !s.freeMode;
      s.lastUpdated = new Date().toISOString();
      store.writeJSON("./database/settings.json", s);
      await ctx.answerCallbackQuery({
        text: s.freeMode ? "🟢 الوضع الحر مفعّل" : "🔴 الوضع الحر معطّل",
      });
    }

    if (a === "m") {
      const s = store.readJSON("./database/settings.json", {});
      s.maintenanceMode = !s.maintenanceMode;
      s.lastUpdated = new Date().toISOString();
      store.writeJSON("./database/settings.json", s);
      await ctx.answerCallbackQuery({
        text: s.maintenanceMode ? "🟢 وضع الصيانة مفعّل" : "🔴 وضع الصيانة معطّل",
      });
    }

    const s = collectStats();
    const text =
      "<b>⚙️ الإعدادات</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
      `الوضع الحر: <code>${s.freeMode ? "مفعّل" : "معطّل"}</code>\n` +
      `وضع الصيانة: <code>${s.maintenance ? "مفعّل" : "معطّل"}</code>`;
    return safeEdit(ctx, text, kb.settings(s));
  }

  // -----------------------------------------------------------------
  // الكولدون
  // -----------------------------------------------------------------

  async function routeCooldown(ctx, a) {
    if (a === "on") {
      cooldownModule.enableCooldown();
      await ctx.answerCallbackQuery({ text: "🟢 الكولدون مفعّل" });
    }

    if (a === "off") {
      cooldownModule.disableCooldown();
      await ctx.answerCallbackQuery({ text: "🔴 الكولدون معطّل" });
    }

    if (a === "ra") {
      return safeEdit(
        ctx,
        "⚠️ <b>إعادة تعيين كل الكولدونات؟</b>\n\nسيُمحى كولدون كل المستخدمين.",
        kb.confirm(kb.cb("c", "ray"), kb.cb("c"))
      );
    }

    if (a === "ray") {
      cooldownModule.resetAllCooldowns();
      cooldownModule.pruneExpired();
      await ctx.answerCallbackQuery({ text: "🧹 تم إعادة التعيين" });
    }

    if (a === "st") {
      const s = cooldownModule.getCooldownStats();
      const text =
        "<b>⏱️ حالة الكولدون</b>\n━━━━━━━━━━━━━━━━━━━━\n" +
        `الحالة: <code>${s.enabled ? "مفعّل" : "معطّل"}</code>\n` +
        `مستخدمون عليهم كولدون: <code>${s.totalUsers}</code>\n` +
        `أوامر مسجلة: <code>${s.totalCommands}</code>\n` +
        `نشطة فعليًا: <code>${s.activeCooldowns}</code>`;
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
      await ctx.answerCallbackQuery({ text: `🧹 تم التنظيف (${removed} ملف)` });
    }

    if (a === "rs") {
      return safeEdit(
        ctx,
        "⚠️ <b>إعادة تشغيل البوت؟</b>\n\nسيُغلق كل الجلسات بأمان ثم يخرج.",
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

    // ليس من لوحة التحكم → مرّره للمعالج الأصلي
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
  // استقبال الإدخال النصي للإجراءات المعلّقة
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

    if (!p.action.startsWith("list:")) return next();

    const kind = p.action.split(":")[1];
    const value = kind === "b" || kind === "w" ? text.replace(/[^0-9]/g, "") : text.trim();

    if (!value) {
      return ctx.reply("❌ قيمة غير صالحة — تم الإلغاء.");
    }

    const items = readList(kind).map(String);
    if (items.includes(value)) {
      return ctx.reply("⚠️ القيمة موجودة مسبقًا.");
    }

    items.push(value);
    writeList(kind, items);

    log.info(`AdminPanel: added ${value} to list ${kind} by ${userId}`);
    return ctx.reply(`✅ تمت الإضافة إلى <b>${kb.LIST_META[kind].title}</b>`, {
      parse_mode: "HTML",
    });
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

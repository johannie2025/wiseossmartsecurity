/**
 * WISE OS UNIFIED — server.js v3.2
 * Corrections : Session Baileys + MySQL robustesse + Render-friendly
 */

import express    from "express";
import cors       from "cors";
import qrcode     from "qrcode";
import mysql      from "mysql2/promise";
import nodemailer from "nodemailer";
import dotenv     from "dotenv";
import fs         from "fs";

dotenv.config();

// Chargement dynamique de Baileys
let makeWASocket, useMultiFileAuthState, DisconnectReason, delay;
(async () => {
  const baileys = await import("@whiskeysockets/baileys");
  makeWASocket     = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  delay            = baileys.delay;
  startServer();
})();

// ====================== I18N ======================
const i18n = { /* Ton i18n complet reste ici */ };

function detectLang(req) {
  const param = req.query?.lang || req.body?.lang;
  if (param && i18n[param]) return param;
  const primary = (req.headers["accept-language"] || "fr").split(",")[0].split("-")[0].toLowerCase();
  return i18n[primary] ? primary : "fr";
}

function getMessage(lang, section, key, ...args) {
  const template = i18n[lang]?.[section]?.[key] || i18n.fr?.[section]?.[key];
  return typeof template === "function" ? template(...args) : template || "";
}

// ====================== CONFIG ======================
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.NODE_API_KEY;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 15,
  acquireTimeout: 60000,
  timeout: 60000,
  charset: "utf8mb4",
  enableKeepAlive: true,
});

const sessions = new Map();   // tenant_id → sessionData
const sseClients = new Map();

// ====================== DOSSIER AUTH ======================
const AUTH_DIR = './wa_auth';
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

// ====================== DB HELPERS ======================
async function loadSessionFromDB(tenantId) {
  try {
    const [rows] = await pool.execute(
      "SELECT session_data FROM whatsapp_sessions WHERE tenant_id = ? LIMIT 1",
      [tenantId]
    );
    
    if (!rows.length) return null;
    
    const data = JSON.parse(rows[0].session_data);
    console.log(`[DB] Session chargée pour tenant ${tenantId}`);
    return data;
  } catch (e) {
    console.error(`[DB Load Session] tenant ${tenantId}:`, e.message);
    return null;
  }
}

async function saveSessionToDB(tenantId, creds) {
  try {
    await pool.execute(
      `INSERT INTO whatsapp_sessions (tenant_id, session_data, updated_at)
       VALUES (?, ?, NOW()) 
       ON DUPLICATE KEY UPDATE session_data = VALUES(session_data), updated_at = NOW()`,
      [tenantId, JSON.stringify(creds)]
    );
    console.log(`[DB] Session sauvegardée pour tenant ${tenantId}`);
  } catch (e) {
    console.error(`[DB Save Session] tenant ${tenantId}:`, e.message);
  }
}

// ====================== WHATSAPP ======================
async function connectWhatsApp(tenantId) {
  tenantId = Number(tenantId) || 1;

  // Nettoyage de l'ancienne session
  if (sessions.has(tenantId)) {
    const old = sessions.get(tenantId);
    if (old?.sock) old.sock.end().catch(() => {});
    sessions.delete(tenantId);
  }

  try {
    const savedSession = await loadSessionFromDB(tenantId);
    const { state, saveCreds } = await useMultiFileAuthState(`${AUTH_DIR}/${tenantId}`);

    if (savedSession) {
      Object.assign(state.creds, savedSession);
      console.log(`[WA] Session restaurée pour tenant ${tenantId}`);
    }

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ["Wise OS", "Chrome", "3.2"],
      logger: undefined,
      markOnlineOnConnect: false,
      retryRequestDelayMs: 3000,
      connectTimeoutMs: 60000,
    });

    const sd = { 
      sock, 
      status: "connecting", 
      qrBase64: null, 
      lastActivity: Date.now() 
    };
    sessions.set(tenantId, sd);

    // === Events ===
    sock.ev.on("creds.update", async () => {
      await saveCreds();
      await saveSessionToDB(tenantId, state.creds);
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      sd.lastActivity = Date.now();

      if (qr) {
        sd.qrBase64 = await qrcode.toDataURL(qr, { width: 420, margin: 2 });
        sd.status = "qr_pending";
        broadcastSSE(tenantId, { type: "qr", qr: sd.qrBase64 });
        console.log(`[WA] QR généré pour tenant ${tenantId}`);
      }

      if (connection === "open") {
        sd.status = "connected";
        sd.qrBase64 = null;
        broadcastSSE(tenantId, { type: "connected" });
        console.log(`✅ [WA] Connecté avec succès → Tenant ${tenantId}`);
      }

      if (connection === "close") {
        broadcastSSE(tenantId, { type: "disconnected" });
        
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        
        console.log(`[WA] Déconnecté tenant ${tenantId} | Reconnexion: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => connectWhatsApp(tenantId), 10000);
        }
      }
    });

  } catch (err) {
    console.error(`[WA Connect Error] Tenant ${tenantId}:`, err.message);
    setTimeout(() => connectWhatsApp(tenantId), 15000);
  }
}

// ====================== SSE ======================
function broadcastSSE(tenantId, data) {
  const clients = sseClients.get(tenantId);
  if (!clients) return;
  
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(payload).catch(() => {});
  }
}

// ====================== SERVER ======================
async function startServer() {
  const app = express();
  
  app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
  app.use(express.json({ limit: "10mb" }));

  const auth = (req, res, next) => {
    if (!API_KEY) return next();
    if ((req.headers["x-api-key"] || req.body?._api_key) !== API_KEY) 
      return res.status(403).json({ error: "Unauthorized" });
    next();
  };

  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.2" }));

  // SSE
  app.get("/connect", (req, res) => {
    const tenantId = req.query.tenant_id || req.query.user_id || 1;
    if (!tenantId) return res.status(400).json({ error: "tenant_id requis" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    if (!sseClients.has(tenantId)) sseClients.set(tenantId, new Set());
    sseClients.get(tenantId).add(res);

    const sd = sessions.get(tenantId);
    if (sd?.status === "connected") {
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    } else {
      connectWhatsApp(tenantId).catch(console.error);
    }

    req.on("close", () => {
      sseClients.get(tenantId)?.delete(res);
    });
  });

  // Generate OTP
  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, tenant_id, type = "default", ref_name = "" } = req.body;
    if (!phone || !tenant_id) return res.status(400).json({ error: "phone et tenant_id requis" });

    const lang = detectLang(req);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    try {
      await pool.execute(
        `INSERT INTO otp_codes (tenant_id, recipient, code, type, expires_at, used)
         VALUES (?,?,?,?,?,0)
         ON DUPLICATE KEY UPDATE code=VALUES(code), expires_at=VALUES(expires_at), used=0`,
        [tenant_id, phone, code, type, expires]
      );

      const message = getMessage(lang, "otp", type, code, ref_name);
      res.json({ success: true, code, expires_in: 600 }); // code visible pour debug

      sendWA(tenant_id, phone, message);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // Validate OTP
  app.post("/validate-otp", auth, async (req, res) => {
    const { phone, code, tenant_id } = req.body;
    if (!phone || !code || !tenant_id) return res.status(400).json({ error: "phone, code, tenant_id requis" });

    try {
      const [rows] = await pool.execute(
        `SELECT id, type FROM otp_codes 
         WHERE tenant_id = ? AND recipient = ? AND code = ? 
         AND expires_at > NOW() AND used = 0 LIMIT 1`,
        [tenant_id, phone, code]
      );

      if (!rows.length) return res.status(401).json({ valid: false, error: "OTP invalide ou expiré" });

      await pool.execute("UPDATE otp_codes SET used = 1 WHERE id = ?", [rows[0].id]);
      res.json({ valid: true, type: rows[0].type });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.listen(PORT, async () => {
    console.log(`🚀 Wise OS Unified v3.2 démarré sur port ${PORT}`);
    connectWhatsApp(1).catch(console.error); // Tenant central
  });
}

// Keep-alive
setInterval(() => {
  console.log(`[KEEP-ALIVE] Wise OS v3.2 • ${new Date().toISOString()}`);
}, 4 * 60 * 1000);

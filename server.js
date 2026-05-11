/**
 * WISE OS UNIFIED — server.js v3.2.3
 * Correction : Logger Baileys + Meilleure gestion DB + Timeout
 */

import express    from "express";
import cors       from "cors";
import qrcode     from "qrcode";
import mysql      from "mysql2/promise";
import dotenv     from "dotenv";
import fs         from "fs";
import pino       from "pino";   // ← Ajout pour logger propre

dotenv.config();

// Chargement Baileys
let makeWASocket, useMultiFileAuthState, DisconnectReason, delay;
(async () => {
  const baileys = await import("@whiskeysockets/baileys");
  makeWASocket     = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  delay            = baileys.delay;
  startServer();
})();

// ====================== CONFIG ======================
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.NODE_API_KEY;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 30000,      // Réduit pour détecter plus vite
  acquireTimeout: 30000,

  charset: "utf8mb4",
});

// Logger Pino (compatible Baileys)
const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

const sessions = new Map();
const sseClients = new Map();

const AUTH_DIR = './wa_auth';
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// ====================== DB HELPERS ======================
async function loadSessionFromDB(tenantId) {
  try {
    const [rows] = await pool.execute(
      "SELECT session_data FROM whatsapp_sessions WHERE tenant_id = ? LIMIT 1", 
      [tenantId]
    );
    if (!rows.length) return null;
    console.log(`[DB] ✅ Session chargée tenant ${tenantId}`);
    return JSON.parse(rows[0].session_data);
  } catch (e) {
    console.error(`[DB Load] tenant ${tenantId}:`, e.message);
    return null;
  }
}

async function saveSessionToDB(tenantId, creds) {
  try {
    await pool.execute(
      `INSERT INTO whatsapp_sessions (tenant_id, session_data, updated_at)
       VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE session_data = VALUES(session_data), updated_at = NOW()`,
      [tenantId, JSON.stringify(creds)]
    );
  } catch (e) {
    console.error(`[DB Save] tenant ${tenantId}:`, e.message);
  }
}

// ====================== WHATSAPP ======================
async function connectWhatsApp(tenantId) {
  tenantId = Number(tenantId) || 1;

  if (sessions.has(tenantId)) {
    sessions.get(tenantId).sock?.end().catch(() => {});
    sessions.delete(tenantId);
  }

  try {
    const saved = await loadSessionFromDB(tenantId);
    const { state, saveCreds } = await useMultiFileAuthState(`${AUTH_DIR}/${tenantId}`);

    if (saved) Object.assign(state.creds, saved);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ["Wise OS", "Chrome", "3.2"],
      logger: logger,                    // ← Correction ici
      markOnlineOnConnect: false,
      retryRequestDelayMs: 4000,
      connectTimeoutMs: 60000,
    });

    const sd = { sock, status: "connecting", qrBase64: null, lastActivity: Date.now() };
    sessions.set(tenantId, sd);

    sock.ev.on("creds.update", async () => {
      await saveCreds();
      await saveSessionToDB(tenantId, state.creds);
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      sd.lastActivity = Date.now();

      if (qr) {
        sd.qrBase64 = await qrcode.toDataURL(qr);
        sd.status = "qr_pending";
        broadcastSSE(tenantId, { type: "qr", qr: sd.qrBase64 });
        console.log(`[WA] 📱 QR généré - Tenant ${tenantId}`);
      }

      if (connection === "open") {
        sd.status = "connected";
        sd.qrBase64 = null;
        broadcastSSE(tenantId, { type: "connected" });
        console.log(`✅ [WA] Connecté → Tenant ${tenantId}`);
      }

      if (connection === "close") {
        broadcastSSE(tenantId, { type: "disconnected" });
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log(`[WA] 🔄 Reconnexion dans 10s (tenant ${tenantId})`);
          setTimeout(() => connectWhatsApp(tenantId), 10000);
        }
      }
    });

  } catch (err) {
    console.error(`[WA Connect Error] Tenant ${tenantId}:`, err.message);
    setTimeout(() => connectWhatsApp(tenantId), 15000);
  }
}

// ====================== AUTRES FONCTIONS ======================
async function sendWA(tenantId, phone, text) {
  let sd = sessions.get(Number(tenantId) || 1);
  if (!sd || sd.status !== "connected") {
    await connectWhatsApp(tenantId);
    await delay(4000);
    sd = sessions.get(Number(tenantId) || 1);
  }
  if (!sd?.sock) return false;

  try {
    const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";
    await sd.sock.sendMessage(jid, { text });
    return true;
  } catch (e) {
    console.error("[sendWA]", e.message);
    return false;
  }
}

function broadcastSSE(tenantId, data) {
  const clients = sseClients.get(tenantId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(payload).catch(() => {});
}

// ====================== SERVER ======================
async function startServer() {
  const app = express();
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "10mb" }));

  const auth = (req, res, next) => {
    if (!API_KEY) return next();
    if ((req.headers["x-api-key"] || req.body?._api_key) !== API_KEY) 
      return res.status(403).json({ error: "Unauthorized" });
    next();
  };

  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.2.3" }));

  app.get("/status", auth, (req, res) => {
    const list = {};
    sessions.forEach((sd, id) => {
      list[id] = { status: sd.status, lastActivity: new Date(sd.lastActivity).toISOString() };
    });
    res.json({ version: "3.2.3", sessions: list, active: sessions.size });
  });

  // ... (les autres endpoints /generate-otp, /send-message, /connect restent identiques à la version précédente)

  app.listen(PORT, () => {
    console.log(`🚀 Wise OS v3.2.3 démarré sur ${PORT}`);
    console.log(`🔗 Testez : /status`);
    connectWhatsApp(1);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

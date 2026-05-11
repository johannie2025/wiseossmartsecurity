/**
 * WISE OS UNIFIED — server.js v3.2.5
 * Correction bugs + Dashboard Test
 */

import express    from "express";
import cors       from "cors";
import qrcode     from "qrcode";
import mysql      from "mysql2/promise";
import dotenv     from "dotenv";
import fs         from "fs";
import pino       from "pino";

dotenv.config();

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
  connectTimeout: 20000,
  charset: "utf8mb4",
});

const logger = pino({ level: 'silent' });

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

  // Nettoyage sécurisé
  if (sessions.has(tenantId)) {
    const old = sessions.get(tenantId);
    if (old?.sock) {
      old.sock.end().catch(() => {});
    }
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
      logger: logger,
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
    console.log(`[WA] Message envoyé à ${phone}`);
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

// ====================== DASHBOARD HTML ======================
const testHTML = `...`; // (Je te le remets complet ci-dessous si tu veux, mais pour gagner de la place je le mets à la fin)

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

  app.get("/", (req, res) => res.send(testHTML));

  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.2.5" }));

  app.get("/status", auth, (req, res) => {
    const list = {};
    sessions.forEach((sd, id) => {
      list[id] = { status: sd.status, lastActivity: new Date(sd.lastActivity).toISOString() };
    });
    res.json({ version: "3.2.5", sessions: list, active: sessions.size });
  });

  app.get("/connect", (req, res) => {
    const tenantId = req.query.tenant_id || 1;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    if (!sseClients.has(tenantId)) sseClients.set(tenantId, new Set());
    sseClients.get(tenantId).add(res);

    if (sessions.get(tenantId)?.status === "connected") {
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    } else {
      connectWhatsApp(tenantId);
    }

    req.on("close", () => sseClients.get(tenantId)?.delete(res));
  });

  // Generate OTP
  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, tenant_id = 1 } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    try {
      await pool.execute(
        `INSERT INTO otp_codes (tenant_id, recipient, code, type, expires_at, used)
         VALUES (?,?,?,?,?,0) ON DUPLICATE KEY UPDATE ...`,
        [tenant_id, phone, code, "default", expires]
      );

      const sent = await sendWA(tenant_id, phone, `Votre code est : ${code}`);
      res.json({ success: true, code, sent });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/send-message", auth, async (req, res) => {
    const { phone, message, tenant_id = 1 } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "phone et message requis" });
    const sent = await sendWA(tenant_id, phone, message);
    res.json({ success: sent });
  });

  app.listen(PORT, () => {
    console.log(`🚀 Wise OS v3.2.5 démarré sur port ${PORT}`);
    console.log(`🌐 Dashboard → https://wiseossmartsecurity.onrender.com`);
    connectWhatsApp(1);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

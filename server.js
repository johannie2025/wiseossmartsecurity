/**
 * WISE OS UNIFIED — server.js v3.2.2
 * Version complète pour tests • Tous les endpoints actifs
 */

import express    from "express";
import cors       from "cors";
import qrcode     from "qrcode";
import mysql      from "mysql2/promise";
import dotenv     from "dotenv";
import fs         from "fs";

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
  connectionLimit: 15,
  queueLimit: 0,
  connectTimeout: 60000,
  acquireTimeout: 60000,
  enableKeepAlive: true,
  charset: "utf8mb4",
});

const sessions = new Map();
const sseClients = new Map();

const AUTH_DIR = './wa_auth';
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// ====================== DB HELPERS ======================
async function loadSessionFromDB(tenantId) {
  try {
    const [rows] = await pool.execute("SELECT session_data FROM whatsapp_sessions WHERE tenant_id = ? LIMIT 1", [tenantId]);
    if (!rows.length) return null;
    console.log(`[DB] ✅ Session chargée pour tenant ${tenantId}`);
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
    console.log(`[DB] ✅ Session sauvegardée pour tenant ${tenantId}`);
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
      logger: { level: 'silent' },
      markOnlineOnConnect: false,
      retryRequestDelayMs: 3000,
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
        sd.qrBase64 = await qrcode.toDataURL(qr, { width: 420, margin: 2 });
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
        if (shouldReconnect) setTimeout(() => connectWhatsApp(tenantId), 10000);
      }
    });

  } catch (err) {
    console.error(`[WA Error] Tenant ${tenantId}:`, err.message);
  }
}

async function sendWA(tenantId, phone, text) {
  const sd = sessions.get(Number(tenantId) || 1);
  if (!sd || sd.status !== "connected") {
    console.log(`[sendWA] Session non connectée, tentative de connexion...`);
    await connectWhatsApp(tenantId);
    await delay(3000);
  }

  try {
    const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";
    await sd.sock.sendMessage(jid, { text });
    console.log(`[WA] Message envoyé à ${phone}`);
    return true;
  } catch (e) {
    console.error(`[WA Send Error]:`, e.message);
    return false;
  }
}

// ====================== SSE ======================
function broadcastSSE(tenantId, data) {
  const clients = sseClients.get(tenantId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(payload).catch(() => {});
}

// ====================== SERVER ======================
async function startServer() {
  const app = express();
  
  app.use(cors({ origin: "*", credentials: true }));
  app.use(express.json({ limit: "10mb" }));

  const auth = (req, res, next) => {
    if (!API_KEY) return next();
    if ((req.headers["x-api-key"] || req.body?._api_key) !== API_KEY) 
      return res.status(403).json({ error: "Unauthorized" });
    next();
  };

  // ==================== ENDPOINTS DE TEST ====================

  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.2.2" }));

  // Status complet des sessions
  app.get("/status", auth, (req, res) => {
    const sessionList = {};
    sessions.forEach((sd, tid) => {
      sessionList[tid] = {
        status: sd.status,
        lastActivity: new Date(sd.lastActivity).toISOString(),
        hasQR: !!sd.qrBase64
      };
    });

    res.json({
      version: "3.2.2",
      uptime: Math.floor(process.uptime()),
      activeSessions: sessions.size,
      sessions: sessionList,
      timestamp: new Date().toISOString()
    });
  });

  // SSE
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

  // === TEST : Générer OTP + Envoi WhatsApp ===
  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, tenant_id = 1, type = "default" } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    try {
      await pool.execute(
        `INSERT INTO otp_codes (tenant_id, recipient, code, type, expires_at, used)
         VALUES (?,?,?,?,?,0) ON DUPLICATE KEY UPDATE code=VALUES(code), expires_at=VALUES(expires_at), used=0`,
        [tenant_id, phone, code, type, expires]
      );

      const message = `Votre code de vérification est : ${code}\nIl expire dans 10 minutes.`;
      
      const sent = await sendWA(tenant_id, phone, message);
      
      res.json({ 
        success: true, 
        code, 
        expires_in: 600,
        message_sent: sent 
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // === TEST : Envoyer un message WhatsApp direct ===
  app.post("/send-message", auth, async (req, res) => {
    const { phone, message, tenant_id = 1 } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "phone et message requis" });

    const sent = await sendWA(tenant_id, phone, message);
    res.json({ success: sent, phone, message_sent: sent });
  });

  // Validate OTP
  app.post("/validate-otp", auth, async (req, res) => {
    const { phone, code, tenant_id = 1 } = req.body;
    if (!phone || !code) return res.status(400).json({ error: "phone et code requis" });

    try {
      const [rows] = await pool.execute(
        `SELECT id FROM otp_codes 
         WHERE tenant_id = ? AND recipient = ? AND code = ? 
         AND expires_at > NOW() AND used = 0 LIMIT 1`,
        [tenant_id, phone, code]
      );

      if (!rows.length) return res.status(401).json({ valid: false });

      await pool.execute("UPDATE otp_codes SET used = 1 WHERE id = ?", [rows[0].id]);
      res.json({ valid: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`🚀 Wise OS v3.2.2 démarré sur port ${PORT}`);
    console.log(`🔗 Endpoints de test disponibles :`);
    console.log(`   → GET  /status`);
    console.log(`   → POST /generate-otp`);
    console.log(`   → POST /send-message`);
    console.log(`   → GET  /connect`);
    
    connectWhatsApp(1);
  });
}

// Keep-alive
setInterval(() => {
  console.log(`[KEEP-ALIVE] Wise OS v3.2.2 • ${new Date().toISOString()}`);
}, 240000);

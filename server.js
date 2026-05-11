/**
 * WISE OS UNIFIED — server.js v3.3.2 FINAL
 * Dashboard complet + SSE corrigé + Stable sur Render
 */

import express from "express";
import cors from "cors";
import qrcode from "qrcode";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import fs from "fs";
import pino from "pino";

dotenv.config();

let makeWASocket, useMultiFileAuthState, DisconnectReason, delay;

(async () => {
  const baileys = await import("@whiskeysockets/baileys");
  makeWASocket = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  delay = baileys.delay;
  startServer();
})();

// ====================== CONFIG ======================
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.NODE_API_KEY;

const logger = pino({ level: 'silent' });

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 8,
  queueLimit: 0,
  connectTimeout: 20000,
  acquireTimeout: 20000,
});

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const sessions = new Map();
const sseClients = new Map();

const AUTH_DIR = './wa_auth';
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// ====================== DB HELPERS ======================
async function loadSessionFromDB(tenantId) {
  try {
    const [rows] = await pool.execute("SELECT session_data FROM whatsapp_sessions WHERE tenant_id = ? LIMIT 1", [tenantId]);
    return rows.length ? JSON.parse(rows[0].session_data) : null;
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
  const tid = String(tenantId || 1);

  if (sessions.has(tid)) {
    const old = sessions.get(tid);
    if (old?.sock?.end) try { old.sock.end(); } catch (_) {}
    sessions.delete(tid);
  }

  try {
    const saved = await loadSessionFromDB(tid);
    const { state, saveCreds } = await useMultiFileAuthState(`${AUTH_DIR}/${tid}`);

    if (saved) Object.assign(state.creds, saved);

    const sock = makeWASocket({
      auth: state,
      logger: logger,
      browser: ["Wise OS", "Chrome", "3.3"],
      printQRInTerminal: false,
      markOnlineOnConnect: false,
    });

    const sd = { sock, status: "connecting", qrBase64: null };
    sessions.set(tid, sd);

    sock.ev.on("creds.update", async () => {
      await saveCreds();
      await saveSessionToDB(tid, state.creds);
    });

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        sd.qrBase64 = await qrcode.toDataURL(qr, { width: 300 });
        sd.status = "qr_pending";
        broadcastSSE(tid, { type: "qr", qr: sd.qrBase64 });
      }

      if (connection === "open") {
        sd.status = "connected";
        sd.qrBase64 = null;
        broadcastSSE(tid, { type: "connected" });
        console.log(`✅ [WA] Tenant ${tid} connecté`);
      }

      if (connection === "close") {
        broadcastSSE(tid, { type: "disconnected" });
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) setTimeout(() => connectWhatsApp(tid), 12000);
      }
    });
  } catch (err) {
    console.error(`[WA Error] ${tid}:`, err.message);
  }
}

async function sendWA(tenantId, phone, text) {
  const tid = String(tenantId || 1);
  let sd = sessions.get(tid);

  if (!sd || sd.status !== "connected") {
    await connectWhatsApp(tid);
    await delay(3500);
    sd = sessions.get(tid);
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

// ====================== SSE CORRIGÉ ======================
function broadcastSSE(tenantId, data) {
  const clients = sseClients.get(String(tenantId));
  if (!clients) return;

  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of [...clients]) {   // copie pour éviter modification pendant boucle
    try {
      client.write(payload);
    } catch (e) {
      clients.delete(client);
    }
  }
}

// ====================== DASHBOARD HTML COMPLET ======================
const dashboardHTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wise OS - Dashboard Test</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px; }
    .container { max-width: 1100px; margin: auto; background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
    h1 { color: #2c3e50; }
    button { padding: 12px 20px; margin: 6px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; }
    .btn-blue { background: #3498db; color: white; }
    .btn-green { background: #27ae60; color: white; }
    pre { background: #2c3e50; color: #1abc9c; padding: 15px; border-radius: 8px; overflow: auto; max-height: 500px; }
    #qr { text-align: center; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🛡️ Wise OS Unified - Dashboard Test</h1>
    <p><strong>Statut :</strong> <span id="status">En attente...</span></p>

    <button class="btn-blue" onclick="connectWA()">🔄 Connecter WhatsApp (QR)</button>
    <button class="btn-green" onclick="sendTest()">📤 Envoyer Message Test</button>
    <button onclick="generateOTP()">🔑 Générer OTP</button>
    <button onclick="getStatus()">📊 Voir Status</button>

    <div id="qr"></div>
    <pre id="result">Cliquez sur un bouton pour tester...</pre>
  </div>

  <script>
    const base = window.location.origin;

    function connectWA() {
      const es = new EventSource(base + '/connect?tenant_id=1');
      es.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.type === "qr") {
          document.getElementById('qr').innerHTML = \`<img src="\${d.qr}" width="280">\`;
        }
        if (d.type === "connected") {
          document.getElementById('status').innerHTML = "✅ WhatsApp Connecté";
        }
      };
    }

    async function sendTest() {
      const phone = prompt("Numéro WhatsApp (ex: 237690000000) :");
      if (!phone) return;
      const res = await fetch(base + '/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message: "Test depuis le dashboard Wise OS" })
      });
      document.getElementById('result').textContent = JSON.stringify(await res.json(), null, 2);
    }

    async function generateOTP() {
      const phone = prompt("Numéro pour OTP :");
      if (!phone) return;
      const res = await fetch(base + '/generate-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, tenant_id: 1 })
      });
      document.getElementById('result').textContent = JSON.stringify(await res.json(), null, 2);
    }

    async function getStatus() {
      const res = await fetch(base + '/status');
      document.getElementById('result').textContent = JSON.stringify(await res.json(), null, 2);
    }
  </script>
</body>
</html>
`;

// ====================== SERVER ======================
async function startServer() {
  const app = express();
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "10mb" }));

  const auth = (req, res, next) => {
    if (!API_KEY) return next();
    const key = req.headers["x-api-key"] || req.body?._api_key;
    if (key !== API_KEY) return res.status(403).json({ error: "Unauthorized" });
    next();
  };

  app.get("/", (req, res) => res.send(dashboardHTML));

  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.3.2" }));

  app.get("/status", (req, res) => {
    const list = {};
    sessions.forEach((sd, id) => list[id] = { status: sd.status });
    res.json({ version: "3.3.2", activeSessions: sessions.size, sessions: list });
  });

  app.get("/connect", (req, res) => {
    const tid = String(req.query.tenant_id || 1);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    if (!sseClients.has(tid)) sseClients.set(tid, new Set());
    sseClients.get(tid).add(res);

    connectWhatsApp(tid);

    req.on("close", () => sseClients.get(tid)?.delete(res));
  });

  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, tenant_id = 1 } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const msg = `Votre code Wise OS est : ${code}. Ne le partagez pas.`;

    try {
      await pool.execute(
        `INSERT INTO otp_codes (tenant_id, recipient, code, type, expires_at, used)
         VALUES (?,?,?,?,?,0) ON DUPLICATE KEY UPDATE code=VALUES(code), expires_at=VALUES(expires_at), used=0`,
        [tenant_id, phone, code, "default", new Date(Date.now() + 10*60*1000)]
      );

      const sent = await sendWA(tenant_id, phone, msg);
      res.json({ success: true, code, sent_via: sent ? "whatsapp" : "failed" });
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Wise OS v3.3.2 démarré sur port ${PORT}`);
    console.log(`🌐 Dashboard disponible sur : https://wiseossmartsecurity.onrender.com`);
    setTimeout(() => connectWhatsApp(1), 10000);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

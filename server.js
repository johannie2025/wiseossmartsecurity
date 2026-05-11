/**
 * WISE OS UNIFIED — server.js v3.2.6
 * Version stable + Dashboard Test complet
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
    const [rows] = await pool.execute("SELECT session_data FROM whatsapp_sessions WHERE tenant_id = ? LIMIT 1", [tenantId]);
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

  // Nettoyage ultra-sécurisé
  if (sessions.has(tenantId)) {
    const old = sessions.get(tenantId);
    if (old?.sock?.end) {
      try { old.sock.end(); } catch (_) {}
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
          console.log(`[WA] 🔄 Reconnexion dans 12s (tenant ${tenantId})`);
          setTimeout(() => connectWhatsApp(tenantId), 12000);
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
const testHTML = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wise OS - Test Dashboard</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; }
    .container { max-width: 1100px; margin: auto; background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
    h1 { color: #2c3e50; }
    button { padding: 12px 18px; margin: 6px; border: none; border-radius: 6px; cursor: pointer; font-size: 15px; }
    .btn-blue { background: #3498db; color: white; }
    .btn-green { background: #2ecc71; color: white; }
    pre { background: #2c3e50; color: #1abc9c; padding: 15px; border-radius: 8px; overflow-x: auto; max-height: 400px; }
    #qr { text-align: center; margin: 20px 0; }
    .status { font-weight: bold; padding: 10px; border-radius: 6px; display: inline-block; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 Wise OS Unified - Dashboard de Test</h1>
    <p><strong>Service :</strong> https://wiseossmartsecurity.onrender.com</p>

    <div class="status" id="wa-status">WhatsApp Status : <span id="status-text">🔴 Déconnecté</span></div>
    <div id="qr"></div>

    <hr>
    <h2>Actions de Test</h2>
    <button class="btn-blue" onclick="connectWA()">🔄 Connecter WhatsApp (QR)</button>
    <button class="btn-green" onclick="sendTestMessage()">📤 Envoyer Message Test</button>
    <button onclick="generateOTP()">🔢 Générer & Envoyer OTP</button>
    <button onclick="getStatus()">📊 Status Serveur</button>

    <h3>Résultat</h3>
    <pre id="result">Cliquez sur un bouton...</pre>
  </div>

  <script>
    const base = window.location.origin;

    function connectSSE() {
      const es = new EventSource(base + '/connect?tenant_id=1');
      es.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.type === "qr") document.getElementById('qr').innerHTML = \`<img src="\${d.qr}" width="280">\`;
        if (d.type === "connected") {
          document.getElementById('status-text').innerHTML = "✅ Connecté";
          document.getElementById('status-text').style.color = "green";
        }
      };
    }

    async function connectWA() { 
      connectSSE(); 
      getStatus(); 
    }

    async function sendTestMessage() {
      const phone = prompt("Numéro WhatsApp (ex: 237690000000) :");
      if (!phone) return;
      const res = await fetch(base + '/send-message', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({phone, message: "Test depuis le dashboard Wise OS 🚀"})
      });
      document.getElementById('result').textContent = JSON.stringify(await res.json(), null, 2);
    }

    async function generateOTP() {
      const phone = prompt("Numéro pour OTP :");
      if (!phone) return;
      const res = await fetch(base + '/generate-otp', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({phone, tenant_id: 1})
      });
      document.getElementById('result').textContent = JSON.stringify(await res.json(), null, 2);
    }

    async function getStatus() {
      const res = await fetch(base + '/status');
      document.getElementById('result').textContent = JSON.stringify(await res.json(), null, 2);
    }

    window.onload = () => { connectSSE(); getStatus(); };
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
    if ((req.headers["x-api-key"] || req.body?._api_key) !== API_KEY) 
      return res.status(403).json({ error: "Unauthorized" });
    next();
  };

  app.get("/", (req, res) => res.send(testHTML));

  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.2.6" }));

  app.get("/status", auth, (req, res) => {
    const list = {};
    sessions.forEach((sd, id) => list[id] = { status: sd.status, lastActivity: new Date(sd.lastActivity).toISOString() });
    res.json({ version: "3.2.6", sessions: list, active: sessions.size });
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

  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, tenant_id = 1 } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    try {
      await pool.execute(
        `INSERT INTO otp_codes (tenant_id, recipient, code, type, expires_at, used)
         VALUES (?,?,?,?,?,0) ON DUPLICATE KEY UPDATE code=VALUES(code), expires_at=VALUES(expires_at), used=0`,
        [tenant_id, phone, code, "default", new Date(Date.now() + 10*60*1000)]
      );
      const sent = await sendWA(tenant_id, phone, `Votre code Wise OS : ${code}`);
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
    console.log(`🚀 Wise OS v3.2.6 démarré sur port ${PORT}`);
    console.log(`🌐 Dashboard disponible sur : https://wiseossmartsecurity.onrender.com`);
    connectWhatsApp(1);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

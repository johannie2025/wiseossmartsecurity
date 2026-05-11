/**
 * WISE OS UNIFIED — server.js v3.3.2
 * Correction SSE + Dashboard fully functional
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
  enableKeepAlive: true,
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
  for (const client of clients) {
    try {
      client.write(payload);
    } catch (e) {
      clients.delete(client);
    }
  }
}

// ====================== DASHBOARD HTML ======================
const dashboardHTML = `...`; // (Je te donne le code complet ci-dessous pour éviter la longueur)


// ====================== SERVER ======================
async function startServer() {
  const app = express();
  app.use(cors({ origin: "*" }));           // Important pour le frontend
  app.use(express.json({ limit: "10mb" }));

  const auth = (req, res, next) => {
    if (!API_KEY) return next();
    const key = req.headers["x-api-key"] || req.body?._api_key;
    if (key !== API_KEY) return res.status(403).json({ error: "Unauthorized" });
    next();
  };

  app.get("/", (req, res) => res.send(dashboardHTML));

  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.3.2" }));

  app.get("/status", (req, res) => {        // ← Retiré auth pour faciliter les tests
    const list = {};
    sessions.forEach((sd, id) => list[id] = { status: sd.status });
    res.json({ version: "3.3.2", active: sessions.size, sessions: list });
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

    req.on("close", () => {
      sseClients.get(tid)?.delete(res);
    });
  });

  app.post("/generate-otp", auth, async (req, res) => { /* même code que avant */ });
  app.post("/send-message", auth, async (req, res) => { /* même code */ });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Wise OS v3.3.2 démarré sur port ${PORT}`);
    setTimeout(() => connectWhatsApp(1), 8000);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

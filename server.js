/**
 * WISE OS UNIFIED — server.js v3.3.1
 * Architecture Robuste : WhatsApp + Email + MySQL + Dashboard
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

// ====================== Baileys Dynamic Import ======================
let makeWASocket, useMultiFileAuthState, DisconnectReason, delay;
(async () => {
  const baileys = await import("@whiskeysockets/baileys");
  makeWASocket = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  delay = baileys.delay;
  startServer();
})();

// ====================== CONFIG & I18N ======================
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.NODE_API_KEY;
const logger = pino({ level: 'silent' });

const i18n = {
  fr: {
    otp: (c) => `Votre code de sécurité Wise OS est : ${c}. Ne le partagez pas.`,
    welcome: "Bienvenue sur Wise OS Smart Security."
  },
  en: {
    otp: (c) => `Your Wise OS security code is: ${c}. Do not share it.`,
    welcome: "Welcome to Wise OS Smart Security."
  }
};

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 30000
});

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const sessions = new Map();
const sseClients = new Map();

// ====================== DB HELPERS ======================
async function loadSessionFromDB(tenantId) {
  try {
    const [rows] = await pool.execute("SELECT session_data FROM whatsapp_sessions WHERE tenant_id = ? LIMIT 1", [tenantId]);
    return rows.length ? JSON.parse(rows[0].session_data) : null;
  } catch (e) { console.error("[DB Load]", e.message); return null; }
}

async function saveSessionToDB(tenantId, creds) {
  try {
    await pool.execute(
      `INSERT INTO whatsapp_sessions (tenant_id, session_data, updated_at) 
       VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE session_data = VALUES(session_data), updated_at = NOW()`,
      [tenantId, JSON.stringify(creds)]
    );
  } catch (e) { console.error("[DB Save]", e.message); }
}

// ====================== WHATSAPP CORE ======================
async function connectWhatsApp(tenantId) {
  const tid = String(tenantId);
  if (sessions.has(tid)) {
    const old = sessions.get(tid);
    try { old?.sock?.end(); } catch (_) {}
    sessions.delete(tid);
  }

  const saved = await loadSessionFromDB(tid);
  const { state, saveCreds } = await useMultiFileAuthState(`./wa_auth/${tid}`);
  if (saved) Object.assign(state.creds, saved);

  const sock = makeWASocket({
    auth: state,
    logger: logger,
    browser: ["Wise OS", "Chrome", "3.3"],
    printQRInTerminal: false
  });

  const sd = { sock, status: "connecting", qrBase64: null };
  sessions.set(tid, sd);

  sock.ev.on("creds.update", async () => {
    await saveCreds();
    await saveSessionToDB(tid, state.creds);
  });

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      sd.qrBase64 = await qrcode.toDataURL(qr);
      sd.status = "qr_pending";
      broadcastSSE(tid, { type: "qr", qr: sd.qrBase64 });
    }
    if (connection === "open") {
      sd.status = "connected";
      broadcastSSE(tid, { type: "connected" });
      console.log(`✅ [WA] Tenant ${tid} connecté`);
    }
    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(() => connectWhatsApp(tid), 12000);
    }
  });
}

function broadcastSSE(tenantId, data) {
  const clients = sseClients.get(String(tenantId));
  if (clients) clients.forEach(c => c.write(`data: ${JSON.stringify(data)}\n\n`));
}

// ====================== SERVER START ======================
async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const auth = (req, res, next) => {
    const key = req.headers["x-api-key"] || req.body?._api_key;
    if (API_KEY && key !== API_KEY) return res.status(403).json({ error: "Unauthorized" });
    next();
  };

  // Route Dashboard
  app.get("/", (req, res) => {
    res.send(`<h1>🛡️ Wise OS Unified Dashboard</h1><p>Service is Live.</p><p>Go to /connect to scan QR.</p>`);
  });

  app.get("/health", (_, res) => res.json({ status: "ok", port: PORT }));

  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, email, tenant_id = 1, lang = "fr" } = req.body;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const msg = i18n[lang]?.otp(code) || i18n.fr.otp(code);

    try {
      await pool.execute(
        "INSERT INTO otp_codes (tenant_id, recipient, code, expires_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE code=VALUES(code), used=0",
        [tenant_id, phone || email, code, new Date(Date.now() + 600000)]
      );

      let waSent = false;
      const sd = sessions.get(String(tenant_id));
      if (sd?.status === "connected" && phone) {
        const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";
        await sd.sock.sendMessage(jid, { text: msg });
        waSent = true;
      }

      if (!waSent && email) {
        await mailer.sendMail({ from: process.env.SMTP_USER, to: email, subject: "Code Wise OS", text: msg });
      }

      res.json({ success: true, method: waSent ? "whatsapp" : "email", code: (process.env.NODE_ENV !== 'production' ? code : undefined) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/connect", (req, res) => {
    const tid = req.query.tenant_id || 1;
    res.setHeader("Content-Type", "text/event-stream");
    res.flushHeaders();
    if (!sseClients.has(tid)) sseClients.set(tid, new Set());
    sseClients.get(tid).add(res);
    connectWhatsApp(tid);
    req.on("close", () => sseClients.get(tid)?.delete(res));
  });

  // Lancement effectif
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur actif sur port ${PORT}`);
    setTimeout(() => {
        connectWhatsApp(1).catch(err => console.log("Attente DB..."));
    }, 5000);
  });
}

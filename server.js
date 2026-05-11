/**
 * WISE OS UNIFIED — server.js v3.3.4 ULTRA COMPLETE
 * Toutes les routes du Dashboard + BD alignée + Stable
 */

import express    from "express";
import cors       from "cors";
import qrcode     from "qrcode";
import mysql      from "mysql2/promise";
import nodemailer from "nodemailer";
import dotenv     from "dotenv";
import fs         from "fs";
import pino       from "pino";
import { dashboardHTML } from "./dashboard.js";

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

// ====================== I18N (garde ton objet complet) ======================
const i18n = { /* Colle ici tout ton grand objet i18n de la version précédente */ };

function detectLang(req) {
  const p = req.query?.lang || req.body?.lang;
  if (p && i18n[p]) return p;
  const h = (req.headers["accept-language"] || "fr").split(",")[0].split("-")[0].toLowerCase();
  return i18n[h] ? h : "fr";
}

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
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 20000,
  acquireTimeout: 20000,
  charset: "utf8mb4",
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

// ====================== DB + WA HELPERS ======================
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
      logger,
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
        if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut)
          setTimeout(() => connectWhatsApp(tid), 12000);
      }
    });
  } catch (e) { console.error(`[WA] ${tid}:`, e.message); }
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
  } catch (e) { console.error("[sendWA]", e.message); return false; }
}

async function sendEmail(to, subject, html) {
  try {
    await mailer.sendMail({ from: `"Wise OS" <${process.env.SMTP_USER}>`, to, subject, html });
    return true;
  } catch (e) { console.error("[Email]", e.message); return false; }
}

function broadcastSSE(tenantId, data) {
  const clients = sseClients.get(String(tenantId));
  if (!clients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of [...clients]) {
    try { client.write(payload); } catch (_) { clients.delete(client); }
  }
}

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

  app.get("/", (_, res) => res.send(dashboardHTML));
  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.3.4" }));
  app.get("/status", (_, res) => {
    const list = {};
    sessions.forEach((sd, id) => list[id] = { status: sd.status });
    res.json({ version: "3.3.4", activeSessions: sessions.size, sessions: list });
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

  // ====================== TOUTES LES ROUTES DU DASHBOARD ======================
  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, tenant_id = 1, type = "default", ref_name = "" } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const lang = detectLang(req);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    try {
      await pool.execute(
        `INSERT INTO otp_codes (tenant_id, recipient, code, type, expires_at, used)
         VALUES (?,?,?,?,?,0) ON DUPLICATE KEY UPDATE code=VALUES(code), expires_at=VALUES(expires_at), used=0`,
        [tenant_id, phone, code, type, expires]
      );

      const otpFn = i18n[lang]?.otp?.[type] || i18n.fr?.otp?.default;
      if (otpFn) await sendWA(tenant_id, phone, otpFn(code, ref_name));

      res.json({ success: true, code, expires_in: 600 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/validate-otp", auth, async (req, res) => {
    const { phone, code, context = "default", tenant_id = 1 } = req.body;
    if (!phone || !code) return res.status(400).json({ error: "phone et code requis" });

    try {
      const [rows] = await pool.execute(
        `SELECT id FROM otp_codes WHERE tenant_id=? AND recipient=? AND code=? AND type=? 
         AND used=0 AND expires_at > NOW() LIMIT 1`,
        [tenant_id, phone, code, context]
      );
      if (!rows.length) return res.status(401).json({ valid: false });

      await pool.execute("UPDATE otp_codes SET used=1 WHERE id=?", [rows[0].id]);
      res.json({ valid: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/send-message", auth, async (req, res) => {
    const { phone, message, tenant_id = 1 } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "phone et message requis" });
    const sent = await sendWA(tenant_id, phone, message);
    res.json({ success: sent });
  });

  app.post("/send-magic", auth, async (req, res) => {
    const { email, link, name = "", tenant_id = 1 } = req.body;
    if (!email || !link) return res.status(400).json({ error: "email et link requis" });
    const lang = detectLang(req);
    const sent = await sendEmail(email, i18n[lang].magic.subject, i18n[lang].magic.html(link, name));
    res.json({ success: sent });
  });

  app.post("/send-scan-notification", auth, async (req, res) => {
    const { phone, name = "", action = "validation", tenant_id = 1 } = req.body;
    const lang = detectLang(req);
    const time = new Date().toLocaleTimeString();
    const message = (i18n[lang]?.scan?.[action] || i18n.fr.scan.validation)(name, time);
    const sent = await sendWA(tenant_id, phone, message);
    res.json({ success: true, whatsapp: sent });
  });

  app.post("/send-sos-alert", auth, async (req, res) => {
    const { phone, email, patient_name, blood_type, allergies, tenant_id = 1 } = req.body;
    const lang = detectLang(req);
    const waSent = phone ? await sendWA(tenant_id, phone, i18n[lang].sos.wa(patient_name, blood_type, allergies)) : false;
    const emailSent = email ? await sendEmail(email, i18n[lang].sos.subject(patient_name), `<h2>${i18n[lang].sos.subject(patient_name)}</h2>`) : false;
    res.json({ success: true, whatsapp: waSent, email: emailSent });
  });

  app.post("/notify-subscription", auth, async (req, res) => {
    const { phone, email, amount, currency = "XAF", tenant_id = 1 } = req.body;
    const lang = detectLang(req);
    const message = i18n[lang].sub.ok(amount, currency);
    const waSent = phone ? await sendWA(tenant_id, phone, message) : false;
    const emailSent = email ? await sendEmail(email, "🎉 Abonnement activé", `<h2>${message}</h2>`) : false;
    res.json({ success: true, whatsapp: waSent, email: emailSent });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Wise OS v3.3.4 ULTRA COMPLETE démarré sur port ${PORT}`);
    setTimeout(() => connectWhatsApp(1), 10000);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

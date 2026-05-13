/**
 * WISE OS UNIFIED — server.js v3.3.5 FULL EXHAUSTIVE
 * Toutes les fonctionnalités + Nodemailer + Baileys + PHP Proxy (/lib/db)
 * Optimisé Render + Logs détaillés
 */

import express    from "express";
import cors       from "cors";
import qrcode     from "qrcode";
import dotenv     from "dotenv";
import fs         from "fs";
import pino       from "pino";
import nodemailer from "nodemailer";
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

// ====================== CONFIG ======================
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.NODE_API_KEY;
const PHP_BACKEND = process.env.PHP_BACKEND_URL || "https://wisedesign.pro/wiseos/";

console.log(`[INFO] PHP Backend: ${PHP_BACKEND}`);
console.log(`[INFO] NODE_SECRET présent: ${!!process.env.NODE_SECRET}`);

const logger = pino({ level: 'silent' });

const sessions = new Map();
const sseClients = new Map();
const AUTH_DIR = './wa_auth';

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// ====================== NODEMAILER ======================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// ====================== PHP PROXY ======================
async function phpRequest(payload = {}) {
  try {
    const url = `${PHP_BACKEND.replace(/\/$/, '')}/lib/db`;
    console.log(`[PHP Proxy] → ${url} | action=${payload.action}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Node-Secret': process.env.NODE_SECRET || 'default_secret'
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    console.log(`[PHP Proxy] ← Status: ${res.status}`);

    try {
      return JSON.parse(text);
    } catch {
      return { success: false, raw: text };
    }
  } catch (e) {
    console.error(`[PHP Proxy] CRITICAL FETCH FAILED:`, e.message);
    return { success: false, error: e.message };
  }
}

// ====================== DB PROXY ======================
async function saveOTP(tenantId, phone, code, type = "default") {
  return phpRequest({ action: 'save_otp', tenant_id: tenantId, recipient: phone, code, type });
}

async function validateOTPFromDB(tenantId, phone, code, type = "default") {
  return phpRequest({ action: 'validate_otp', tenant_id: tenantId, recipient: phone, code, type });
}

async function loadSessionFromDB(tenantId) {
  const res = await phpRequest({ action: 'load_session', tenant_id: tenantId });
  return res.success && res.data ? res.data : null;
}

async function saveSessionToDB(tenantId, creds) {
  return phpRequest({ action: 'save_session', tenant_id: tenantId, session_data: creds });
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
      logger,
      browser: ["Wise OS", "Chrome", "3.3.5"],
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
        sd.qrBase64 = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
        sd.status = "qr_pending";
        broadcastSSE(tid, { type: "qr", qr: sd.qrBase64 });
        console.log(`📱 QR Code généré pour tenant ${tid}`);
      }
      if (connection === "open") {
        sd.status = "connected";
        sd.qrBase64 = null;
        broadcastSSE(tid, { type: "connected" });
        console.log(`✅ [WA] Tenant ${tid} CONNECTÉ`);
      }
      if (connection === "close") {
        broadcastSSE(tid, { type: "disconnected" });
        if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
          setTimeout(() => connectWhatsApp(tid), 12000);
        }
      }
    });
  } catch (e) { console.error(`[WA ${tid}]`, e.message); }
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
  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.3.5", mode: "full" }));
  app.get("/status", (_, res) => {
    const list = {};
    sessions.forEach((sd, id) => list[id] = { status: sd.status });
    res.json({ version: "3.3.5", activeSessions: sessions.size, sessions: list });
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

  // ====================== TOUTES LES ROUTES ======================
  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, tenant_id = 1, type = "default" } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await saveOTP(tenant_id, phone, code, type);
    await sendWA(tenant_id, phone, `Votre code Wise OS est : ${code}`);

    res.json({ success: true, code });
  });

  app.post("/validate-otp", auth, async (req, res) => {
    const { phone, code, context = "default", tenant_id = 1 } = req.body;
    if (!phone || !code) return res.status(400).json({ error: "phone et code requis" });

    const result = await validateOTPFromDB(tenant_id, phone, code, context);
    res.json(result);
  });

  app.post("/send-message", auth, async (req, res) => {
    const { phone, message, tenant_id = 1 } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "phone et message requis" });
    const sent = await sendWA(tenant_id, phone, message);
    res.json({ success: sent });
  });

  app.post("/send-magic", auth, async (req, res) => {
    const { email, link, name = "" } = req.body;
    if (!email || !link) return res.status(400).json({ error: "email et link requis" });

    const html = `<h2>Bonjour ${name},</h2><p>Cliquez sur le lien pour vous connecter :</p><a href="${link}">Se connecter à Wise OS</a>`;
    await transporter.sendMail({
      from: `"Wise OS" <no-reply@wisedesign.pro>`,
      to: email,
      subject: "Votre lien de connexion - Wise OS",
      html
    });

    res.json({ success: true, message: "Magic link envoyé par email" });
  });

  app.post("/send-scan-notification", auth, async (req, res) => {
    const { phone, name = "", action = "validation", tenant_id = 1 } = req.body;
    const message = `✅ ${action} enregistré : ${name}`;
    const sent = await sendWA(tenant_id, phone, message);
    res.json({ success: true, whatsapp: sent });
  });

  app.post("/send-sos-alert", auth, async (req, res) => {
    const { phone, patient_name = "Patient", blood_type = "?", allergies = "?" } = req.body;
    const message = `🚨 SOS MÉDICAL\nPatient: ${patient_name}\nGroupe sanguin: ${blood_type}\nAllergies: ${allergies}`;
    const sent = await sendWA(1, phone, message);
    res.json({ success: true, whatsapp: sent });
  });

  app.post("/notify-subscription", auth, async (req, res) => {
    const { phone, amount = 0, currency = "XAF" } = req.body;
    const message = `🎉 Abonnement Pro activé ! ${amount} ${currency} - Merci pour votre confiance !`;
    const sent = await sendWA(1, phone, message);
    res.json({ success: true, whatsapp: sent });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Wise OS v3.3.5 FULL EXHAUSTIVE démarré sur port ${PORT}`);
    setTimeout(() => connectWhatsApp(1), 6000);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

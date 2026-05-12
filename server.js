/**
 * WISE OS UNIFIED — server.js v3.3.5 FINAL
 * Toutes les routes du Dashboard + Proxy PHP complet
 */

import express    from "express";
import cors       from "cors";
import qrcode     from "qrcode";
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

// ====================== CONFIG ======================
// ====================== CONFIG ======================
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.NODE_API_KEY;

// Configuration PHP (utilise la variable d'environnement ou la config par défaut)
const PHP_BACKEND = process.env.PHP_BACKEND_URL 
    || "https://wisedesign.pro/wiseos/";   // ← Doit pointer vers le dossier contenant db.php

console.log(`[INFO] PHP Backend URL: ${PHP_BACKEND}`);

const logger = pino({ level: 'silent' });

const sessions = new Map();
const sseClients = new Map();

const AUTH_DIR = './wa_auth';
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// ====================== PROXY PHP ======================
async function phpRequest(endpoint, payload = {}) {
  try {
    const base = PHP_BACKEND.replace(/\/$/, '');
    const cleanEndpoint = endpoint.replace(/^\//, '');
    const url = `${base}/${cleanEndpoint}`;

    console.log(`[PHP Proxy] → ${url}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Node-Secret': process.env.NODE_SECRET || 'default_secret'
      },
      body: JSON.stringify(payload)
    });

    console.log(`[PHP Proxy] Status: ${res.status}`);

    const text = await res.text();
    console.log(`[PHP Proxy] Raw response: ${text.substring(0, 300)}...`);

    return JSON.parse(text);
  } catch (e) {
    console.error(`[PHP Proxy ${endpoint}] ERROR:`, e.message);
    return { success: false, error: e.message };
  }
}

// ====================== DB PROXY ======================
// async function saveOTP(tenantId, phone, code, type = "default") {
  // return phpRequest('db.php', { action: 'save_otp', tenant_id: tenantId, recipient: phone, code, type });
// }

// async function validateOTPFromDB(tenantId, phone, code, type = "default") {
  // return phpRequest('db.php', { action: 'validate_otp', tenant_id: tenantId, recipient: phone, code, type });
// }

// async function loadSessionFromDB(tenantId) {
  // const res = await phpRequest('db.php', { action: 'load_session', tenant_id: tenantId });
  // return res.success && res.data ? res.data : null;
// }

// async function saveSessionToDB(tenantId, creds) {
  // await phpRequest('db.php', { action: 'save_session', tenant_id: tenantId, session_data: creds });
// }

// Remplace les anciennes fonctions DB Proxy
import { saveOTP, validateOTP, loadSession, saveSession } from './core/db.js';

// ====================== DB DIRECT (Prioritaire) ======================
async function saveOTPDirect(tenantId, phone, code, type = "default") {
  try {
    return await saveOTP(tenantId, phone, code, type);
  } catch (e) {
    console.warn('[DB Direct] Failed, trying PHP fallback');
    return phpRequest('db.php', { action: 'save_otp', tenant_id: tenantId, recipient: phone, code, type });
  }
}

async function validateOTPDirect(tenantId, phone, code, type = "default") {
  try {
    return await validateOTP(tenantId, phone, code, type);
  } catch (e) {
    console.warn('[DB Direct] Failed, trying PHP fallback');
    return phpRequest('db.php', { action: 'validate_otp', tenant_id: tenantId, recipient: phone, code, type });
  }
}

async function loadSessionFromDB(tenantId) {
  try {
    return await loadSession(tenantId);
  } catch (e) {
    console.warn('[DB Direct] Failed, trying PHP fallback');
    const res = await phpRequest('db.php', { action: 'load_session', tenant_id: tenantId });
    return res.success && res.data ? res.data : null;
  }
}

async function saveSessionToDB(tenantId, creds) {
  try {
    await saveSession(tenantId, creds);
  } catch (e) {
    console.warn('[DB Direct] Failed, trying PHP fallback');
    await phpRequest('db.php', { action: 'save_session', tenant_id: tenantId, session_data: creds });
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
        sd.qrBase64 = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
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
  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.3.5", mode: "php_proxy" }));
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

  // ====================== TOUTES LES ROUTES DU DASHBOARD ======================
  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, tenant_id = 1, type = "default", ref_name = "" } = req.body;
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
    res.json({ success: true, message: "Magic link envoyé" });
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
    console.log(`🚀 Wise OS v3.3.5 FULL (PHP Proxy) démarré sur port ${PORT}`);
    setTimeout(() => connectWhatsApp(1), 10000);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

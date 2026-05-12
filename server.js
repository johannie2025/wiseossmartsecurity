/**
 * WISE OS UNIFIED — server.js v3.3.5 FINAL
 * Direct MySQL + PHP Proxy Fallback
 */

import express    from "express";
import cors       from "cors";
import qrcode     from "qrcode";
import dotenv     from "dotenv";
import fs         from "fs";
import pino       from "pino";
import mysql      from 'mysql2/promise';
import { dashboardHTML } from "./dashboard.js";

dotenv.config();

let makeWASocket, useMultiFileAuthState, DisconnectReason, delay;

// ====================== CONFIG ======================
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.NODE_API_KEY;
const PHP_BACKEND = process.env.PHP_BACKEND_URL || "https://wisedesign.pro/wiseos/";

console.log(`[INFO] PHP Backend URL: ${PHP_BACKEND}`);

// ====================== DIRECT DB (mysql2) ======================
let dbPool = null;

async function initDB() {
  try {
    dbPool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 8,
      queueLimit: 0,
      connectTimeout: 15000,
    });
    console.log("✅ [DB Direct] Pool MySQL initialisé avec succès");
  } catch (e) {
    console.error("❌ [DB Direct] Échec d'initialisation:", e.message);
  }
}

async function dbQuery(sql, params = []) {
  if (!dbPool) throw new Error("DB Pool non initialisé");
  const [rows] = await dbPool.execute(sql, params);
  return rows;
}

// ====================== DB FUNCTIONS (Direct + Fallback) ======================
async function saveOTP(tenantId, phone, code, type = "default") {
  try {
    const sql = `INSERT INTO otp_codes (tenant_id, recipient, code, type, expires_at, used)
                 VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0)
                 ON DUPLICATE KEY UPDATE code=VALUES(code), expires_at=VALUES(expires_at), used=0`;
    await dbQuery(sql, [tenantId, phone, code, type]);
    return true;
  } catch (e) {
    console.warn(`[DB Direct] saveOTP failed → PHP fallback`);
    return phpRequest('db.php', { action: 'save_otp', tenant_id: tenantId, recipient: phone, code, type });
  }
}

async function validateOTPFromDB(tenantId, phone, code, type = "default") {
  try {
    const sql = `SELECT id FROM otp_codes WHERE tenant_id=? AND recipient=? AND code=? AND type=? 
                 AND used=0 AND expires_at > NOW() LIMIT 1`;
    const rows = await dbQuery(sql, [tenantId, phone, code, type]);
    if (rows.length > 0) {
      await dbQuery("UPDATE otp_codes SET used=1 WHERE id=?", [rows[0].id]);
      return { valid: true };
    }
    return { valid: false };
  } catch (e) {
    console.warn(`[DB Direct] validateOTP failed → PHP fallback`);
    return phpRequest('db.php', { action: 'validate_otp', tenant_id: tenantId, recipient: phone, code, type });
  }
}

async function loadSessionFromDB(tenantId) {
  try {
    const rows = await dbQuery("SELECT session_data FROM whatsapp_sessions WHERE tenant_id = ? LIMIT 1", [tenantId]);
    return rows.length ? JSON.parse(rows[0].session_data) : null;
  } catch (e) {
    console.warn(`[DB Direct] loadSession failed → PHP fallback`);
    const res = await phpRequest('db.php', { action: 'load_session', tenant_id: tenantId });
    return res.success && res.data ? res.data : null;
  }
}

async function saveSessionToDB(tenantId, creds) {
  try {
    const data = JSON.stringify(creds);
    await dbQuery(`INSERT INTO whatsapp_sessions (tenant_id, session_data) 
                   VALUES (?, ?) ON DUPLICATE KEY UPDATE session_data = VALUES(session_data)`, 
                  [tenantId, data]);
  } catch (e) {
    console.warn(`[DB Direct] saveSession failed → PHP fallback`);
    await phpRequest('db.php', { action: 'save_session', tenant_id: tenantId, session_data: creds });
  }
}

// ====================== PHP PROXY (Fallback) ======================
async function phpRequest(endpoint, payload = {}) {
  try {
    const base = PHP_BACKEND.replace(/\/$/, '');
    const url = `${base}/${endpoint.replace(/^\//, '')}`;

    console.log(`[PHP Proxy] → ${url}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Node-Secret': process.env.NODE_SECRET || 'default_secret'
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { success: false, raw: text }; }
    console.log(`[PHP Proxy] ← ${endpoint} | Status: ${res.status}`);
    return data;
  } catch (e) {
    console.error(`[PHP Proxy ${endpoint}] FAILED:`, e.message);
    return { success: false, error: e.message };
  }
}

// ====================== WHATSAPP ======================
const logger = pino({ level: 'silent' });
const sessions = new Map();
const sseClients = new Map();
const AUTH_DIR = './wa_auth';

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// ... (Tout le reste de ton code WhatsApp reste identique : connectWhatsApp, sendWA, broadcastSSE, etc.)
// Je te le remets complet ci-dessous pour éviter toute coupure.

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
  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.3.5", mode: "direct_db" }));
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

  // ====================== ROUTES DASHBOARD ======================
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

  // Autres routes conservées
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
    console.log(`🚀 Wise OS v3.3.5 FULL démarré sur port ${PORT}`);
    setTimeout(() => connectWhatsApp(1), 10000);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

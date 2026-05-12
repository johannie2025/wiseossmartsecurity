/**
 * WISE OS UNIFIED — server.js v3.3.5 TEST
 * PHP Proxy Prioritaire + Stockage Temporaire Render
 */

import express    from "express";
import cors       from "cors";
import qrcode     from "qrcode";
import dotenv     from "dotenv";
import fs         from "fs";
import pino       from "pino";
import { dashboardHTML } from "./dashboard.js";

dotenv.config();

const PORT = process.env.PORT || 10000;
const PHP_BACKEND = "https://wisedesign.pro/wiseos/";

console.log(`[INFO] PHP Backend: ${PHP_BACKEND}`);

// ====================== PHP PROXY ======================
async function phpRequest(endpoint, payload = {}) {
  try {
    const url = `${PHP_BACKEND.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
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
    console.log(`[PHP Proxy] ← Status: ${res.status}`);

    try {
      return JSON.parse(text);
    } catch {
      return { success: false, raw: text };
    }
  } catch (e) {
    console.error(`[PHP Proxy] CRITICAL ERROR:`, e.message);
    return { success: false, error: e.message };
  }
}

// ====================== DB PROXY (via PHP) ======================
async function saveOTP(tenantId, phone, code, type = "default") {
  return phpRequest('db.php', { action: 'save_otp', tenant_id: tenantId, recipient: phone, code, type });
}

async function validateOTPFromDB(tenantId, phone, code, type = "default") {
  return phpRequest('db.php', { action: 'validate_otp', tenant_id: tenantId, recipient: phone, code, type });
}

async function loadSessionFromDB(tenantId) {
  const res = await phpRequest('db.php', { action: 'load_session', tenant_id: tenantId });
  return res.success && res.data ? res.data : null;
}

async function saveSessionToDB(tenantId, creds) {
  return phpRequest('db.php', { action: 'save_session', tenant_id: tenantId, session_data: creds });
}

// ====================== WHATSAPP ======================
let makeWASocket, useMultiFileAuthState, DisconnectReason, delay;

(async () => {
  const baileys = await import("@whiskeysockets/baileys");
  makeWASocket = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  delay = baileys.delay;
  startServer();
})();

const logger = pino({ level: 'silent' });
const sessions = new Map();
const sseClients = new Map();
const AUTH_DIR = './wa_auth';

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// (Le reste du code WhatsApp reste identique à ta version originale)
async function connectWhatsApp(tenantId) { /* ... ton code original ... */ }
async function sendWA(tenantId, phone, text) { /* ... ton code original ... */ }
function broadcastSSE(tenantId, data) { /* ... ton code original ... */ }

// ====================== SERVER ======================
async function startServer() {
  const app = express();
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "10mb" }));

  const auth = (req, res, next) => {
    if (!process.env.NODE_API_KEY) return next();
    const key = req.headers["x-api-key"] || req.body?._api_key;
    if (key !== process.env.NODE_API_KEY) return res.status(403).json({ error: "Unauthorized" });
    next();
  };

  app.get("/", (_, res) => res.send(dashboardHTML));
  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.3.5", mode: "php_proxy_test" }));

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

  // Routes principales
  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, tenant_id = 1 } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await saveOTP(tenant_id, phone, code);
    await sendWA(tenant_id, phone, `Votre code Wise OS est : ${code}`);

    res.json({ success: true, code });
  });

  app.post("/validate-otp", auth, async (req, res) => {
    const { phone, code, tenant_id = 1 } = req.body;
    if (!phone || !code) return res.status(400).json({ error: "phone et code requis" });

    const result = await validateOTPFromDB(tenant_id, phone, code);
    res.json(result);
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Wise OS Test Mode démarré sur port ${PORT}`);
    setTimeout(() => connectWhatsApp(1), 5000);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

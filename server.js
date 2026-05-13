/**
 * WISE OS UNIFIED — server.js v3.3.5 FULL ALIGNED
 * Compatible avec index.php + structure actuelle
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

// ====================== CONFIG ======================
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.NODE_API_KEY;
const PHP_BACKEND = process.env.PHP_BACKEND_URL || "https://wisedesign.pro/wiseos/";

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
    pass: process.env.SMTP_PASS,
  }
});

// ====================== PHP PROXY (aligné avec index.php) ======================
async function phpRequest(endpoint, payload = {}) {
  try {
    const url = `${PHP_BACKEND.replace(/\/$/, '')}/lib/db`;  // ← Important : /lib/db
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
    let data;
    try { data = JSON.parse(text); } catch { data = { success: false, raw: text }; }
    console.log(`[PHP Proxy] ← Status: ${res.status} | success: ${data.success}`);
    return data;
  } catch (e) {
    console.error(`[PHP Proxy] FAILED:`, e.message);
    return { success: false, error: e.message };
  }
}

// ====================== DB PROXY ======================
async function saveOTP(tenantId, phone, code, type = "default") {
  return phpRequest('', { action: 'save_otp', tenant_id: tenantId, recipient: phone, code, type });
}

async function validateOTPFromDB(tenantId, phone, code, type = "default") {
  return phpRequest('', { action: 'validate_otp', tenant_id: tenantId, recipient: phone, code, type });
}

async function loadSessionFromDB(tenantId) {
  const res = await phpRequest('', { action: 'load_session', tenant_id: tenantId });
  return res.success && res.data ? res.data : null;
}

async function saveSessionToDB(tenantId, creds) {
  await phpRequest('', { action: 'save_session', tenant_id: tenantId, session_data: creds });
}

// ====================== WHATSAPP ======================
async function connectWhatsApp(tenantId) { /* ... ton code original complet ... */ }
async function sendWA(tenantId, phone, text) { /* ... ton code original ... */ }
function broadcastSSE(tenantId, data) { /* ... ton code original ... */ }

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

  // Routes principales
  app.get("/", (_, res) => res.send(dashboardHTML));
  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.3.5" }));
  app.get("/connect", (req, res) => { /* ... ton code SSE original ... */ });

  app.post("/generate-otp", auth, async (req, res) => { /* ... */ });
  app.post("/validate-otp", auth, async (req, res) => { /* ... */ });
  app.post("/send-message", auth, async (req, res) => { /* ... */ });
  app.post("/send-magic", auth, async (req, res) => { /* ... */ });
  app.post("/send-scan-notification", auth, async (req, res) => { /* ... */ });
  app.post("/send-sos-alert", auth, async (req, res) => { /* ... */ });
  app.post("/notify-subscription", auth, async (req, res) => { /* ... */ });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Wise OS v3.3.5 FULL (PHP Aligned) démarré sur ${PORT}`);
    setTimeout(() => connectWhatsApp(1), 8000);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

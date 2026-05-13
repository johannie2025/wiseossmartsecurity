/**
 * WISE OS UNIFIED — server.js v3.3.5 TEMPORARY STORAGE
 * Mode Render (stockage local) - Sans PHP Proxy
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

// ====================== WHATSAPP ======================
async function connectWhatsApp(tenantId) {
  const tid = String(tenantId || 1);
  
  if (sessions.has(tid)) {
    const old = sessions.get(tid);
    if (old?.sock?.end) try { old.sock.end(); } catch (_) {}
    sessions.delete(tid);
  }

  try {
    console.log(`[WA] Connexion en cours pour tenant ${tid}...`);

    const { state, saveCreds } = await useMultiFileAuthState(`${AUTH_DIR}/${tid}`);

    const sock = makeWASocket({
      auth: state,
      logger,
      browser: ["Wise OS", "Chrome", "3.3.5"],
      printQRInTerminal: false,
      markOnlineOnConnect: false,
    });

    const sd = { sock, status: "connecting", qrBase64: null };
    sessions.set(tid, sd);

    sock.ev.on("creds.update", saveCreds);

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
        console.log(`✅ [WA] Tenant ${tid} CONNECTÉ AVEC SUCCÈS`);
      }
      if (connection === "close") {
        broadcastSSE(tid, { type: "disconnected" });
        if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
          setTimeout(() => connectWhatsApp(tid), 10000);
        }
      }
    });
  } catch (e) {
    console.error(`[WA ${tid}] Erreur:`, e.message);
  }
}

async function sendWA(tenantId, phone, text) {
  const tid = String(tenantId || 1);
  let sd = sessions.get(tid);

  if (!sd || sd.status !== "connected") {
    console.log(`[WA] Session ${tid} non connectée, tentative de reconnexion...`);
    await connectWhatsApp(tid);
    await delay(4000);
    sd = sessions.get(tid);
  }

  if (!sd?.sock) return false;

  try {
    const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";
    await sd.sock.sendMessage(jid, { text });
    console.log(`📤 Message envoyé à ${phone}`);
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

  app.get("/", (_, res) => res.send(dashboardHTML));
  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.3.5", mode: "temporary_storage" }));

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
  app.post("/generate-otp", async (req, res) => {
    const { phone, tenant_id = 1 } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const sent = await sendWA(tenant_id, phone, `Votre code Wise OS est : ${code}`);

    res.json({ success: true, code, sent });
  });

  app.post("/send-message", async (req, res) => {
    const { phone, message, tenant_id = 1 } = req.body;
    if (!phone || !message) return res.status(400).json({ error: "phone et message requis" });
    const sent = await sendWA(tenant_id, phone, message);
    res.json({ success: sent });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Wise OS Temporary Storage Mode démarré sur port ${PORT}`);
    setTimeout(() => connectWhatsApp(1), 3000);
  });
}

setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 240000);

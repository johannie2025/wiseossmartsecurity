/**
 * WISE OS UNIFIED — server.js v3.1 FINAL
 * OTP Complet + Email + QR Code + Magic Link + SOS
 */

import express from "express";
import cors from "cors";
import qrcode from "qrcode";
import nodemailer from "nodemailer";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

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
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.NODE_API_KEY;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 15,
  charset: "utf8mb4",
});

const sessions = new Map();
const sseClients = new Map();

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

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
       VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE session_data=VALUES(session_data), updated_at=NOW()`,
      [tenantId, JSON.stringify(creds)]
    );
  } catch (e) { console.error("[DB Save]", e.message); }
}

// ====================== KEEP-ALIVE ======================
setInterval(() => console.log(`[KEEP-ALIVE] ${new Date().toISOString()}`), 30000);

// ====================== WHATSAPP ======================
async function connectWhatsApp(tenantId) { /* ... (même fonction que précédemment) */ }

async function sendWA(tenantId, phone, text, mediaBase64 = null, mediaType = null) {
  let sd = sessions.get(tenantId || 1);
  if (!sd || sd.status !== "connected") {
    await connectWhatsApp(tenantId || 1);
    await delay(3000);
    sd = sessions.get(tenantId || 1);
  }
  if (!sd?.sock) return false;

  try {
    const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";
    if (mediaBase64 && mediaType) {
      const buffer = Buffer.from(mediaBase64, "base64");
      const typeMap = { "image/jpeg": "image", "application/pdf": "document" };
      const mType = typeMap[mediaType] || "document";
      await sd.sock.sendMessage(jid, { [mType]: buffer, mimetype: mediaType, caption: text });
    } else {
      await sd.sock.sendMessage(jid, { text });
    }
    return true;
  } catch (e) {
    console.error("[sendWA]", e.message);
    return false;
  }
}

// ====================== SERVER ======================
async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  const auth = (req, res, next) => {
    if (!API_KEY) return next();
    if ((req.headers["x-api-key"] || req.body?._api_key) !== API_KEY) 
      return res.status(403).json({ error: "Unauthorized" });
    next();
  };

  app.get("/health", (_, res) => res.json({ status: "ok", version: "3.1" }));

  // SSE
  app.get("/connect", (req, res) => { /* ... SSE code ... */ });

  // ====================== GENERATE OTP (Complet) ======================
  app.post("/generate-otp", auth, async (req, res) => {
    const { phone, tenant_id, type = "default", name = "" } = req.body;
    if (!phone || !tenant_id) return res.status(400).json({ error: "phone et tenant_id requis" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000);

    try {
      await pool.execute(
        `INSERT INTO otp_codes (tenant_id, recipient, code, type, expires_at, used)
         VALUES (?,?,?,?,?,0) ON DUPLICATE KEY UPDATE code=VALUES(code), expires_at=VALUES(expires_at), used=0`,
        [tenant_id, phone, code, type, expires]
      );

      const msg = `🔐 *Wise OS* — Code : *${code}*\nValide 10 minutes.`;
      const sent = await sendWA(tenant_id, phone, msg);

      res.json({ success: true, code, sent, expires_in: 600 });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ====================== VALIDATE OTP ======================
  app.post("/validate-otp", auth, async (req, res) => {
    const { phone, code, tenant_id } = req.body;
    if (!phone || !code || !tenant_id) return res.status(400).json({ error: "Paramètres manquants" });

    try {
      const [rows] = await pool.execute(
        `SELECT id FROM otp_codes 
         WHERE tenant_id = ? AND recipient = ? AND code = ? 
         AND expires_at > NOW() AND used = 0 LIMIT 1`,
        [tenant_id, phone, code]
      );

      if (!rows.length) return res.status(401).json({ valid: false });

      await pool.execute("UPDATE otp_codes SET used = 1 WHERE id = ?", [rows[0].id]);
      res.json({ valid: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ====================== SEND MAGIC LINK ======================
  app.post("/send-magic", auth, async (req, res) => {
    const { phone, email, link, name = "" } = req.body;
    const msg = `🔗 *Wise OS* — Connexion :\n${link}\n\nValable 15 minutes.`;

    let success = {};
    if (phone) success.whatsapp = await sendWA(1, phone, msg);
    if (email) {
      success.email = await mailer.sendMail({
        from: `"Wise OS" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "🔐 Votre lien de connexion Wise OS",
        html: `<p>Bonjour ${name},</p><p>Cliquez ici : <a href="${link}">${link}</a></p>`
      }).then(() => true).catch(() => false);
    }

    res.json({ success: true, ...success });
  });

  // ====================== TRIGGER SOS ======================
  app.post("/trigger-sos", auth, async (req, res) => {
    const { tenant_id, patient_name, message, contacts } = req.body;
    const sosMsg = `🚨 *SOS MÉDICAL* — ${patient_name}\n${message}`;

    for (const c of contacts || []) {
      if (c.phone) await sendWA(tenant_id, c.phone, sosMsg);
      if (c.email) {
        await mailer.sendMail({
          from: `"Wise SOS" <${process.env.SMTP_USER}>`,
          to: c.email,
          subject: `🚨 ALERTE SOS - ${patient_name}`,
          text: sosMsg
        });
      }
    }

    res.json({ success: true });
  });

  app.listen(PORT, async () => {
    console.log(`🚀 Wise OS Unified v3.1 démarré sur port ${PORT}`);
    connectWhatsApp(1).catch(console.error); // Tenant par défaut
  });
}

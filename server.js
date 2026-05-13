/**
 * WISE OS UNIFIED — server.js
 * Moteur temps réel : WhatsApp (Baileys), QR Code, Email, SSE
 * Déploiement : Render.com Free Tier (Node.js 18+)
 *
 * npm install @whiskeysockets/baileys qrcode nodemailer express mysql2 cors dotenv
 */

const express = require("express");
const cors = require("cors");
const qrcode = require("qrcode");
const nodemailer = require("nodemailer");
const mysql = require("mysql2/promise");
require("dotenv").config();

// ─── Baileys (import dynamique ESM) ──────────────────────────────────────────
let makeWASocket, useMultiFileAuthState, DisconnectReason;

(async () => {
  const baileys = await import("@whiskeysockets/baileys");
  makeWASocket = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  startServer();
})();

// ─── Pool MySQL ───────────────────────────────────────────────────────────────
let pool;
async function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
    });
  }
  return pool;
}

// ─── Stockage sessions WhatsApp (multi-tenant) ────────────────────────────────
// Map<user_id, { sock, qrBase64, status }>
const sessions = new Map();

// ─── SSE clients en attente du QR ────────────────────────────────────────────
// Map<user_id, Set<res>>
const sseClients = new Map();

function broadcastSSE(userId, data) {
  const clients = sseClients.get(userId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((res) => {
    try { res.write(payload); } catch (_) {}
  });
}

// ─── Charger creds depuis MySQL ───────────────────────────────────────────────
async function loadCredsFromDb(userId) {
  try {
    const db = await getPool();
    const [rows] = await db.query(
      "SELECT session_data FROM whatsapp_sessions WHERE user_id = ? LIMIT 1",
      [userId]
    );
    return rows.length ? JSON.parse(rows[0].session_data) : null;
  } catch (e) {
    console.error("[DB] loadCreds:", e.message);
    return null;
  }
}

async function saveCredsToDb(userId, creds) {
  try {
    const db = await getPool();
    await db.query(
      `INSERT INTO whatsapp_sessions (user_id, session_data, updated_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE session_data = VALUES(session_data), updated_at = NOW()`,
      [userId, JSON.stringify(creds)]
    );
  } catch (e) {
    console.error("[DB] saveCreds:", e.message);
  }
}

// ─── Connexion Baileys pour un user_id ────────────────────────────────────────
async function connectWhatsApp(userId) {
  // Fermer session existante proprement
  if (sessions.has(userId)) {
    try { sessions.get(userId).sock?.end(); } catch (_) {}
    sessions.delete(userId);
  }

  // Auth hybride : d'abord MySQL, sinon dossier local (fallback)
  let authState;
  const savedCreds = await loadCredsFromDb(userId);

  if (savedCreds) {
    // Reconstruire l'état depuis MySQL
    const { state, saveCreds: sc } = await useMultiFileAuthState(
      `/tmp/wa_${userId}` // dossier temporaire non persistant
    );
    // Injecter les creds sauvegardés
    Object.assign(state.creds, savedCreds);
    authState = { state, saveCreds: sc };
  } else {
    authState = await useMultiFileAuthState(`/tmp/wa_${userId}`);
  }

  const { state, saveCreds } = authState;

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: ["WiseOS", "Chrome", "1.0"],
  });

  sessions.set(userId, { sock, status: "connecting", qrBase64: null });

  // Sauvegarder les creds à chaque update
  sock.ev.on("creds.update", async () => {
    await saveCreds();
    await saveCredsToDb(userId, state.creds);
  });

  // Gestion connexion
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      const qrBase64 = await qrcode.toDataURL(qr);
      const session = sessions.get(userId) || {};
      session.qrBase64 = qrBase64;
      session.status = "qr_pending";
      sessions.set(userId, session);
      broadcastSSE(userId, { type: "qr", qr: qrBase64 });
      console.log(`[WA] QR généré pour user ${userId}`);
    }

    if (connection === "open") {
      const session = sessions.get(userId) || {};
      session.status = "connected";
      session.qrBase64 = null;
      sessions.set(userId, session);
      broadcastSSE(userId, { type: "connected" });
      console.log(`[WA] Connecté : user ${userId}`);
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`[WA] Déconnecté user ${userId} (code: ${code})`);
      broadcastSSE(userId, { type: "disconnected", code });

      if (shouldReconnect) {
        setTimeout(() => connectWhatsApp(userId), 5000);
      } else {
        sessions.delete(userId);
        // Supprimer session en base si logout
        try {
          const db = await getPool();
          await db.query("DELETE FROM whatsapp_sessions WHERE user_id = ?", [userId]);
        } catch (_) {}
      }
    }
  });

  return sock;
}

// ─── Transporteur Email ───────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// ─── Express App ──────────────────────────────────────────────────────────────
function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  // ── Ping anti-veille Render ──────────────────────────────────────────────
  setInterval(() => {
    console.log(`[PING] ${new Date().toISOString()} — serveur actif`);
  }, 10_000);

  // ── Health check ─────────────────────────────────────────────────────────
  app.get("/health", (_, res) => res.json({ status: "ok", ts: Date.now() }));

  // ─────────────────────────────────────────────────────────────────────────
  // POST /connect  →  Initie connexion WhatsApp (retourne JSON immédiatement)
  // GET  /connect  →  SSE : flux QR Code en Base64 + événements
  // ─────────────────────────────────────────────────────────────────────────
  app.get("/connect", (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: "user_id requis" });

    // Enregistrer client SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    if (!sseClients.has(userId)) sseClients.set(userId, new Set());
    sseClients.get(userId).add(res);

    // Si déjà connecté, notifier tout de suite
    const session = sessions.get(userId);
    if (session?.status === "connected") {
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    } else if (session?.qrBase64) {
      res.write(`data: ${JSON.stringify({ type: "qr", qr: session.qrBase64 })}\n\n`);
    } else {
      // Lancer la connexion
      connectWhatsApp(userId).catch(console.error);
    }

    req.on("close", () => {
      sseClients.get(userId)?.delete(res);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /send-whatsapp  →  Envoyer message/OTP/alerte
  // Body: { user_id?, to, message, mediaBase64?, mediaType? }
  // Si user_id absent → numéro central (CENTRAL_WA_USER_ID)
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/send-whatsapp", async (req, res) => {
    const { user_id, to, message, mediaBase64, mediaType } = req.body;
    const senderId = user_id || process.env.CENTRAL_WA_USER_ID;

    if (!to || !message) return res.status(400).json({ error: "to + message requis" });

    let session = sessions.get(senderId);
    if (!session || session.status !== "connected") {
      // Tenter reconnexion avec creds en base
      const creds = await loadCredsFromDb(senderId);
      if (!creds) return res.status(503).json({ error: "WhatsApp non connecté", action: "scan_qr" });
      await connectWhatsApp(senderId);
      session = sessions.get(senderId);
      // Attendre 3s que la connexion se rétablisse
      await new Promise((r) => setTimeout(r, 3000));
      session = sessions.get(senderId);
      if (session?.status !== "connected") {
        return res.status(503).json({ error: "Reconnexion en cours, réessayez dans 5s" });
      }
    }

    try {
      const jid = to.replace(/[^0-9]/g, "") + "@s.whatsapp.net";

      if (mediaBase64 && mediaType) {
        const buffer = Buffer.from(mediaBase64, "base64");
        const typeMap = {
          "image/jpeg": "image", "image/png": "image",
          "application/pdf": "document", "audio/ogg": "audio",
        };
        const mType = typeMap[mediaType] || "document";
        await session.sock.sendMessage(jid, {
          [mType]: buffer,
          mimetype: mediaType,
          caption: message,
        });
      } else {
        await session.sock.sendMessage(jid, { text: message });
      }

      // Log en base
      try {
        const db = await getPool();
        await db.query(
          "INSERT INTO logs (user_id, action, target, details, created_at) VALUES (?,?,?,?,NOW())",
          [senderId, "whatsapp_sent", to, message.substring(0, 200)]
        );
      } catch (_) {}

      return res.json({ success: true, to, ts: Date.now() });
    } catch (e) {
      console.error("[WA] Envoi échoué:", e.message);
      return res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /generate-qr
  // Body: { data, format? }  →  { qr: "<base64 PNG>" }
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/generate-qr", async (req, res) => {
    const { data, format = "png", width = 300, errorCorrectionLevel = "H" } = req.body;
    if (!data) return res.status(400).json({ error: "data requis" });

    try {
      const qrBase64 = await qrcode.toDataURL(data, {
        width,
        errorCorrectionLevel,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      return res.json({ qr: qrBase64, data });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /send-email
  // Body: { to, subject, html, text? }
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/send-email", async (req, res) => {
    const { to, subject, html, text } = req.body;
    if (!to || !subject || !html) return res.status(400).json({ error: "to, subject, html requis" });

    try {
      const info = await transporter.sendMail({
        from: `"Wise OS" <${process.env.SMTP_USER}>`,
        to,
        subject,
        text: text || "",
        html,
      });

      try {
        const db = await getPool();
        await db.query(
          "INSERT INTO logs (user_id, action, target, details, created_at) VALUES (?,?,?,?,NOW())",
          [0, "email_sent", to, subject]
        );
      } catch (_) {}

      return res.json({ success: true, messageId: info.messageId });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /generate-otp
  // Body: { user_id, item_id, channel: "whatsapp"|"email", to }
  // Génère un OTP 6 chiffres, le stocke 10 min en base, l'envoie
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/generate-otp", async (req, res) => {
    const { user_id, item_id, channel, to } = req.body;
    if (!item_id || !channel || !to) return res.status(400).json({ error: "Paramètres manquants" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    try {
      const db = await getPool();
      await db.query(
        `INSERT INTO otps (user_id, item_id, otp_code, channel, target, expires_at, used, created_at)
         VALUES (?,?,?,?,?,?,0,NOW())
         ON DUPLICATE KEY UPDATE otp_code=VALUES(otp_code), expires_at=VALUES(expires_at), used=0`,
        [user_id || 0, item_id, otp, channel, to, expiresAt]
      );

      const msg = `🔐 *Wise OS* — Votre code OTP : *${otp}*\nValide 10 minutes. Ne le communiquez à personne.`;

      if (channel === "whatsapp") {
        await fetch(`http://localhost:${process.env.PORT || 3000}/send-whatsapp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id, to, message: msg }),
        });
      } else {
        await transporter.sendMail({
          from: `"Wise OS" <${process.env.SMTP_USER}>`,
          to,
          subject: "Votre code OTP Wise OS",
          html: `<p style="font-family:sans-serif;font-size:18px">Code : <strong>${otp}</strong></p><p>Valide 10 minutes.</p>`,
        });
      }

      return res.json({ success: true, expires_at: expiresAt });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /verify-otp
  // Body: { item_id, otp_code }
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/verify-otp", async (req, res) => {
    const { item_id, otp_code } = req.body;
    if (!item_id || !otp_code) return res.status(400).json({ error: "Paramètres manquants" });

    try {
      const db = await getPool();
      const [rows] = await db.query(
        `SELECT * FROM otps WHERE item_id = ? AND otp_code = ? AND expires_at > NOW() AND used = 0 LIMIT 1`,
        [item_id, otp_code]
      );

      if (!rows.length) return res.status(401).json({ valid: false, error: "OTP invalide ou expiré" });

      await db.query("UPDATE otps SET used = 1 WHERE id = ?", [rows[0].id]);
      await db.query(
        "INSERT INTO logs (user_id, action, target, details, created_at) VALUES (?,?,?,?,NOW())",
        [rows[0].user_id, "otp_verified", item_id, "OK"]
      );

      return res.json({ valid: true, item_id, verified_at: new Date() });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /trigger-sos
  // Body: { patient_id, location?, message }
  // Envoie alertes multi-canal (WhatsApp central + email) aux proches
  // ─────────────────────────────────────────────────────────────────────────
  app.post("/trigger-sos", async (req, res) => {
    const { patient_id, location, message } = req.body;
    if (!patient_id) return res.status(400).json({ error: "patient_id requis" });

    try {
      const db = await getPool();
      const [contacts] = await db.query(
        `SELECT c.phone, c.email, c.name
         FROM emergency_contacts c
         WHERE c.user_item_id = ?`,
        [patient_id]
      );

      if (!contacts.length) return res.status(404).json({ error: "Aucun contact d'urgence" });

      const loc = location ? `\n📍 Position : ${location}` : "";
      const sosMsg = `🚨 *ALERTE SOS — Wise OS*\n\n${message}${loc}\n\nUn proche a besoin d'aide immédiate !`;

      const results = await Promise.allSettled(
        contacts.flatMap((c) => {
          const tasks = [];
          if (c.phone) {
            tasks.push(
              fetch(`http://localhost:${process.env.PORT || 3000}/send-whatsapp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  user_id: process.env.CENTRAL_WA_USER_ID,
                  to: c.phone,
                  message: sosMsg,
                }),
              })
            );
          }
          if (c.email) {
            tasks.push(
              transporter.sendMail({
                from: `"Wise OS SOS" <${process.env.SMTP_USER}>`,
                to: c.email,
                subject: "🚨 ALERTE SOS — Wise OS",
                html: `<div style="background:#fee2e2;padding:20px;border-radius:8px;font-family:sans-serif">
                  <h2 style="color:#dc2626">🚨 Alerte SOS</h2>
                  <p>${message.replace(/\n/g, "<br>")}</p>
                  ${location ? `<p>📍 <strong>Position :</strong> ${location}</p>` : ""}
                  <p style="color:#666;font-size:12px">Envoyé automatiquement par Wise OS</p></div>`,
              })
            );
          }
          return tasks;
        })
      );

      await db.query(
        "INSERT INTO logs (user_id, action, target, details, created_at) VALUES (?,?,?,?,NOW())",
        [0, "sos_triggered", patient_id, `${contacts.length} contacts alertés`]
      );

      return res.json({
        success: true,
        contacts_alerted: contacts.length,
        results: results.map((r) => r.status),
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── Démarrage ────────────────────────────────────────────────────────────
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Wise OS Node.js server — port ${PORT}`);
    console.log(`   Central WA user : ${process.env.CENTRAL_WA_USER_ID || "(non défini)"}`);

    // Reconnecter le numéro central au démarrage si creds en base
    const centralId = process.env.CENTRAL_WA_USER_ID;
    if (centralId) {
      loadCredsFromDb(centralId).then((creds) => {
        if (creds) {
          console.log(`[BOOT] Reconnexion WhatsApp central user ${centralId}...`);
          connectWhatsApp(centralId).catch(console.error);
        }
      });
    }
  });
}

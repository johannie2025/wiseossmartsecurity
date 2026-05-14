/**
 * WISE OS UNIFIED — server.js v3.3.6
 * ════════════════════════════════════════════════════════════════
 * ESM (type:module dans package.json) — Node 18+
 *
 * FIXES vs v3.3.5 :
 *   ✅ dashboardHTML importé via export nommé (crash fix Render)
 *   ✅ Anti-boucle infinie : flag isConnecting + max 3 tentatives
 *   ✅ Persistance sessions WA → MySQL via proxy PHP /lib/db
 *   ✅ Reconnexion tenant_id=1 au boot si session MySQL trouvée
 *   ✅ Keep-alive stdout toutes les 10s (anti-veille Render Free)
 *   ✅ Toutes les routes : WA / OTP / QR / Email / SOS / Magic
 *
 * Routes exposées :
 *   GET  /                        → Dashboard HTML (status visuel)
 *   GET  /health                  → { status, version, ts }
 *   GET  /status                  → sessions WA actives
 *   GET  /connect?tenant_id=X     → SSE : QR Code + événements WA
 *   POST /send-whatsapp           → Envoyer message WA libre
 *   POST /send-message            → Alias /send-whatsapp
 *   POST /generate-otp            → Créer + envoyer OTP (WA ou email)
 *   POST /validate-otp            → Vérifier OTP via MySQL PHP proxy
 *   POST /generate-qr             → Générer QR Code base64
 *   POST /send-email              → Envoyer email SMTP (Nodemailer)
 *   POST /send-magic              → Magic link email + WA
 *   POST /send-scan-notification  → Notif scan/pointage
 *   POST /send-sos-alert          → Alerte SOS multi-canal
 *   POST /notify-subscription     → Notif paiement/abonnement
 *
 * npm install @whiskeysockets/baileys qrcode nodemailer express cors dotenv pino
 * ════════════════════════════════════════════════════════════════
 */

import express    from "express";
import cors       from "cors";
import qrcode     from "qrcode";
import nodemailer from "nodemailer";
import dotenv     from "dotenv";
import pino       from "pino";
import fs         from "fs";
import { dashboardHTML } from "./dashboard.js"; // ← export nommé obligatoire

dotenv.config();

// ─── Baileys (import ESM dynamique) ───────────────────────────────────────────
let makeWASocket, useMultiFileAuthState, DisconnectReason, delay;
(async () => {
  const b             = await import("@whiskeysockets/baileys");
  makeWASocket        = b.default;
  useMultiFileAuthState = b.useMultiFileAuthState;
  DisconnectReason    = b.DisconnectReason;
  delay               = b.delay;
  startServer();
})();

// ─── Config ────────────────────────────────────────────────────────────────────
const PORT        = process.env.PORT        || 10000;
const PHP_URL     = (process.env.PHP_URL    || "https://wisedesing.pro/wiseos").replace(/\/$/, "");
const NODE_SECRET = process.env.NODE_SECRET || "sk_wiseos_2026_very_long_and_random_secret_key_987654";
const CENTRAL_TID = process.env.CENTRAL_TENANT_ID || "1";
const logger      = pino({ level: "silent" });
const AUTH_DIR    = "./wa_auth";

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

// ─── État multi-tenant ─────────────────────────────────────────────────────────
// Map<tenantId:string, { sock, status, qrBase64, isConnecting, reconnectAttempts }>
const sessions   = new Map();
// Map<tenantId:string, Set<Response>>
const sseClients = new Map();

// ─── Nodemailer ────────────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || "smtp.gmail.com",
  port:   parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// ─── PHP DB Proxy helper ───────────────────────────────────────────────────────
async function dbCall(action, payload = {}) {
  try {
    const r = await fetch(`${PHP_URL}/lib/db`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "X-Node-Secret": NODE_SECRET,
      },
      body:   JSON.stringify({ action, ...payload }),
      signal: AbortSignal.timeout(8000),
    });
    return await r.json();
  } catch (e) {
    console.error(`[DB:${action}]`, e.message);
    return { success: false };
  }
}

// ─── SSE Broadcast ────────────────────────────────────────────────────────────
function broadcastSSE(tid, data) {
  const clients = sseClients.get(String(tid));
  if (!clients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of [...clients]) {
    try   { client.write(payload); }
    catch { clients.delete(client); }
  }
}

// ─── Connexion Baileys ────────────────────────────────────────────────────────
async function connectWhatsApp(tenantId) {
  const tid = String(tenantId || 1);
  const authPath = `${AUTH_DIR}/${tid}`;
  const existing = sessions.get(tid);

  // 1. Anti-boucle : ne pas relancer si déjà en cours
  if (existing?.isConnecting) {
    console.log(`[WA ${tid}] déjà en cours de connexion — ignoré`);
    return;
  }
  if (existing?.status === "connected") {
    console.log(`[WA ${tid}] déjà connecté`);
    return;
  }

  // 2. Création du dossier si inexistant
  if (!fs.existsSync(authPath)) {
    fs.mkdirSync(authPath, { recursive: true });
  }

  // 3. RESTAURATION : Si le fichier local n'existe pas, on tente de le récupérer en DB
  if (!fs.existsSync(`${authPath}/creds.json`)) {
    console.log(`[WA ${tid}] Tentative de restauration des clés depuis MySQL...`);
    const r = await dbCall("load_session", { tenant_id: +tid });
    if (r?.success && r.data) {
      fs.writeFileSync(`${authPath}/creds.json`, JSON.stringify(r.data));
      console.log(`[WA ${tid}] ✅ Clés restaurées avec succès.`);
    } else {
      console.log(`[WA ${tid}] ℹ️ Aucune session valide en base de données.`);
    }
  }

  // 4. Nettoyage de l'ancienne instance si elle existe
  if (existing?.sock?.end) try { existing.sock.end(); } catch (_) {}
  
  // Initialisation de l'état
  const sd = { sock: null, status: "connecting", qrBase64: null, isConnecting: true, reconnectAttempts: 0 };
  sessions.set(tid, sd);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    const sock = makeWASocket({
      auth: state,
      logger,
      browser: ["Wise OS", "Chrome", "3.3.6"],
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      retryRequestDelayMs: 3000,
      connectTimeoutMs: 30000,
    });
    sd.sock = sock;

    // ── Sauvegarde creds (local + MySQL) ────────────────────────────────
    sock.ev.on("creds.update", async () => {
      await saveCreds();
      try {
        const raw = fs.readFileSync(`${AUTH_DIR}/${tid}/creds.json`, "utf8");
        await dbCall("save_session", { tenant_id: +tid, session_data: JSON.parse(raw) });
      } catch (_) {}
    });

    // ── Événements connexion ─────────────────────────────────────────────
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {

      if (qr) {
        sd.qrBase64     = await qrcode.toDataURL(qr, { width: 300, margin: 2 });
        sd.status        = "qr_pending";
        sd.isConnecting  = false;
        broadcastSSE(tid, { type: "qr", qr: sd.qrBase64 });
        console.log(`📱 [WA ${tid}] QR généré — scannez !`);
      }

      if (connection === "open") {
        sd.status           = "connected";
        sd.isConnecting     = false;
        sd.qrBase64         = null;
        sd.reconnectAttempts = 0;
        broadcastSSE(tid, { type: "connected" });
        console.log(`✅ [WA ${tid}] Connecté`);
      }

      if (connection === "close") {
        sd.isConnecting = false;
        broadcastSSE(tid, { type: "disconnected" });
        const code      = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        console.log(`🔴 [WA ${tid}] Déconnecté (code: ${code})`);

        if (loggedOut) {
          sessions.delete(tid);
          await dbCall("delete_session", { tenant_id: +tid });
          console.log(`🗑️  [WA ${tid}] Session supprimée (logout)`);
          return;
        }

        if (sd.reconnectAttempts < 3) {
          sd.reconnectAttempts++;
          const wait = sd.reconnectAttempts * 8000;
          console.log(`🔄 [WA ${tid}] Reconnexion ${sd.reconnectAttempts}/3 dans ${wait / 1000}s...`);
          setTimeout(() => connectWhatsApp(tid), wait);
        } else {
          console.log(`❌ [WA ${tid}] Abandon après 3 tentatives`);
          sessions.delete(tid);
        }
      }
    });

  } catch (e) {
    sd.isConnecting = false;
    console.error(`[WA ${tid}] Erreur critique:`, e.message);
    sessions.delete(tid);
  }
}

// ─── Envoi message WhatsApp ────────────────────────────────────────────────────
async function sendWA(tenantId, phone, text) {
  const tid = String(tenantId || CENTRAL_TID);
  let sd    = sessions.get(tid);

  if (!sd || sd.status !== "connected") {
    if (!sd?.isConnecting) await connectWhatsApp(tid);
    await delay(4000);
    sd = sessions.get(tid);
  }

  if (!sd?.sock || sd.status !== "connected") {
    console.warn(`[WA ${tid}] Non connecté — message non envoyé`);
    return false;
  }

  try {
    const jid = phone.replace(/\D/g, "") + "@s.whatsapp.net";
    await sd.sock.sendMessage(jid, { text });
    console.log(`📤 [WA ${tid}] → ${phone}`);
    return true;
  } catch (e) {
    console.error("[sendWA]", e.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  SERVEUR EXPRESS
// ══════════════════════════════════════════════════════════════════════════════
async function startServer() {
  const app = express();
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "10mb" }));

  // ── GET /  →  Dashboard HTML ────────────────────────────────────────────
  app.get("/", (_, res) => res.send(dashboardHTML));

  // ── GET /health ─────────────────────────────────────────────────────────
  app.get("/health", (_, res) =>
    res.json({ status: "ok", version: "3.3.6", ts: Date.now() })
  );

  // ── GET /status ─────────────────────────────────────────────────────────
  app.get("/status", (_, res) => {
    const list = {};
    sessions.forEach((sd, id) =>
      (list[id] = { status: sd.status, isConnecting: sd.isConnecting, retries: sd.reconnectAttempts })
    );
    res.json({ version: "3.3.6", activeSessions: sessions.size, sessions: list });
  });

  // ── GET /connect?tenant_id=X  →  SSE QR Code ────────────────────────────
  app.get("/connect", (req, res) => {
    const tid = String(req.query.tenant_id || 1);

    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");
    res.flushHeaders();

    if (!sseClients.has(tid)) sseClients.set(tid, new Set());
    sseClients.get(tid).add(res);

    const sd = sessions.get(tid);
    if (sd?.status === "connected") {
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    } else if (sd?.qrBase64) {
      res.write(`data: ${JSON.stringify({ type: "qr", qr: sd.qrBase64 })}\n\n`);
    } else {
      connectWhatsApp(tid);
    }

    req.on("close", () => sseClients.get(tid)?.delete(res));
  });

  // ── POST /send-whatsapp  (+ alias /send-message) ─────────────────────────
  // Body: { tenant_id?, to, message, mediaBase64?, mediaType? }
  const waHandler = async (req, res) => {
    const { tenant_id = CENTRAL_TID, to, message, mediaBase64, mediaType } = req.body;
    if (!to || !message) return res.status(400).json({ error: "to + message requis" });

    const tid = String(tenant_id);
    let sd    = sessions.get(tid);

    if (!sd || sd.status !== "connected") {
      if (!sd?.isConnecting) connectWhatsApp(tid);
      await delay(4000);
      sd = sessions.get(tid);
      if (sd?.status !== "connected")
        return res.status(503).json({ error: "WhatsApp non connecté", action: "scan_qr" });
    }

    try {
      const jid = to.replace(/\D/g, "") + "@s.whatsapp.net";

      if (mediaBase64 && mediaType) {
        const buf     = Buffer.from(mediaBase64, "base64");
        const typeMap = {
          "image/jpeg": "image", "image/png": "image",
          "application/pdf": "document", "audio/ogg": "audio",
        };
        const mType = typeMap[mediaType] || "document";
        await sd.sock.sendMessage(jid, { [mType]: buf, mimetype: mediaType, caption: message });
      } else {
        await sd.sock.sendMessage(jid, { text: message });
      }

      console.log(`📤 [WA ${tid}] → ${to}`);
      return res.json({ success: true, to, ts: Date.now() });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  };
  app.post("/send-whatsapp", waHandler);
  app.post("/send-message",  waHandler); // alias

  // ── POST /generate-qr ────────────────────────────────────────────────────
  // Body: { data, width?, errorCorrectionLevel? }
  app.post("/generate-qr", async (req, res) => {
    const { data, width = 400, errorCorrectionLevel = "H" } = req.body;
    if (!data) return res.status(400).json({ error: "data requis" });
    try {
      const qr = await qrcode.toDataURL(data, {
        width, errorCorrectionLevel, margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      return res.json({ qr, data });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── POST /send-email ──────────────────────────────────────────────────────
  // Body: { to, subject, html, text? }
  app.post("/send-email", async (req, res) => {
    const { to, subject, html, text } = req.body;
    if (!to || !subject || !html) return res.status(400).json({ error: "to, subject, html requis" });
    try {
      const info = await mailer.sendMail({
        from: `"Wise OS" <${process.env.SMTP_USER}>`,
        to, subject, text: text || "", html,
      });
      return res.json({ success: true, messageId: info.messageId });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── POST /generate-otp ────────────────────────────────────────────────────
  // Body: { tenant_id?, recipient, channel: "whatsapp"|"email", type? }
  // Génère OTP 6 chiffres → stocke MySQL (PHP proxy) → envoie
  app.post("/generate-otp", async (req, res) => {
    const { tenant_id = 1, recipient, channel = "whatsapp", type = "default" } = req.body;
    if (!recipient) return res.status(400).json({ error: "recipient requis" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const msg  = `🔐 *Wise OS* — Votre code : *${code}*\nValide 10 minutes. Ne le partagez pas.`;

    // Persistance MySQL via proxy PHP
    await dbCall("save_otp", { tenant_id: +tenant_id, recipient, code, type });

    let sent = false;
    if (channel === "whatsapp") {
      sent = await sendWA(tenant_id, recipient, msg);
    } else {
      try {
        await mailer.sendMail({
          from:    `"Wise OS" <${process.env.SMTP_USER}>`,
          to:      recipient,
          subject: "Votre code Wise OS",
          html:    `<div style="font-family:sans-serif;padding:24px"><p>Votre code :</p><h2 style="font-size:36px;letter-spacing:6px;color:#c9a84c">${code}</h2><p style="color:#999">Valide 10 minutes.</p></div>`,
        });
        sent = true;
      } catch (e) { console.error("[OTP email]", e.message); }
    }

    return res.json({ success: true, sent });
  });

  // ── POST /validate-otp ────────────────────────────────────────────────────
  // Body: { tenant_id?, recipient, code, type? }
  app.post("/validate-otp", async (req, res) => {
    const { tenant_id = 1, recipient, code, type = "default" } = req.body;
    if (!recipient || !code) return res.status(400).json({ error: "recipient + code requis" });

    const result = await dbCall("validate_otp", { tenant_id: +tenant_id, recipient, code, type });
    return res.json({ valid: result?.valid === true });
  });

  // ── POST /send-magic ──────────────────────────────────────────────────────
  // Body: { email, link, name?, phone?, tenant_id? }
  // Envoie magic link par email SMTP + WhatsApp optionnel
  app.post("/send-magic", async (req, res) => {
    const { email, link, name = "utilisateur", phone, tenant_id = 1 } = req.body;
    if (!email || !link) return res.status(400).json({ error: "email + link requis" });

    const html = `
<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;background:#0d1117;color:#eef0f5;border-radius:16px;padding:36px;border:1px solid #1a2130">
  <div style="width:44px;height:44px;background:linear-gradient(135deg,#c9a84c,#e8c96a);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#0a0a0a;margin-bottom:20px">W</div>
  <h2 style="color:#c9a84c;margin:0 0 10px;font-size:22px">Bonjour ${name} 👋</h2>
  <p style="color:#9aaab8;margin-bottom:24px;line-height:1.6">Cliquez ci-dessous pour vous connecter à Wise OS. Ce lien expire dans <strong style="color:#eef0f5">15 minutes</strong>.</p>
  <a href="${link}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#c9a84c,#e8c96a);color:#0a0a0a;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">🔑 Se connecter →</a>
  <p style="color:#6b7a8d;font-size:11px;margin-top:28px">Si vous n'avez pas demandé ce lien, ignorez cet email.</p>
</div>`;

    try {
      await mailer.sendMail({
        from: `"Wise OS" <${process.env.SMTP_USER}>`,
        to: email, subject: "🔑 Votre Magic Link — Wise OS", html,
      });
      if (phone) {
        await sendWA(tenant_id, phone,
          `🔑 *Wise OS* — Votre lien de connexion :\n${link}\n\n⏰ Valable 15 minutes.`
        );
      }
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ── POST /send-scan-notification ──────────────────────────────────────────
  // Body: { tenant_id?, phone, name?, action? }
  app.post("/send-scan-notification", async (req, res) => {
    const { tenant_id = 1, phone, name = "", action = "validation" } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const sent = await sendWA(
      tenant_id, phone,
      `✅ *Wise OS* — ${action} enregistrée${name ? " pour *" + name + "*" : ""}.\n🕐 ${new Date().toLocaleString("fr-FR")}`
    );
    return res.json({ success: true, whatsapp: sent });
  });

  // ── POST /send-sos-alert ──────────────────────────────────────────────────
  // Body: { tenant_id?, phone, patient_name?, blood_type?, allergies?, location? }
  app.post("/send-sos-alert", async (req, res) => {
    const {
      tenant_id = CENTRAL_TID,
      phone,
      patient_name = "Patient",
      blood_type   = "Inconnu",
      allergies    = "Aucune connue",
      location     = null,
    } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const msg =
      `🚨 *ALERTE SOS — Wise OS*\n\n` +
      `👤 Patient : *${patient_name}*\n` +
      `🩸 Groupe : *${blood_type}*\n` +
      `⚠️ Allergies : ${allergies}\n` +
      (location ? `📍 Position : ${location}\n` : "") +
      `\nUn proche a besoin d'aide immédiate. Contactez-le ou appelez le 15 / 115.`;

    const sent = await sendWA(tenant_id, phone, msg);
    return res.json({ success: true, whatsapp: sent });
  });

  // ── POST /notify-subscription ─────────────────────────────────────────────
  // Body: { tenant_id?, phone, plan?, amount?, currency? }
  app.post("/notify-subscription", async (req, res) => {
    const {
      tenant_id = CENTRAL_TID,
      phone, plan = "Pro",
      amount = 0, currency = "XAF",
    } = req.body;
    if (!phone) return res.status(400).json({ error: "phone requis" });

    const sent = await sendWA(
      tenant_id, phone,
      `🎉 *Wise OS* — Abonnement *${plan}* activé !\n` +
      `💰 ${Number(amount).toLocaleString("fr-FR")} ${currency}\n\n` +
      `Merci pour votre confiance. Votre espace est prêt ✅`
    );
    return res.json({ success: true, whatsapp: sent });
  });

  // ── Démarrage ─────────────────────────────────────────────────────────────
  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`🚀 Wise OS v3.3.6 — port ${PORT}`);
    console.log(`   PHP_URL        : ${PHP_URL}`);
    console.log(`   CENTRAL_TID    : ${CENTRAL_TID}`);

    // Reconnexion au boot si session MySQL existe pour tenant central
    setTimeout(async () => {
      const r = await dbCall("load_session", { tenant_id: +CENTRAL_TID });
      if (r?.data) {
        console.log(`[BOOT] Session WA trouvée en MySQL pour tenant ${CENTRAL_TID} → reconnexion...`);
        connectWhatsApp(CENTRAL_TID);
      } else {
        console.log(`[BOOT] Pas de session WA en MySQL — en attente d'un scan`);
      }
    }, 2500);
  });
}

// ─── Keep-alive anti-veille Render (toutes les 10s) ───────────────────────────
setInterval(() => process.stdout.write(`[PING] ${new Date().toISOString()}\n`), 10_000);

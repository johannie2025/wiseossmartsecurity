/**
 * WISE OS — dashboardHTML v3.3.2
 * 9 Workflows complets avec formulaires, OTP, scan simulé
 * À remplacer la constante dashboardHTML dans server.js
 *
 * USAGE dans server.js :
 *   import { dashboardHTML } from './dashboard.js';
 *   app.get("/", (req, res) => res.send(dashboardHTML));
 */

export const dashboardHTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wise OS — Dashboard Unifié</title>
<style>
:root{--navy:#0a1628;--blue:#1e3a5f;--cyan:#00b4d8;--red:#e63946;--green:#27ae60;--white:#f0f4f8;--glass:rgba(30,58,95,.15);--card:#fff;--text:#1a1a2e;--border:#e0e7ef}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;background:var(--white);color:var(--text);min-height:100vh}
header{background:var(--navy);color:#fff;padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:1.2rem;letter-spacing:1px}
.badge{background:var(--cyan);color:var(--navy);padding:4px 12px;border-radius:20px;font-size:.8rem;font-weight:700}
.wa-status{font-size:.85rem;padding:6px 14px;border-radius:20px;background:rgba(255,255,255,.1)}
.wa-status.ok{background:#27ae6022;color:#27ae60}
.wa-status.pending{background:#f39c1222;color:#f39c12}
.nav{display:flex;gap:6px;padding:12px 24px;background:#fff;border-bottom:1px solid var(--border);flex-wrap:wrap}
.nav button{padding:7px 14px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:.82rem;background:#fff;transition:.2s}
.nav button:hover,.nav button.active{background:var(--blue);color:#fff;border-color:var(--blue)}
.main{padding:20px 24px;max-width:1100px;margin:0 auto}
.panel{display:none}.panel.active{display:block}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.04)}
.card h3{color:var(--blue);margin-bottom:14px;font-size:1rem;display:flex;align-items:center;gap:8px}
.form-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.form-row label{font-size:.82rem;color:#555;display:flex;flex-direction:column;gap:4px;flex:1;min-width:160px}
input,select,textarea{padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:.9rem;width:100%;outline:none;transition:.2s}
input:focus,select:focus{border-color:var(--cyan)}
.btn{padding:9px 18px;border:none;border-radius:6px;cursor:pointer;font-size:.88rem;font-weight:700;transition:.2s;display:inline-flex;align-items:center;gap:6px}
.btn-primary{background:var(--blue);color:#fff}.btn-primary:hover{background:#122840}
.btn-success{background:var(--green);color:#fff}
.btn-danger{background:var(--red);color:#fff}
.btn-cyan{background:var(--cyan);color:var(--navy)}
.btn-sm{padding:6px 12px;font-size:.8rem}
.result{background:#1a1a2e;color:#00e5ff;padding:12px 16px;border-radius:8px;font-size:.82rem;font-family:monospace;min-height:48px;white-space:pre-wrap;margin-top:12px;max-height:220px;overflow:auto}
.result.ok{border-left:3px solid var(--green)}
.result.err{border-left:3px solid var(--red)}
.status-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.pill{padding:6px 14px;border-radius:20px;font-size:.8rem;font-weight:700}
.pill-blue{background:#e6f1fb;color:#185fa5}
.pill-green{background:#eaf3de;color:#3b6d11}
.pill-red{background:#fcebeb;color:#a32d2d}
.pill-amber{background:#faeeda;color:#854f0b}
#qr-img{text-align:center;margin:10px 0}
#qr-img img{border-radius:8px;border:2px solid var(--border)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:640px){.grid2{grid-template-columns:1fr}}
.divider{border:none;border-top:1px solid var(--border);margin:14px 0}
.otp-box{display:flex;gap:8px;align-items:flex-end}
.otp-box input{letter-spacing:6px;font-size:1.2rem;font-weight:700;text-align:center}
</style>
</head>
<body>

<header>
  <h1>🛡️ WISE OS Unified <span style="font-size:.75rem;opacity:.6">v3.3.2</span></h1>
  <div style="display:flex;gap:10px;align-items:center">
    <span id="wa-indicator" class="wa-status pending">⏳ WA Non connecté</span>
    <span class="badge">Dashboard</span>
  </div>
</header>

<nav class="nav">
  <button class="active" onclick="show('home',this)">🏠 Accueil</button>
  <button onclick="show('enfance',this)">👶 École</button>
  <button onclick="show('transport',this)">🚗 Transport</button>
  <button onclick="show('event',this)">🎉 Événement</button>
  <button onclick="show('rh',this)">🏢 RH</button>
  <button onclick="show('diplome',this)">🎓 Diplôme</button>
  <button onclick="show('sante',this)">⚕️ Santé SOS</button>
  <button onclick="show('officine',this)">💊 Officine</button>
  <button onclick="show('logistique',this)">📦 Logistique</button>
  <button onclick="show('regilien',this)">🏛️ Régilien</button>
  <button onclick="show('whatsapp',this)" style="margin-left:auto">📱 WhatsApp</button>
</nav>

<div class="main">

<!-- ══ HOME ══ -->
<div id="panel-home" class="panel active">
  <div class="status-row">
    <span class="pill pill-blue">🌐 Langues FR · EN · ES</span>
    <span class="pill pill-green">🔐 OTP 10 min</span>
    <span class="pill pill-amber">🛡️ HMAC-SHA256</span>
    <span class="pill pill-red">⚡ Anti-double scan</span>
  </div>
  <div class="grid2">
    <div class="card">
      <h3>📊 Statut serveur</h3>
      <button class="btn btn-primary btn-sm" onclick="getStatus()">Actualiser</button>
      <div class="result" id="home-result">Cliquez sur Actualiser...</div>
    </div>
    <div class="card">
      <h3>🔑 Test OTP rapide</h3>
      <div class="form-row">
        <label>Numéro WhatsApp<input id="h-phone" placeholder="240555445514"></label>
        <label>Contexte
          <select id="h-ctx">
            <option value="default">default</option>
            <option value="register">register</option>
            <option value="login">login</option>
            <option value="logistique">logistique</option>
            <option value="officine">officine</option>
          </select>
        </label>
      </div>
      <button class="btn btn-cyan" onclick="quickOTP()">Envoyer OTP</button>
      <div class="result" id="otp-result">—</div>
    </div>
  </div>
  <div class="card">
    <h3>📡 Endpoints disponibles</h3>
    <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:.8rem">
      <span class="pill pill-blue">POST /generate-otp</span>
      <span class="pill pill-blue">POST /validate-otp</span>
      <span class="pill pill-blue">POST /send-message</span>
      <span class="pill pill-blue">POST /send-magic</span>
      <span class="pill pill-blue">POST /send-scan-notification</span>
      <span class="pill pill-blue">POST /send-sos-alert</span>
      <span class="pill pill-blue">POST /notify-subscription</span>
      <span class="pill pill-blue">POST /generate-qr</span>
      <span class="pill pill-green">GET /connect?tenant_id=1</span>
      <span class="pill pill-green">GET /wa-qr/1</span>
      <span class="pill pill-green">GET /status</span>
      <span class="pill pill-green">GET /health</span>
    </div>
  </div>
</div>

<!-- ══ 1. ENFANCE & ÉCOLE ══ -->
<div id="panel-enfance" class="panel">
  <div class="card">
    <h3>👶 Enfance & École — Scan entrée/sortie + Alerte parentale</h3>
    <div class="grid2">
      <div>
        <div class="form-row">
          <label>Nom élève<input id="en-name" placeholder="Jean Dupont" value="Marie Mbongo"></label>
          <label>Téléphone parent<input id="en-parent" placeholder="237690000000" value="240555445514"></label>
        </div>
        <div class="form-row">
          <label>Action
            <select id="en-action">
              <option value="entree">Entrée école</option>
              <option value="sortie">Sortie école</option>
            </select>
          </label>
          <label>Personne connue ?
            <select id="en-known">
              <option value="yes">Oui — parent enregistré</option>
              <option value="no">Non — personne inconnue</option>
            </select>
          </label>
        </div>
        <button class="btn btn-success" onclick="wf_enfance_scan()">📷 Simuler Scan Badge</button>
      </div>
      <div>
        <h4 style="margin-bottom:10px;font-size:.9rem">Valider sortie avec OTP parental</h4>
        <div class="otp-box">
          <label style="flex:1">Code OTP reçu par parent<input id="en-otp" placeholder="123456" maxlength="6"></label>
          <button class="btn btn-primary btn-sm" onclick="wf_enfance_otp()">Valider</button>
        </div>
      </div>
    </div>
    <div class="result" id="en-result">—</div>
  </div>
</div>

<!-- ══ 2. TRANSPORT ══ -->
<div id="panel-transport" class="panel">
  <div class="card">
    <h3>🚗 Transport — Trajet sécurisé GPS + OTP</h3>
    <div class="grid2">
      <div>
        <div class="form-row">
          <label>Passager / Chauffeur<input id="tr-name" placeholder="Paul Nze" value="Paul Nze"></label>
          <label>Téléphone<input id="tr-phone" placeholder="241074000000" value="240555445514"></label>
        </div>
        <div class="form-row">
          <label>Action
            <select id="tr-action">
              <option value="depart">Départ trajet</option>
              <option value="arrivee">Arrivée destination</option>
            </select>
          </label>
          <label>Téléphone proches<input id="tr-family" placeholder="237690000001"></label>
        </div>
        <button class="btn btn-success" onclick="wf_transport()">🚗 Valider Scan + Envoyer GPS</button>
      </div>
      <div>
        <h4 style="margin-bottom:10px;font-size:.9rem">OTP de validation trajet</h4>
        <div class="otp-box">
          <label style="flex:1">Code OTP reçu<input id="tr-otp" placeholder="123456" maxlength="6"></label>
          <button class="btn btn-primary btn-sm" onclick="wf_transport_otp()">Confirmer</button>
        </div>
        <p style="font-size:.78rem;color:#888;margin-top:8px">OTP envoyé par WhatsApp pour confirmer début/fin trajet</p>
      </div>
    </div>
    <div class="result" id="tr-result">—</div>
  </div>
</div>

<!-- ══ 3. ÉVÉNEMENT ══ -->
<div id="panel-event" class="panel">
  <div class="card">
    <h3>🎉 Événementiel — Billet HMAC + Anti-fraude multi-agents</h3>
    <div class="grid2">
      <div>
        <div class="form-row">
          <label>Nom détenteur billet<input id="ev-name" placeholder="Alice Mba" value="Alice Mba"></label>
          <label>Numéro billet<input id="ev-ticket" placeholder="TKT-2025-001" value="TKT-2025-001"></label>
        </div>
        <div class="form-row">
          <label>Signature HMAC (simulée)<input id="ev-hmac" placeholder="sha256..."></label>
          <label>Type accès
            <select id="ev-type">
              <option value="standard">Standard</option>
              <option value="vip">VIP (OTP requis)</option>
            </select>
          </label>
        </div>
        <button class="btn btn-success" onclick="wf_event_scan()">🎟️ Scanner Billet</button>
        <button class="btn btn-danger btn-sm" style="margin-left:8px" onclick="wf_event_double()">⚠️ Test Double Scan</button>
      </div>
      <div>
        <h4 style="margin-bottom:10px;font-size:.9rem">Accès VIP — OTP</h4>
        <div class="otp-box">
          <label style="flex:1">Code VIP reçu<input id="ev-otp" placeholder="123456" maxlength="6"></label>
          <button class="btn btn-primary btn-sm" onclick="wf_event_otp()">Valider VIP</button>
        </div>
      </div>
    </div>
    <div class="result" id="ev-result">—</div>
  </div>
</div>

<!-- ══ 4. RH ══ -->
<div id="panel-rh" class="panel">
  <div class="card">
    <h3>🏢 RH & Business — Pointage GPS + OTP modification</h3>
    <div class="grid2">
      <div>
        <div class="form-row">
          <label>Employé<input id="rh-name" placeholder="Jean Obiang" value="Jean Obiang"></label>
          <label>Téléphone<input id="rh-phone" placeholder="240555000001" value="240555445514"></label>
        </div>
        <div class="form-row">
          <label>Action
            <select id="rh-action">
              <option value="entree">Pointage arrivée</option>
              <option value="sortie">Pointage départ</option>
            </select>
          </label>
          <label>GPS (simulé)<input id="rh-gps" placeholder="3.7501,8.7807" value="3.7501,8.7807"></label>
        </div>
        <button class="btn btn-success" onclick="wf_rh_pointage()">🏢 Enregistrer Pointage</button>
      </div>
      <div>
        <h4 style="margin-bottom:10px;font-size:.9rem">Modifier feuille de temps — OTP</h4>
        <div class="form-row">
          <label>Heure à modifier<input id="rh-time" type="time" value="08:30"></label>
        </div>
        <div class="otp-box">
          <label style="flex:1">Code OTP reçu<input id="rh-otp" placeholder="123456" maxlength="6"></label>
          <button class="btn btn-primary btn-sm" onclick="wf_rh_otp()">Valider modif.</button>
        </div>
      </div>
    </div>
    <div class="result" id="rh-result">—</div>
  </div>
</div>

<!-- ══ 5. DIPLÔME ══ -->
<div id="panel-diplome" class="panel">
  <div class="card">
    <h3>🎓 Éducation & Diplômes — Scellement numérique + Vérification publique</h3>
    <div class="grid2">
      <div>
        <div class="form-row">
          <label>Titulaire<input id="di-name" placeholder="Marie Obono" value="Marie Obono"></label>
          <label>Téléphone<input id="di-phone" placeholder="240555000002" value="240555445514"></label>
        </div>
        <div class="form-row">
          <label>Établissement<input id="di-inst" placeholder="Université de Bata" value="Université de Bata"></label>
          <label>Référence acte<input id="di-ref" placeholder="UNIB-2025-0042" value="UNIB-2025-0042"></label>
        </div>
        <button class="btn btn-cyan" onclick="wf_diplome_verify()">🔍 Vérification publique</button>
        <button class="btn btn-success" style="margin-left:8px" onclick="wf_diplome_otp_send()">📥 Demander copie certifiée</button>
      </div>
      <div>
        <h4 style="margin-bottom:10px;font-size:.9rem">Télécharger copie — OTP</h4>
        <div class="otp-box">
          <label style="flex:1">Code reçu sur téléphone<input id="di-otp" placeholder="123456" maxlength="6"></label>
          <button class="btn btn-primary btn-sm" onclick="wf_diplome_download()">Télécharger</button>
        </div>
      </div>
    </div>
    <div class="result" id="di-result">—</div>
  </div>
</div>

<!-- ══ 6. SANTÉ SOS ══ -->
<div id="panel-sante" class="panel">
  <div class="card">
    <h3>⚕️ Santé SOS — Dossier vital + Alerte urgences + OTP famille</h3>
    <div class="grid2">
      <div>
        <div class="form-row">
          <label>Patient<input id="sa-name" placeholder="Robert Nguema" value="Robert Nguema"></label>
          <label>Téléphone famille<input id="sa-family" placeholder="240555000003" value="240555445514"></label>
        </div>
        <div class="form-row">
          <label>Groupe sanguin<input id="sa-blood" placeholder="A+" value="O+"></label>
          <label>Allergies<input id="sa-allerg" placeholder="Pénicilline" value="Aucune connue"></label>
        </div>
        <button class="btn btn-danger" onclick="wf_sos_scan()">🚨 Scan Bracelet SOS</button>
        <button class="btn btn-success btn-sm" style="margin-left:8px" onclick="wf_sos_alert()">📢 Alerter famille + urgences</button>
      </div>
      <div>
        <h4 style="margin-bottom:10px;font-size:.9rem">Accès médecin tiers — OTP famille</h4>
        <div class="form-row">
          <label>Email urgences<input id="sa-email" placeholder="urgences@hopital.gq" value="admin@wisedesign.pro"></label>
        </div>
        <div class="otp-box">
          <label style="flex:1">Code OTP famille<input id="sa-otp" placeholder="123456" maxlength="6"></label>
          <button class="btn btn-primary btn-sm" onclick="wf_sos_otp()">Autoriser accès</button>
        </div>
      </div>
    </div>
    <div class="result" id="sa-result">—</div>
  </div>
</div>

<!-- ══ 7. OFFICINE ══ -->
<div id="panel-officine" class="panel">
  <div class="card">
    <h3>💊 Santé Officine — Ordonnance numérique + Délivrance unique</h3>
    <div class="grid2">
      <div>
        <div class="form-row">
          <label>Patient<input id="of-name" placeholder="Théodore Mba" value="Théodore Mba"></label>
          <label>Téléphone patient<input id="of-phone" placeholder="240555000004" value="240555445514"></label>
        </div>
        <div class="form-row">
          <label>Référence ordonnance<input id="of-ref" placeholder="ORD-2025-001" value="ORD-2025-001"></label>
          <label>Médicaments<input id="of-meds" placeholder="Amoxicilline 500mg x21" value="Amoxicilline 500mg x21"></label>
        </div>
        <button class="btn btn-cyan" onclick="wf_officine_scan()">💊 Scanner Ordonnance</button>
        <p style="font-size:.78rem;color:#888;margin-top:8px">OTP envoyé automatiquement au patient</p>
      </div>
      <div>
        <h4 style="margin-bottom:10px;font-size:.9rem">Confirmer délivrance — OTP patient</h4>
        <div class="otp-box">
          <label style="flex:1">Code reçu par patient<input id="of-otp" placeholder="123456" maxlength="6"></label>
          <button class="btn btn-success btn-sm" onclick="wf_officine_deliver()">✅ Délivrer médicaments</button>
        </div>
      </div>
    </div>
    <div class="result" id="of-result">—</div>
  </div>
</div>

<!-- ══ 8. LOGISTIQUE ══ -->
<div id="panel-logistique" class="panel">
  <div class="card">
    <h3>📦 Logistique — Traçabilité colis + OTP anti-litige</h3>
    <div class="grid2">
      <div>
        <div class="form-row">
          <label>Destinataire<input id="lo-name" placeholder="Carmen Ndong" value="Carmen Ndong"></label>
          <label>Téléphone destinataire<input id="lo-phone" placeholder="240555000005" value="240555445514"></label>
        </div>
        <div class="form-row">
          <label>Référence colis<input id="lo-ref" placeholder="COL-2025-0891" value="COL-2025-0891"></label>
          <label>Statut
            <select id="lo-action">
              <option value="depart">Départ entrepôt</option>
              <option value="arrivee">Arrivée locale</option>
              <option value="livraison">Livraison finale</option>
            </select>
          </label>
        </div>
        <button class="btn btn-success" onclick="wf_logistique_scan()">📦 Scanner Colis</button>
        <p style="font-size:.78rem;color:#888;margin-top:8px">OTP envoyé au destinataire à la livraison</p>
      </div>
      <div>
        <h4 style="margin-bottom:10px;font-size:.9rem">Confirmer réception — OTP destinataire</h4>
        <div class="otp-box">
          <label style="flex:1">Code OTP reçu<input id="lo-otp" placeholder="123456" maxlength="6"></label>
          <button class="btn btn-primary btn-sm" onclick="wf_logistique_confirm()">📬 Confirmer réception</button>
        </div>
      </div>
    </div>
    <div class="result" id="lo-result">—</div>
  </div>
</div>

<!-- ══ 9. RÉGILIEN ══ -->
<div id="panel-regilien" class="panel">
  <div class="card">
    <h3>🏛️ Régilien — Signature numérique + Vérification intégrité</h3>
    <div class="grid2">
      <div>
        <div class="form-row">
          <label>Signataire<input id="re-name" placeholder="Ministère de l'Éducation" value="Ministère de l'Éducation"></label>
          <label>Téléphone signataire<input id="re-phone" placeholder="240222000001" value="240555445514"></label>
        </div>
        <div class="form-row">
          <label>Référence document<input id="re-ref" placeholder="DECRET-2025-042" value="DECRET-2025-042"></label>
          <label>Type document<input id="re-type" placeholder="Décret officiel" value="Décret officiel"></label>
        </div>
        <button class="btn btn-cyan" onclick="wf_regilien_verify()">🔍 Vérifier intégrité</button>
        <button class="btn btn-success btn-sm" style="margin-left:8px" onclick="wf_regilien_otp_send()">✍️ Signer document</button>
      </div>
      <div>
        <h4 style="margin-bottom:10px;font-size:.9rem">Signature électronique — OTP</h4>
        <div class="otp-box">
          <label style="flex:1">Code OTP reçu<input id="re-otp" placeholder="123456" maxlength="6"></label>
          <button class="btn btn-primary btn-sm" onclick="wf_regilien_sign()">🏛️ Apposer signature</button>
        </div>
      </div>
    </div>
    <div class="result" id="re-result">—</div>
  </div>
</div>

<!-- ══ WHATSAPP ══ -->
<div id="panel-whatsapp" class="panel">
  <div class="grid2">
    <div class="card">
      <h3>📱 Connexion WhatsApp</h3>
      <button class="btn btn-primary" onclick="connectWA()">🔄 Générer QR Code</button>
      <div id="qr-img"></div>
      <p style="font-size:.8rem;color:#888;margin-top:8px">Scannez avec WhatsApp → Appareil liés → Lier appareil</p>
    </div>
    <div class="card">
      <h3>📤 Envoyer message test</h3>
      <div class="form-row">
        <label>Numéro<input id="wa-phone" placeholder="240555445514" value="240555445514"></label>
      </div>
      <div class="form-row">
        <label>Message<textarea id="wa-msg" rows="3" style="resize:vertical">Test depuis Wise OS Dashboard v3.3.2 ✅</textarea></label>
      </div>
      <button class="btn btn-success" onclick="sendWATest()">📤 Envoyer</button>
      <div class="result" id="wa-result">—</div>
    </div>
  </div>
  <div class="card">
    <h3>📧 Test Magic Link</h3>
    <div class="form-row">
      <label>Email<input id="ml-email" placeholder="test@exemple.com" value="admin@wisedesign.pro"></label>
      <label>Nom<input id="ml-name" placeholder="Jean Dupont" value="Admin Wise"></label>
      <label>Langue<select id="ml-lang"><option value="fr">Français</option><option value="en">English</option><option value="es">Español</option></select></label>
    </div>
    <button class="btn btn-cyan" onclick="sendMagicLink()">✉️ Envoyer Magic Link Email</button>
    <div class="result" id="ml-result">—</div>
  </div>
</div>

</div><!-- /main -->

<script>
const B = '';  // base URL vide = même origine

function show(id, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  btn.classList.add('active');
}

function setResult(id, data, isErr) {
  const el = document.getElementById(id);
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  el.className = 'result ' + (isErr ? 'err' : 'ok');
}

async function api(endpoint, body) {
  try {
    const r = await fetch(B + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await r.json();
  } catch (e) { return { error: e.message }; }
}

async function apiGet(endpoint) {
  const r = await fetch(B + endpoint);
  return r.json();
}

// ── Home
async function getStatus() {
  const d = await apiGet('/status');
  setResult('home-result', d, !!d.error);
}
async function quickOTP() {
  const d = await api('/generate-otp', { phone: document.getElementById('h-phone').value, tenant_id: 1, type: document.getElementById('h-ctx').value });
  setResult('otp-result', d, !!d.error);
}

// ── WhatsApp
function connectWA() {
  const es = new EventSource(B + '/connect?tenant_id=1');
  es.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.type === 'qr') document.getElementById('qr-img').innerHTML = '<img src="' + d.qr + '" width="260">';
    if (d.type === 'connected') {
      document.getElementById('qr-img').innerHTML = '<p style="color:var(--green);font-weight:700;font-size:1.1rem">✅ WhatsApp Connecté !</p>';
      document.getElementById('wa-indicator').textContent = '✅ WA Connecté';
      document.getElementById('wa-indicator').className = 'wa-status ok';
    }
  };
}
async function sendWATest() {
  const d = await api('/send-message', { phone: document.getElementById('wa-phone').value, message: document.getElementById('wa-msg').value, tenant_id: 1 });
  setResult('wa-result', d, !!d.error);
}
async function sendMagicLink() {
  const d = await api('/send-magic', {
    channel: 'email',
    to: document.getElementById('ml-email').value,
    email: document.getElementById('ml-email').value,
    name: document.getElementById('ml-name').value,
    link: window.location.origin + '/login?token=DEMO_TOKEN_TEST',
    lang: document.getElementById('ml-lang').value
  });
  setResult('ml-result', d, !!d.error);
}

// ── Workflow helpers
async function sendOTP(phone, context, name, resultId) {
  const d = await api('/generate-otp', { phone, tenant_id: 1, type: context, ref_name: name });
  setResult(resultId, { action: 'OTP envoyé', context, ...d }, !!d.error);
  return d;
}
async function validateOTP(phone, code, context, resultId) {
  const d = await api('/validate-otp', { phone, code, context });
  setResult(resultId, d, !d.valid);
  return d;
}

// ── 1. ENFANCE
async function wf_enfance_scan() {
  const name = document.getElementById('en-name').value;
  const parent = document.getElementById('en-parent').value;
  const action = document.getElementById('en-action').value;
  const known = document.getElementById('en-known').value;
  if (action === 'sortie' && known === 'no') {
    setResult('en-result', { step: 'Personne inconnue détectée !', action: 'OTP envoyé au parent pour autorisation...', phone: parent }, false);
    await sendOTP(parent, 'enfance', name, 'en-result');
  } else {
    const d = await api('/send-scan-notification', { phone: parent, name, action, tenant_id: 1 });
    setResult('en-result', { action: action === 'entree' ? 'Entrée enregistrée ✅' : 'Sortie enregistrée ✅', notif: d }, false);
  }
}
async function wf_enfance_otp() {
  await validateOTP(document.getElementById('en-parent').value, document.getElementById('en-otp').value, 'enfance', 'en-result');
}

// ── 2. TRANSPORT
async function wf_transport() {
  const phone = document.getElementById('tr-phone').value;
  const action = document.getElementById('tr-action').value;
  const name = document.getElementById('tr-name').value;
  setResult('tr-result', { step: 'OTP envoyé pour valider ' + action + '...', gps: 'https://maps.google.com/?q=3.7501,8.7807' }, false);
  await sendOTP(phone, 'transport', name, 'tr-result');
}
async function wf_transport_otp() {
  await validateOTP(document.getElementById('tr-phone').value, document.getElementById('tr-otp').value, 'transport', 'tr-result');
}

// ── 3. ÉVÉNEMENT
async function wf_event_scan() {
  const type = document.getElementById('ev-type').value;
  const name = document.getElementById('ev-name').value;
  const ticket = document.getElementById('ev-ticket').value;
  if (type === 'vip') {
    setResult('ev-result', { step: 'Billet VIP détecté', action: 'OTP VIP envoyé...' }, false);
    await sendOTP(document.getElementById('h-phone').value || '240555445514', 'event', name, 'ev-result');
  } else {
    setResult('ev-result', { ticket, holder: name, result: 'VALIDÉ ✅ (HMAC OK — invalidé)', scan_result: 'success' }, false);
  }
}
async function wf_event_double() {
  setResult('ev-result', { error: 'DOUBLE SCAN DÉTECTÉ !', result: 'duplicate', message: 'Ce billet a déjà été scanné. Fraude potentielle.' }, true);
}
async function wf_event_otp() {
  await validateOTP(document.getElementById('h-phone').value || '240555445514', document.getElementById('ev-otp').value, 'event', 'ev-result');
}

// ── 4. RH
async function wf_rh_pointage() {
  const d = await api('/send-scan-notification', { phone: document.getElementById('rh-phone').value, name: document.getElementById('rh-name').value, action: document.getElementById('rh-action').value, tenant_id: 1 });
  const gps = document.getElementById('rh-gps').value;
  setResult('rh-result', { action: document.getElementById('rh-action').value === 'entree' ? 'Arrivée pointée ✅' : 'Départ pointé ✅', gps, notif: d }, false);
}
async function wf_rh_otp() {
  await validateOTP(document.getElementById('rh-phone').value, document.getElementById('rh-otp').value, 'rh', 'rh-result');
}

// ── 5. DIPLÔME
async function wf_diplome_verify() {
  const ref = document.getElementById('di-ref').value;
  setResult('di-result', { ref, holder: document.getElementById('di-name').value, institution: document.getElementById('di-inst').value, authentic: true, hmac_verified: true, message: 'Document authentique ✅' }, false);
}
async function wf_diplome_otp_send() {
  await sendOTP(document.getElementById('di-phone').value, 'diplome', document.getElementById('di-name').value, 'di-result');
}
async function wf_diplome_download() {
  const d = await api('/validate-otp', { phone: document.getElementById('di-phone').value, code: document.getElementById('di-otp').value, context: 'diplome' });
  setResult('di-result', d.valid ? { success: true, download_url: '/diplomes/' + document.getElementById('di-ref').value + '.pdf', message: 'Téléchargement autorisé ✅' } : d, !d.valid);
}

// ── 6. SANTÉ SOS
async function wf_sos_scan() {
  setResult('sa-result', { patient: document.getElementById('sa-name').value, blood_type: document.getElementById('sa-blood').value, allergies: document.getElementById('sa-allerg').value, status: 'Dossier vital accessible ✅', message: 'Alertes envoyées automatiquement' }, false);
}
async function wf_sos_alert() {
  const d = await api('/send-sos-alert', { phone: document.getElementById('sa-family').value, email: document.getElementById('sa-email').value, patient_name: document.getElementById('sa-name').value, blood_type: document.getElementById('sa-blood').value, allergies: document.getElementById('sa-allerg').value, tenant_id: 1 });
  setResult('sa-result', d, !!d.error);
}
async function wf_sos_otp() {
  const d = await api('/generate-otp', { phone: document.getElementById('sa-family').value, tenant_id: 1, type: 'sante_sos', ref_name: document.getElementById('sa-name').value });
  const val = await api('/validate-otp', { phone: document.getElementById('sa-family').value, code: document.getElementById('sa-otp').value, context: 'sante_sos' });
  setResult('sa-result', val.valid ? { access: 'AUTORISÉ ✅', patient: document.getElementById('sa-name').value, message: 'Accès médecin tiers accordé par la famille' } : val, !val.valid);
}

// ── 7. OFFICINE
async function wf_officine_scan() {
  await sendOTP(document.getElementById('of-phone').value, 'officine', document.getElementById('of-name').value, 'of-result');
}
async function wf_officine_deliver() {
  const d = await api('/validate-otp', { phone: document.getElementById('of-phone').value, code: document.getElementById('of-otp').value, context: 'officine' });
  setResult('of-result', d.valid ? { success: true, delivered: true, medications: document.getElementById('of-meds').value, ref: document.getElementById('of-ref').value, message: 'Médicaments délivrés ✅ Ordonnance invalidée' } : d, !d.valid);
}

// ── 8. LOGISTIQUE
async function wf_logistique_scan() {
  const action = document.getElementById('lo-action').value;
  if (action === 'livraison') {
    setResult('lo-result', { step: 'Livraison finale — OTP envoyé au destinataire...', colis: document.getElementById('lo-ref').value }, false);
    await sendOTP(document.getElementById('lo-phone').value, 'logistique', document.getElementById('lo-name').value, 'lo-result');
  } else {
    const d = await api('/send-scan-notification', { phone: document.getElementById('lo-phone').value, name: document.getElementById('lo-ref').value, action, tenant_id: 1 });
    setResult('lo-result', { action, colis: document.getElementById('lo-ref').value, notif: d }, false);
  }
}
async function wf_logistique_confirm() {
  const d = await api('/validate-otp', { phone: document.getElementById('lo-phone').value, code: document.getElementById('lo-otp').value, context: 'logistique' });
  setResult('lo-result', d.valid ? { success: true, colis: document.getElementById('lo-ref').value, recipient: document.getElementById('lo-name').value, message: 'Livraison confirmée ✅ Preuve anti-litige enregistrée' } : d, !d.valid);
}

// ── 9. RÉGILIEN
async function wf_regilien_verify() {
  setResult('re-result', { ref: document.getElementById('re-ref').value, type: document.getElementById('re-type').value, hmac_verified: true, signed_by: document.getElementById('re-name').value, message: 'Document intègre ✅' }, false);
}
async function wf_regilien_otp_send() {
  await sendOTP(document.getElementById('re-phone').value, 'regilien', document.getElementById('re-ref').value, 're-result');
}
async function wf_regilien_sign() {
  const d = await api('/validate-otp', { phone: document.getElementById('re-phone').value, code: document.getElementById('re-otp').value, context: 'regilien' });
  setResult('re-result', d.valid ? { success: true, signed: true, ref: document.getElementById('re-ref').value, signer: document.getElementById('re-name').value, hmac_new: 'sha256:' + Math.random().toString(36).slice(2,18) + '...', signed_at: new Date().toISOString(), message: 'Document signé électroniquement ✅' } : d, !d.valid);
}

// Auto-status au chargement
getStatus();
</script>
</body>
</html>`;

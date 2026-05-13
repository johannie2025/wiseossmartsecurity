// dashboard.js — Wise OS v3.3.5
// Export du HTML du dashboard Node.js (page /health visuelle)

export const dashboardHTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wise OS — Node.js Engine</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#080a0e;color:#eef0f5;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#0d1117;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:40px;max-width:520px;width:100%;text-align:center}
.logo{width:52px;height:52px;background:linear-gradient(135deg,#c9a84c,#e8c96a);border-radius:14px;display:grid;place-items:center;font-size:22px;font-weight:700;color:#0a0a0a;margin:0 auto 20px;font-family:monospace}
h1{font-size:24px;font-weight:700;letter-spacing:-0.02em;margin-bottom:8px}
.sub{color:#6b7a8d;font-size:14px;margin-bottom:32px}
.status-row{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:24px}
.dot{width:10px;height:10px;border-radius:50%;background:#1ed88a;box-shadow:0 0 0 3px rgba(30,216,138,0.2);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 3px rgba(30,216,138,0.2)}50%{box-shadow:0 0 0 6px rgba(30,216,138,0.05)}}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:28px}
.metric{background:#141920;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px}
.metric-val{font-size:22px;font-weight:700;font-family:monospace;color:#c9a84c}
.metric-label{font-size:11px;color:#6b7a8d;margin-top:4px}
.routes{text-align:left;background:#141920;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;font-size:12px}
.route{padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;justify-content:space-between;align-items:center;gap:8px;color:#9aaab8}
.route:last-child{border:none}
.method{background:rgba(59,130,246,0.12);color:#93c5fd;padding:2px 8px;border-radius:5px;font-family:monospace;font-size:10px}
.method.post{background:rgba(30,216,138,0.1);color:#6ee7b7}
</style>
</head>
<body>
<div class="card">
  <div class="logo">W</div>
  <h1>Wise OS Node.js Engine</h1>
  <div class="sub">v3.3.5 — Baileys + QR + Nodemailer + SSE</div>
  <div class="status-row">
    <div class="dot"></div>
    <span style="font-size:14px;color:#1ed88a;font-weight:500">Serveur opérationnel</span>
  </div>
  <div class="grid">
    <div class="metric"><div class="metric-val" id="uptime">—</div><div class="metric-label">Uptime</div></div>
    <div class="metric"><div class="metric-val" id="sessions">—</div><div class="metric-label">Sessions WA</div></div>
  </div>
  <div class="routes">
    <div class="route"><span>GET /health</span><span class="method">GET</span></div>
    <div class="route"><span>GET /connect?tenant_id=</span><span class="method">SSE</span></div>
    <div class="route"><span>POST /generate-otp</span><span class="method post">POST</span></div>
    <div class="route"><span>POST /validate-otp</span><span class="method post">POST</span></div>
    <div class="route"><span>POST /send-message</span><span class="method post">POST</span></div>
    <div class="route"><span>POST /send-magic</span><span class="method post">POST</span></div>
    <div class="route"><span>POST /send-sos-alert</span><span class="method post">POST</span></div>
    <div class="route"><span>POST /send-scan-notification</span><span class="method post">POST</span></div>
    <div class="route"><span>POST /notify-subscription</span><span class="method post">POST</span></div>
  </div>
</div>
<script>
let start = Date.now();
function fmt(ms){
  const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60),d=Math.floor(h/24);
  if(d>0) return d+'j '+( h%24)+'h';
  if(h>0) return h+'h '+(m%60)+'m';
  return m+'m '+(s%60)+'s';
}
async function refresh(){
  document.getElementById('uptime').textContent = fmt(Date.now()-start);
  try{
    const r = await fetch('/status');
    const d = await r.json();
    document.getElementById('sessions').textContent = d.activeSessions ?? '—';
  }catch(_){}
}
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

// registerDashboard(app) — operator traffic dashboard at GET /dashboard.
// Plain semantic HTML + vanilla JS, no external deps: the page authenticates
// with the OPERATOR_KEY (stored in sessionStorage) and polls /v1/stats and
// /v1/stats/recent. It is deliberately NOT linked from the public NAV or
// /llms.txt — the operator types the URL; the data it shows is operator-only.

import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.js';

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard — licita-agent (operator)</title>
<style>
:root { color-scheme: light; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  margin: 0; background: #fafafa; color: #1f2430; line-height: 1.55; }
main { max-width: 70rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
h1 { font-size: 1.5rem; margin: 0 0 .25rem; color: #182030; }
h2 { font-size: 1.1rem; margin-top: 1.75rem; margin-bottom: .25rem; color: #2a3242;
  border-bottom: 1px solid #e3e6eb; padding-bottom: .25rem; }
h3.h3 { font-size: .9rem; color: #4a5468; margin: .75rem 0 .25rem; }
a { color: #2f5d8a; }
code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .85em; }
table { border-collapse: collapse; width: 100%; margin: .6rem 0; font-size: .85rem; }
th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #e3e6eb; vertical-align: top; }
th { color: #4a5468; font-weight: 600; white-space: nowrap; }
td.num, th.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.muted { color: #5b6575; }
input, button { font: inherit; }
button { cursor: pointer; }
.kpis { display: flex; flex-wrap: wrap; gap: .75rem; margin: .75rem 0; }
.kpi { background: #fff; border: 1px solid #e3e6eb; border-radius: 8px; padding: .6rem .9rem; min-width: 8.5rem; }
.kpi-label { font-size: .72rem; color: #5b6575; text-transform: uppercase; letter-spacing: .03em; }
.kpi-val { font-size: 1.35rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.bar { background: #2f5d8a; height: 8px; border-radius: 4px; min-width: 2px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1.5rem; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 1.5rem; }
@media (max-width: 720px) { .grid2, .grid3 { grid-template-columns: 1fr; } }
.toolbar { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; margin: .5rem 0; }
.st-2 { color: #1a7f37; font-weight: 600; }
.st-4 { color: #9a6700; font-weight: 600; }
.st-5 { color: #cf222e; font-weight: 600; }
.err { color: #cf222e; }
</style>
</head>
<body>
<main>
<h1>Dashboard — licita-agent <span class="muted">(operator)</span></h1>
<p class="muted">Who accessed the API, which endpoints, when, paid vs unpaid, KPIs, revenue and failures. Data is raw <code>request_logs</code> + <code>payments</code> aggregates.</p>

<div id="login" hidden>
  <form id="login-form">
    <label for="key">Operator key</label>
    <input type="password" id="key" name="key" autocomplete="current-password" autofocus>
    <button type="submit">Unlock</button>
    <p id="login-msg" class="err"></p>
  </form>
</div>

<div id="dash" hidden>
  <p class="toolbar">
    <label><input type="checkbox" id="auto-refresh" checked> Auto-refresh 15s</label>
    <button id="refresh" type="button">Refresh</button>
    <span id="last-updated" class="muted"></span>
  </p>

  <h2>KPIs</h2>
  <div id="kpis" class="kpis"></div>

  <h2>Traffic by endpoint</h2>
  <div id="by-endpoint"></div>

  <h2>Recent activity</h2>
  <div id="recent"></div>

  <h2>MCP discovery</h2>
  <div id="mcp-discovery"></div>

  <h2>Who accessed</h2>
  <div class="grid2">
    <div><h3 class="h3">Repeat paid clients</h3><div id="repeat-clients"></div></div>
    <div><h3 class="h3">User agents</h3><div id="user-agents"></div></div>
  </div>

  <h2>Top requested</h2>
  <div class="grid3">
    <div><h3 class="h3">CPVs</h3><div id="top-cpvs"></div></div>
    <div><h3 class="h3">Buyers</h3><div id="top-buyers"></div></div>
    <div><h3 class="h3">Companies</h3><div id="top-companies"></div></div>
  </div>

  <h2>Payments &amp; queries</h2>
  <div class="grid2">
    <div><h3 class="h3">By network / provider</h3><div id="payments-net"></div></div>
    <div><h3 class="h3">Zero-result queries</h3><div id="zero-result"></div></div>
  </div>
</div>
</main>

<script>
const KEY = 'licita_operator_key';
const LS = sessionStorage;
const $ = (id) => document.getElementById(id);
const state = { timer: null };

// Escape every dynamic value before it touches innerHTML — user_agent / q /
// client_key come from clients and must never execute as markup.
function esc(v) {
  const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(v ?? '').replace(/[&<>"']/g, (c) => m[c]);
}
function short(v, n) {
  const s = String(v ?? '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? '$' + n.toFixed(2) : '—';
}
function pct(r) {
  if (r === null || r === undefined) return '—';
  return (Number(r) * 100).toFixed(2) + '%';
}
function statusClass(st) {
  const n = Number(st);
  if (n >= 500) return 'st-5';
  if (n >= 400) return 'st-4';
  if (n >= 200 && n < 300) return 'st-2';
  return '';
}
function kvTable(rows, label, codeFirst) {
  if (!rows || rows.length === 0) return '<p class="muted">None.</p>';
  return '<table><thead><tr><th>' + label + '</th><th class="num">Requests</th></tr></thead><tbody>' +
    rows.map((r) => {
      const k = Object.keys(r).find((k2) => k2 !== 'requests') || '';
      const cell = codeFirst ? '<code>' + esc(r[k]) + '</code>' : esc(r[k]);
      return '<tr><td>' + cell + '</td><td class="num">' + esc(r.requests) + '</td></tr>';
    }).join('') +
    '</tbody></table>';
}

function render(stats, recent) {
  const paidTotal = (stats.requests_by_endpoint || []).reduce((s, r) => s + Number(r.paid_requests || 0), 0);
  const kpis = [
    ['Unique clients', esc(stats.unique_clients ?? 0)],
    ['Total requests', esc((stats.failed_requests_rate || {}).total ?? 0)],
    ['Paid requests', esc(paidTotal)],
    ['Revenue', esc(money((stats.payments || {}).revenue_usd))],
    ['Payment required', esc(stats.payment_required_responses ?? 0)],
    ['Failed rate', esc(pct((stats.failed_requests_rate || {}).rate))],
  ];
  $('kpis').innerHTML = kpis
    .map((p) => '<div class="kpi"><div class="kpi-label">' + p[0] + '</div><div class="kpi-val">' + p[1] + '</div></div>')
    .join('');

  const byEp = stats.requests_by_endpoint || [];
  const maxEp = byEp.reduce((m, r) => Math.max(m, Number(r.requests)), 0) || 1;
  $('by-endpoint').innerHTML = byEp.length === 0
    ? '<p class="muted">No requests yet.</p>'
    : '<table><thead><tr><th>Endpoint</th><th class="num">Requests</th><th class="num">Paid</th><th></th></tr></thead><tbody>' +
      byEp.map((r) => '<tr><td><code>' + esc(r.endpoint) + '</code></td>' +
        '<td class="num">' + esc(r.requests) + '</td>' +
        '<td class="num">' + esc(r.paid_requests) + '</td>' +
        '<td><div class="bar" style="width:' + Math.round((Number(r.requests) / maxEp) * 100) + '%"></div></td></tr>').join('') +
      '</tbody></table>';

  $('recent').innerHTML = recent.length === 0
    ? '<p class="muted">No requests logged yet.</p>'
    : '<table><thead><tr><th>Time</th><th>Client</th><th>Endpoint</th><th class="num">Status</th><th>Paid</th><th>Source</th><th>User agent</th><th class="num">Latency ms</th><th>Context</th></tr></thead><tbody>' +
      recent.map((r) => {
        const ctxParts = [];
        if (r.q) ctxParts.push('q=' + r.q);
        if (r.cpv) ctxParts.push('cpv=' + r.cpv);
        if (r.buyer) ctxParts.push('buyer=' + r.buyer);
        if (r.company) ctxParts.push('company=' + r.company);
        const when = r.ts ? new Date(r.ts).toLocaleString() : '—';
        return '<tr>' +
          '<td class="num">' + esc(when) + '</td>' +
          '<td title="' + esc(r.client_key) + '"><code>' + esc(short(r.client_key, 10)) + '</code></td>' +
          '<td><code>' + esc(r.endpoint) + '</code></td>' +
          '<td class="num ' + statusClass(r.status) + '">' + esc(r.status ?? '') + '</td>' +
          '<td>' + (r.paid ? 'yes' : 'no') + '</td>' +
          '<td>' + esc(r.source) + '</td>' +
          '<td title="' + esc(r.user_agent) + '">' + esc(short(r.user_agent, 40)) + '</td>' +
          '<td class="num">' + esc(r.latency_ms) + '</td>' +
          '<td class="muted">' + esc(ctxParts.join(' · ')) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';

  const repeatTop = (stats.repeat_clients || {}).top || [];
  $('repeat-clients').innerHTML = repeatTop.length === 0
    ? '<p class="muted">No repeat paid clients.</p>'
    : '<table><thead><tr><th>Client key</th><th class="num">Paid requests</th></tr></thead><tbody>' +
      repeatTop.map((r) => '<tr><td title="' + esc(r.client_key) + '"><code>' + esc(short(r.client_key, 10)) + '</code></td><td class="num">' + esc(r.paid_requests) + '</td></tr>').join('') +
      '</tbody></table>';

  const uaTop = (stats.unique_user_agents || {}).top || [];
  $('user-agents').innerHTML = uaTop.length === 0
    ? '<p class="muted">No user agents recorded.</p>'
    : '<table><thead><tr><th>User agent</th><th class="num">Requests</th></tr></thead><tbody>' +
      uaTop.map((r) => '<tr><td title="' + esc(r.user_agent) + '">' + esc(short(r.user_agent, 40)) + '</td><td class="num">' + esc(r.requests) + '</td></tr>').join('') +
      '</tbody></table>';

  const md = stats.mcp_discovery || {};
  const mdKpis = [
    ['Handshakes', esc(md.initialize_count ?? 0)],
    ['tools/list', esc(md.tools_list_count ?? 0)],
    ['MCP clients', esc(md.mcp_clients ?? 0)],
    ['Discovered clients', esc(md.discovered_clients ?? 0)],
  ];
  const mdTopUa = md.top_handshake_user_agents || [];
  $('mcp-discovery').innerHTML =
    '<div class="kpis">' + mdKpis
      .map((p) => '<div class="kpi"><div class="kpi-label">' + p[0] + '</div><div class="kpi-val">' + p[1] + '</div></div>')
      .join('') + '</div>' +
    (mdTopUa.length === 0
      ? '<p class="muted">No MCP handshakes recorded yet.</p>'
      : '<h3 class="h3">Handshake user agents</h3>' +
        '<table><thead><tr><th>User agent</th><th class="num">Handshakes</th></tr></thead><tbody>' +
        mdTopUa.map((r) => '<tr><td title="' + esc(r.user_agent) + '">' + esc(short(r.user_agent, 40)) + '</td><td class="num">' + esc(r.requests) + '</td></tr>').join('') +
        '</tbody></table>');

  const topReq = stats.top_requested || {};
  $('top-cpvs').innerHTML = kvTable(topReq.cpvs, 'CPV', true);
  $('top-buyers').innerHTML = kvTable(topReq.buyers, 'Buyer', false);
  $('top-companies').innerHTML = kvTable(topReq.companies, 'Company', false);

  const payNet = (stats.payments || {}).by_network_provider || [];
  $('payments-net').innerHTML = payNet.length === 0
    ? '<p class="muted">No payments yet.</p>'
    : '<table><thead><tr><th>Provider</th><th>Network</th><th class="num">Count</th><th class="num">Amount (USD)</th></tr></thead><tbody>' +
      payNet.map((r) => '<tr><td>' + esc(r.provider) + '</td><td><code>' + esc(r.network) + '</code></td><td class="num">' + esc(r.count) + '</td><td class="num">' + esc(money(r.amount_usd)) + '</td></tr>').join('') +
      '</tbody></table>';

  const zr = stats.zero_result_queries || {};
  $('zero-result').innerHTML =
    '<p>Count: <strong>' + esc(zr.count ?? 0) + '</strong> · Rate: <strong>' + esc(pct(zr.rate)) + '</strong></p>';
}

function setLastUpdated(err) {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  $('last-updated').textContent = err ? 'Error: ' + err : 'Last updated ' + t;
}

async function load() {
  const key = LS.getItem(KEY);
  if (!key) { showLogin(''); return; }
  try {
    const [s, r] = await Promise.all([
      fetch('/v1/stats', { headers: { 'x-operator-key': key } }),
      fetch('/v1/stats/recent?limit=50', { headers: { 'x-operator-key': key } }),
    ]);
    if (s.status === 401 || r.status === 401) { invalidKey(); return; }
    if (!s.ok) throw new Error('GET /v1/stats → ' + s.status);
    if (!r.ok) throw new Error('GET /v1/stats/recent → ' + r.status);
    const stats = await s.json();
    const recent = await r.json();
    render(stats.data, recent.data);
    $('login').hidden = true;
    $('dash').hidden = false;
    setLastUpdated('');
  } catch (err) {
    setLastUpdated(err.message || String(err));
  }
}

function showLogin(msg) {
  LS.removeItem(KEY);
  $('login').hidden = false;
  $('dash').hidden = true;
  $('login-msg').textContent = msg;
  $('key').focus();
}
function invalidKey() {
  showLogin('Invalid or missing operator key');
}

function updateTimer() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  if ($('auto-refresh').checked) state.timer = setInterval(load, 15000);
}

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('key').value.trim();
  if (!v) return;
  LS.setItem(KEY, v);
  $('key').value = '';
  load();
});
$('refresh').addEventListener('click', load);
$('auto-refresh').addEventListener('change', updateTimer);

updateTimer();
if (LS.getItem(KEY)) { load(); } else { showLogin(''); }
</script>
</body>
</html>
`;

/** Register the operator traffic dashboard at GET /dashboard. Not in the public NAV. */
export function registerDashboard(app: FastifyInstance, _config: AppConfig): void {
  app.get('/dashboard', async (_req, reply) => reply.type('text/html; charset=utf-8').send(PAGE));
}
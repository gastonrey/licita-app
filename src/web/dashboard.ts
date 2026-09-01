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
<title>Dashboard — Licita (operator)</title>
<style>
:root { color-scheme: light; --ink:#16232B; --paper:#F6F3EA; --rule:#C9C3B5; --signal:#B9472E; --verified:#356B52; --muted:#5B6870; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  margin: 0; background: var(--paper); color: var(--ink); line-height: 1.55; font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif; }
main { max-width: 70rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
h1 { font-family: 'Source Serif 4', Georgia, serif; font-size: clamp(2rem,5vw,3.5rem); margin: 0 0 .25rem; color: var(--ink); text-wrap: balance; }
h2 { font-size: 1.1rem; margin-top: 1.75rem; margin-bottom: .25rem; color: #2a3242;
  border-bottom: 1px solid #e3e6eb; padding-bottom: .25rem; }
h3.h3 { font-size: .9rem; color: #4a5468; margin: .75rem 0 .25rem; }
a { color: var(--verified); }
code { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .85em; }
table { border-collapse: collapse; width: 100%; margin: .6rem 0; font-size: .85rem; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { color: #4a5468; font-weight: 600; white-space: nowrap; }
td.num, th.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.muted { color: var(--muted); }
input, button { font: inherit; }
button { cursor: pointer; touch-action: manipulation; min-height:44px; }
.kpis { display: flex; flex-wrap: wrap; gap: .75rem; margin: .75rem 0; }
.kpi { background: #fff; border: 1px solid var(--rule); padding: .75rem .9rem; min-width: 8.5rem; }
.kpi-label { font-size: .72rem; color: #5b6575; text-transform: uppercase; letter-spacing: .03em; }
.kpi-val { font-size: 1.35rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.pagination { display: flex; align-items: center; justify-content: center; gap: .75rem; margin: .75rem 0 1.25rem; }
.pagination button { min-width: 2.75rem; border: 1px solid var(--rule); background: #fff; color: var(--ink); }
.pagination button:disabled { cursor: not-allowed; opacity: .45; }
.pagination span { color: var(--muted); font-size: .85rem; }
.endpoint-list { display: grid; gap: .65rem; margin: .6rem 0 1.25rem; }
.endpoint-card { display: grid; grid-template-columns: minmax(0, 1.7fr) repeat(3, minmax(4.5rem, .7fr)); gap: .75rem; align-items: center; padding: .75rem .85rem; background: #fff; border: 1px solid var(--rule); }
.endpoint-name { min-width: 0; overflow-wrap: anywhere; }
.endpoint-name code { font-size: .9rem; }
.endpoint-stat { min-width: 0; }
.endpoint-stat-label { display: block; color: var(--muted); font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; }
.endpoint-stat-value { display: block; font-variant-numeric: tabular-nums; font-weight: 600; }
@media (max-width: 720px) { .endpoint-card { grid-template-columns: minmax(0, 1fr) repeat(2, minmax(4rem, .8fr)); } .endpoint-card .endpoint-stat:last-child { grid-column: 2 / -1; } }
.bar { background: var(--verified); height: 8px; min-width: 2px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1.5rem; }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 1.5rem; }
@media (max-width: 720px) { .grid2, .grid3 { grid-template-columns: 1fr; } }
.toolbar { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; margin: .5rem 0; }
.st-2 { color: #1a7f37; font-weight: 600; }
.st-4 { color: #9a6700; font-weight: 600; }
.st-5 { color: #cf222e; font-weight: 600; }
.err { color: #cf222e; }
.tabs { display:flex; flex-wrap:wrap; gap:.4rem; margin:1rem 0; }
 .tabs button { border:1px solid var(--rule); background:#fff; padding:.45rem .7rem; }
 .tabs button[aria-selected="true"] { border-bottom:3px solid var(--signal); font-weight:700; }
 section[hidden] { display: none; }
 .warning { color:#7b351f; background:#fff4ce; border:1px solid #c98b63; padding:.6rem .8rem; }
  .table-wrap { overflow-x:auto; max-width:100%; }
  #recent, #leads, #by-endpoint, #endpoint-economics, #zero-result, #zero-result-by-endpoint, #repeat-clients, #user-agents, #mcp-discovery { overflow-x:auto; }
  .filter-chip { display:inline-block; border:1px solid var(--rule); padding:.2rem .5rem; margin:.15rem; background:#fff; }
 :focus-visible { outline:3px solid var(--signal); outline-offset:3px; }
 @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:.01ms !important; transition-duration:.01ms !important; } }
</style>
</head>
<body>
<main>
<h1>Dashboard — Licita <span class="muted">(operator)</span></h1>
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
    <label>From <input type="date" id="from"></label>
    <label>To <input type="date" id="to"></label>
    <label><input type="checkbox" id="auto-refresh" checked> Auto-refresh 15s</label>
    <button id="refresh" type="button">Refresh</button>
     <span id="last-updated" class="muted" aria-live="polite"></span>
  </p>

   <nav class="tabs" role="tablist" aria-label="Dashboard sections">
     <button role="tab" aria-controls="panel-overview" type="button" data-tab-button="overview" data-view="overview">Overview</button>
     <button role="tab" aria-controls="panel-growth" type="button" data-tab-button="growth" data-view="growth">Growth</button>
     <button role="tab" aria-controls="panel-leads" type="button" data-tab-button="leads" data-view="leads">Leads</button>
     <button role="tab" aria-controls="panel-economics" type="button" data-tab-button="economics" data-view="economics">Endpoint economics</button>
     <button role="tab" aria-controls="panel-gaps" type="button" data-tab-button="gaps" data-view="data-quality">Data Quality</button>
  </nav>
   <p id="period" class="muted" aria-live="polite">All available dates</p><div id="filter-chips" aria-label="Active filters"></div><p id="load-state" class="muted" aria-live="polite"></p><button id="retry" type="button">Retry</button>
    <section id="panel-overview" role="tabpanel" data-tab="overview" aria-label="Overview">
   <h2>KPIs</h2><div id="kpis" class="kpis"></div>
   <h2>Traffic by endpoint</h2><div id="by-endpoint"></div>
    <h2>Recent activity</h2><div id="recent"></div><div id="pager-recent" class="pagination" aria-label="Recent activity pagination"></div>
   </section>
    <section id="panel-growth" role="tabpanel" data-tab="growth" aria-label="Growth">
    <h2>Growth cohorts</h2>
  <div class="kpis">
    <div class="kpi"><div class="kpi-label">Weekly active paying agents</div><div class="kpi-val" id="nsm"></div></div>
  </div>
  <div id="growth-funnel"></div>
   <div id="growth-rows"></div><div id="funnel-warning" role="alert"></div>
   <h2>MCP discovery</h2><div id="mcp-discovery"></div>
   </section>
    <section id="panel-leads" role="tabpanel" data-tab="leads" aria-label="Leads"><h2>Demo pipeline</h2><p class="muted">Email is shown only to authorized operators. <button id="open-details" type="button" aria-expanded="false">Open details</button></p><div id="lead-kpis" class="kpis" aria-label="Status: new Status: contacted Status: used Status: paid"></div><div id="leads" hidden></div></section>
    <section id="panel-economics" role="tabpanel" data-tab="economics" aria-label="Endpoint economics"><h2>Endpoint economics</h2><div id="endpoint-economics"></div>
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

   <h2>Payments</h2>
  <div class="grid2">
     <div><h3 class="h3">By network / provider</h3><div id="payments-net"></div></div>
   </div>
   </section>
    <section id="panel-gaps" role="tabpanel" data-tab="gaps" aria-label="Data gaps"><h2>Data gaps</h2><p class="muted">Measured zero-result queries by endpoint. Unavailable panels remain labeled, not converted to zero.</p><button id="clear-filters" type="button">Clear filters</button><div id="zero-result"></div><div id="zero-result-by-endpoint"></div></section>
</div>
</main>

<script>
const KEY = 'licita_operator_key';
const LS = sessionStorage;
const $ = (id) => document.getElementById(id);
const initialParams = new URLSearchParams(location.search);
const state = { timer: null, tab: initialParams.get('view') === 'data-quality' ? 'gaps' : initialParams.get('view') || initialParams.get('tab') || 'overview', page: initialParams.get('page') || '1' };
const validTabs = ['overview', 'growth', 'leads', 'economics', 'gaps'];
 function syncUrl(tab) { const params = new URLSearchParams(location.search); params.set('view', tab === 'gaps' ? 'data-quality' : tab); if ($('from').value) params.set('from', $('from').value); else params.delete('from'); if ($('to').value) params.set('to', $('to').value); else params.delete('to'); params.set('page', state.page); history.pushState({}, '', location.pathname + '?' + params.toString()); renderFilters(); }
function restoreUrl() { const params = new URLSearchParams(location.search); const view = params.get('view'); state.tab = view === 'data-quality' ? 'gaps' : validTabs.includes(view) ? view : 'overview'; const page = Number(params.get('page')); state.page = Number.isInteger(page) && page > 0 ? String(page) : '1'; $('from').value = params.get('from') || ''; $('to').value = params.get('to') || ''; }

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
const numberFormat = new Intl.NumberFormat();
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? '$' + numberFormat.format(n) : 'Not available';
}
function pct(r) {
  if (r === null || r === undefined) return 'Not available';
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
function renderFilters() { const from = $('from').value, to = $('to').value; $('period').textContent = from || to ? 'Period: ' + (from || 'beginning') + ' → ' + (to || 'today') : 'All available dates'; $('filter-chips').innerHTML = (from ? '<span class="filter-chip">From: '+esc(from)+'</span>' : '') + (to ? '<span class="filter-chip">To: '+esc(to)+'</span>' : ''); }

const PAGE_SIZE = 10;
function renderPager(id, page, total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  if (pages <= 1) return '';
  return '<button type="button" data-page-target="' + esc(id) + '" data-page="' + (current - 1) + '"' + (current <= 1 ? ' disabled' : '') + ' aria-label="Previous page">‹</button>' +
    '<span aria-live="polite">Page ' + current + ' of ' + pages + '</span>' +
    '<button type="button" data-page-target="' + esc(id) + '" data-page="' + (current + 1) + '"' + (current >= pages ? ' disabled' : '') + ' aria-label="Next page">›</button>';
}

function bindPager(id, rows, renderRows) {
  const pager = $('pager-' + id);
  if (!pager) return;
  const page = Math.min(Math.max(1, Number(state.page) || 1), Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  pager.innerHTML = renderPager(id, page, rows.length);
  pager.querySelectorAll('button[data-page]').forEach((button) => button.addEventListener('click', () => {
    state.page = String(Number(button.getAttribute('data-page')) || 1);
    syncUrl(state.tab);
    renderRows(pageRows(rows, Number(state.page)));
  }));
}

function pageRows(rows, page) { return rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE); }

function render(stats, recent) {
  const paidTotal = (stats.requests_by_endpoint || []).reduce((s, r) => s + Number(r.paid_requests || 0), 0);
  const kpis = [
      ['Revenue', esc(money((stats.payments || {}).revenue_usd))],
      ['Unique clients', esc(stats.unique_clients ?? 0)],
      ['Total requests', esc(stats.total_requests ?? (stats.failed_requests_rate || {}).total ?? 0)],
      ['Paid requests', esc(paidTotal)],
      ['Payment required', esc(stats.payment_required_responses ?? 0)],
      ['Failed rate', esc(pct((stats.failed_requests_rate || {}).rate))],
    ];
  $('kpis').innerHTML = kpis
    .map((p) => '<div class="kpi"><div class="kpi-label">' + p[0] + '</div><div class="kpi-val">' + p[1] + '</div></div>')
    .join('');

  const g = stats.growth || {};
  $('nsm').textContent = esc(g.weekly_active_paying_agents ?? 0);
  const gLabels = g.source_labels || ['discovered', 'initialized', 'queried', 'demo', 'paid', 'repeated', 'revenue'];
  const gFunnel = g.funnel || {};
  const fRows = gLabels.map((l) => {
    const disp = l === 'revenue' ? money(gFunnel[l]) : esc(gFunnel[l] ?? 0);
    return '<tr><td>' + esc(l) + '</td><td class="num">' + disp + '</td></tr>';
  });
   $('growth-funnel').innerHTML = '<h3 class="h3">Cohort counts (not a funnel)</h3>' +
    '<table><thead><tr><th>Stage</th><th class="num">Count</th></tr></thead><tbody>' +
    fRows.join('') +
    '</tbody></table>';
  const gRows = [
    ['Free demo calls', esc(g.free_demo_calls ?? 0)],
    ['Research calls', esc(g.research_calls ?? 0)],
    ['Research paid calls', esc(g.research_paid_calls ?? 0)],
    ['Research conversion', pct(g.research_conversion)],
    ['Paid agents', esc(g.paid_agents ?? 0)],
    ['Repeat paid agents', esc(g.repeat_paid_agents ?? 0)],
    ['Calls per agent', esc(g.calls_per_agent ?? 0)],
    ['Revenue per agent', money(g.revenue_per_agent)],
    ['Time to second purchase (days)', esc(g.time_to_second_purchase_days ?? 0)],
     ['First payment', esc(g.first_payment ? dateFormat.format(new Date(g.first_payment)) : '—')],
     ['First repeat purchase', esc(g.second_payment ? dateFormat.format(new Date(g.second_payment)) : '—')],
  ];
  $('growth-rows').innerHTML = '<h3 class="h3">Detail</h3>' +
    '<table><tbody>' +
    gRows.map((r) => '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td></tr>').join('') +
     '</tbody></table>';
  const conversions = (g.funnel || {}).conversions || [];
  $('funnel-warning').innerHTML = conversions.some((c) => Number(c.rate) > 1)
    ? '<p class="warning">A funnel conversion is above 100%. This is shown as recorded: initialized counts handshake rows while queried counts distinct clients.</p>' : '';

  const byEp = (stats.requests_by_endpoint || []).filter((r) => Number(r.requests || 0) > 0);
  $('by-endpoint').innerHTML = byEp.length === 0
    ? '<p class="muted">No requests yet.</p>'
    : '<div class="endpoint-list" aria-label="Visited endpoints">' +
      byEp.map((r) => '<article class="endpoint-card"><div class="endpoint-name"><code>' + esc(r.endpoint) + '</code></div>' +
        '<div class="endpoint-stat"><span class="endpoint-stat-label">Visits</span><span class="endpoint-stat-value">' + esc(r.requests) + '</span></div>' +
        '<div class="endpoint-stat"><span class="endpoint-stat-label">Paid</span><span class="endpoint-stat-value">' + esc(r.paid_requests) + '</span></div>' +
        '<div class="endpoint-stat"><span class="endpoint-stat-label">Paid rate</span><span class="endpoint-stat-value">' + esc(pct(Number(r.requests) > 0 ? Number(r.paid_requests || 0) / Number(r.requests) : null)) + '</span></div></article>').join('') +
      '</div>';

  const renderRecentRows = (rows) => rows.length === 0
    ? '<p class="muted">No requests logged yet.</p>'
    : '<table><thead><tr><th>Time</th><th>Client</th><th>Endpoint</th><th class="num">Status</th><th>Paid</th><th>Source</th><th>User agent</th><th class="num">Latency ms</th><th>Context</th></tr></thead><tbody>' +
       rows.map((r) => {
        const ctxParts = [];
        if (r.q) ctxParts.push('q=' + r.q);
        if (r.cpv) ctxParts.push('cpv=' + r.cpv);
        if (r.buyer) ctxParts.push('buyer=' + r.buyer);
        if (r.company) ctxParts.push('company=' + r.company);
         const when = r.ts ? dateFormat.format(new Date(r.ts)) : '—';
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
  $('recent').innerHTML = renderRecentRows(pageRows(recent, Number(state.page) || 1));
  bindPager('recent', recent, (rows) => { $('recent').innerHTML = renderRecentRows(rows); });

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
  const zrTop = zr.top || [];
  $('zero-result').innerHTML =
    '<p>Count: <strong>' + esc(zr.count ?? 0) + '</strong> · Rate: <strong>' + esc(pct(zr.rate)) + '</strong></p>' +
    '<h3 class="h3">Top queries without results — data gaps</h3>' +
    (zrTop.length === 0
      ? '<p class="muted">None.</p>'
      : '<table><thead><tr><th>Query</th><th class="num">Attempts</th></tr></thead><tbody>' +
         zrTop.map((r) => '<tr><td><code>' + esc(r.q) + '</code></td><td class="num">' + esc(r.requests) + '</td></tr>').join('') +
       '</tbody></table>');
  const economics = (stats.endpoint_economics || []).filter((r) => Number(r.requests || 0) > 0 && Number(r.paid_requests || 0) > 0);
  $('endpoint-economics').innerHTML = economics.length === 0 ? '<p class="muted">No paid endpoint activity yet.</p>' :
    '<div class="endpoint-list" aria-label="Paid endpoint economics">' +
    economics.map((r) => '<article class="endpoint-card"><div class="endpoint-name"><code>' + esc(r.endpoint) + '</code></div>' +
      '<div class="endpoint-stat"><span class="endpoint-stat-label">Revenue</span><span class="endpoint-stat-value">' + esc(money(r.revenue_usd)) + '</span></div>' +
      '<div class="endpoint-stat"><span class="endpoint-stat-label">Paid calls</span><span class="endpoint-stat-value">' + esc(r.paid_requests) + '</span></div>' +
      '<div class="endpoint-stat"><span class="endpoint-stat-label">Per call</span><span class="endpoint-stat-value">' + esc(money(r.revenue_per_call)) + '</span></div></article>').join('') +
    '</div>';
  const gaps = stats.zero_result_by_endpoint || [];
  $('zero-result-by-endpoint').innerHTML = gaps.length === 0 ? '' : '<h3 class="h3">Zero-result rate by endpoint</h3><table><thead><tr><th>Endpoint</th><th class="num">Zero results</th><th class="num">Usage</th></tr></thead><tbody>' + gaps.map((r) => '<tr><td><code>' + esc(r.endpoint) + '</code></td><td class="num">' + esc(r.zero_result_requests) + '</td><td class="num">' + esc(r.total_requests) + '</td></tr>').join('') + '</tbody></table>';
}

function setLastUpdated(err) {
  const t = dateFormat.format(new Date());
  $('last-updated').textContent = err ? 'Error: ' + err : 'Last updated ' + t;
}

async function load() {
  const key = LS.getItem(KEY);
  if (!key) { showLogin(''); return; }
  try {
    $('last-updated').textContent = 'Loading…';
    const from = $('from').value, to = $('to').value;
     const range = from || to ? '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) : '';
     renderFilters(); $('load-state').textContent = 'Loading selected period…';
    const [s, r, d] = await Promise.all([
      fetch('/v1/stats' + range, { headers: { 'x-operator-key': key } }),
       fetch('/v1/stats/recent?limit=50' + (range ? '&' + range.slice(1) : ''), { headers: { 'x-operator-key': key } }),
       fetch('/v1/stats/demo?limit=200' + (range ? '&' + range.slice(1) : ''), { headers: { 'x-operator-key': key } }),
    ]);
    if (s.status === 401 || r.status === 401 || d.status === 401) { invalidKey(); return; }
    if (!s.ok) throw new Error('GET /v1/stats → ' + s.status);
    if (!r.ok) throw new Error('GET /v1/stats/recent → ' + r.status);
    const stats = await s.json();
    const recent = await r.json();
    render(stats.data, recent.data);
     renderLeads(d.data);
     selectTab(state.tab || 'overview');
    $('login').hidden = true;
    $('dash').hidden = false;
     setLastUpdated(''); $('load-state').textContent = 'Data loaded';
  } catch (err) {
     setLastUpdated(err.message || String(err)); $('load-state').innerHTML = 'Data unavailable. <button type="button" id="inline-retry">Retry</button> Last successful data may be stale.'; $('inline-retry').addEventListener('click', load);
  }
}

function renderLeads(data) {
   const rows = (data && data.requests) || [];
   const target = $('leads');
   const counts = (data && data.by_status) || {};
   $('lead-kpis').innerHTML = ['new', 'contacted', 'used', 'paid']
     .map((status) => '<div class="kpi"><div class="kpi-label">Status: ' + status + '</div><div class="kpi-val">' + esc(counts[status] || 0) + '</div></div>').join('');
   target.innerHTML =
      (rows.length ? '<table><thead><tr><th>Email</th><th>Source / channel</th><th>Source URL</th><th>Status</th><th>Created</th><th>Converted</th></tr></thead><tbody>' +
         rows.map((r) => '<tr><td>' + esc(r.email) + '</td><td>' + esc(r.channel) + '</td><td>' + esc(r.source_url || '—') + '</td><td>' + esc(r.status) + '</td><td>' + esc(r.created_at ? dateFormat.format(new Date(r.created_at)) : '—') + '</td><td>' + (r.converted ? 'yes' : 'no') + '</td></tr>').join('') +
        '</tbody></table>' : '<p class="muted">No demo leads yet.</p>');
}

function selectTab(tab, push = true) {
  state.tab = tab;
  document.querySelectorAll('[data-tab]').forEach((section) => { section.hidden = section.dataset.tab !== tab; });
  document.querySelectorAll('[data-tab-button]').forEach((button) => {
    const active = button.dataset.tabButton === tab;
    button.setAttribute('aria-selected', String(active));
    button.setAttribute('aria-current', active ? 'page' : 'false');
    button.setAttribute('tabindex', active ? '0' : '-1');
  });
  if (push) syncUrl(tab);
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
$('retry').addEventListener('click', load);
$('open-details').addEventListener('click', () => { const open = $('leads').hidden; $('leads').hidden = !open; $('open-details').setAttribute('aria-expanded', String(open)); $('open-details').textContent = open ? 'Hide details' : 'Open details'; });
$('clear-filters').addEventListener('click', () => { $('from').value = ''; $('to').value = ''; state.page = '1'; syncUrl(state.tab); load(); });
$('auto-refresh').addEventListener('change', updateTimer);
document.querySelectorAll('[data-tab-button]').forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.tabButton)));
document.querySelectorAll('[data-tab-button]').forEach((button) => button.addEventListener('keydown', (event) => { const buttons = [...document.querySelectorAll('[data-tab-button]')]; const i = buttons.indexOf(button); const next = event.key === 'ArrowRight' ? buttons[(i + 1) % buttons.length] : event.key === 'ArrowLeft' ? buttons[(i - 1 + buttons.length) % buttons.length] : event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons.at(-1) : null; if (next) { event.preventDefault(); next.focus(); selectTab(next.dataset.tabButton); } }));
['from', 'to'].forEach((id) => $(id).addEventListener('change', () => { state.page = '1'; syncUrl(state.tab); load(); }));
window.addEventListener('popstate', () => { restoreUrl(); selectTab(state.tab, false); load(); });

updateTimer();
restoreUrl();
renderFilters();
selectTab(state.tab, false);
if (LS.getItem(KEY)) { load(); } else { showLogin(''); }
</script>
</body>
</html>
`;

/** Register the operator traffic dashboard at GET /dashboard. Not in the public NAV. */
export function registerDashboard(app: FastifyInstance, _config: AppConfig): void {
  app.get('/dashboard', async (_req, reply) => reply.type('text/html; charset=utf-8').send(PAGE));
  const demoPage = PAGE.replace('<title>Dashboard — Licita (operator)</title>', '<title>Demo pipeline — Licita (operator)</title>');
  app.get('/dashboard/demo', async (_req, reply) => reply.type('text/html; charset=utf-8').send(demoPage));
}

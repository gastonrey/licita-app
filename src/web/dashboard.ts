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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Serif+4:wght@400;600;700&display=swap" rel="stylesheet">
<style>
/* === PRIMITIVES === */
:root {
  color-scheme: light;
  --color-ink: #16232B;
  --color-ink-light: #2a3242;
  --color-ink-mid: #4a5468;
  --color-paper: #F6F3EA;
  --color-surface: #FFFFFF;
  --color-rule: #C9C3B5;
  --color-grid-line: #e3e6eb;
  --color-signal: #B9472E;
  --color-signal-hover: #8f321f;
  --color-verified: #356B52;
  --color-green-600: #1a7f37;
  --color-amber-600: #9a6700;
  --color-red-600: #cf222e;
  --color-muted: #5B6870;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --font-body: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --font-heading: 'Source Serif 4', Georgia, serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --text-xs: 0.68rem;
  --text-sm: 0.72rem;
  --text-base: 0.85rem;
  --text-lg: 1.1rem;
  --text-xl: 1.35rem;
  --text-2xl: clamp(2rem,5vw,3.5rem);
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);
  --shadow-lg: 0 8px 24px rgb(0 0 0 / 0.12);
  --transition-fast: 120ms ease;
  --transition-base: 200ms ease;
  --radius-sm: 0.25rem;
  --radius-default: 0.5rem;
}

/* === SEMANTIC === */
:root {
  --color-foreground: var(--color-ink);
  --color-background: var(--color-paper);
  --color-surface-alt: var(--color-surface);
  --color-border: var(--color-rule);
  --color-brand: var(--color-signal);
  --color-brand-hover: var(--color-signal-hover);
  --color-success: var(--color-green-600);
  --color-warning: var(--color-amber-600);
  --color-destructive: var(--color-red-600);
  --color-muted-foreground: var(--color-muted);
}

/* === COMPONENTS === */
:root {
  --card-bg: var(--color-surface-alt);
  --card-border: var(--color-border);
  --kpi-bg: var(--color-surface-alt);
  --kpi-border: var(--color-border);
  --kpi-label-color: var(--color-muted-foreground);
  --endpoint-bg: var(--color-surface-alt);
  --chart-bg: var(--color-surface-alt);
  --btn-bg: var(--color-brand);
  --btn-fg: #FFFFFF;
  --tab-bg: var(--color-surface-alt);
  --tab-active-border: var(--color-brand);
  --link-color: var(--color-success);
  --chart-line: var(--color-verified);
  --chart-paid: var(--color-brand);
}

/* === RESET === */
*, *::before, *::after { box-sizing: border-box; }

body {
  font-family: var(--font-body);
  margin: 0;
  background: var(--color-background);
  color: var(--color-foreground);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

/* === TYPOGRAPHY === */
h1 { font-family: var(--font-heading); font-size: var(--text-2xl); margin: 0; color: var(--color-foreground); text-wrap: balance; }
h2 { font-family: var(--font-heading); font-size: var(--text-lg); font-weight: 600; margin: 0 0 var(--space-4); color: var(--color-foreground); text-wrap: balance; }
h3.h3 { font-family: var(--font-body); font-size: var(--text-sm); color: var(--color-foreground); margin: 0 0 var(--space-2); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
a { color: var(--link-color); text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: var(--font-mono); font-size: 0.85em; }
.muted { color: var(--color-muted-foreground); }
.err { color: var(--color-destructive); }
summary { cursor: pointer; color: var(--link-color); font-weight: 600; }
[hidden] { display: none !important; }

/* === INPUTS === */
input, button, select { font: inherit; }
input[type="date"], input[type="password"], input[type="search"], select {
  height: 36px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-foreground);
  font-size: var(--text-sm);
}
input:focus-visible, select:focus-visible {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px rgba(185, 71, 46, 0.15);
}
button {
  cursor: pointer;
  touch-action: manipulation;
  min-height: 44px;
  border: none;
  border-radius: var(--radius-default);
  padding: 0 var(--space-4);
  font-weight: 600;
  font-size: var(--text-sm);
  transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease;
}
button:focus-visible { outline: 3px solid var(--color-brand); outline-offset: 3px; }

/* === SIDEBAR (desktop) === */
.sidebar {
  position: fixed;
  top: 0;
  left: 0;
  width: 240px;
  height: 100vh;
  background: var(--color-ink);
  display: flex;
  flex-direction: column;
  z-index: 100;
  overflow-y: auto;
}
.sidebar-logo {
  padding: var(--space-5) var(--space-5) var(--space-4);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.sidebar-logo a {
  color: var(--color-surface);
  text-decoration: none;
  font-family: var(--font-heading);
  font-size: var(--text-lg);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.sidebar-logo a:hover { text-decoration: none; opacity: 0.9; }
.sidebar-logo .subtitle {
  display: block;
  color: rgba(255,255,255,0.5);
  font-family: var(--font-body);
  font-size: var(--text-xs);
  margin-top: 2px;
  font-weight: 400;
}
.sidebar-nav {
  flex: 1;
  padding: var(--space-3) 0;
}
.sidebar-nav [role="tab"] {
  display: flex;
  align-items: center;
  width: 100%;
  border: none;
  border-left: 3px solid transparent;
  border-radius: 0;
  background: none;
  color: rgba(255,255,255,0.7);
  font-size: var(--text-sm);
  font-weight: 500;
  text-align: left;
  padding: var(--space-3) var(--space-5);
  min-height: 40px;
  transition: color .15s ease, background .15s ease, border-color .15s ease;
}
.sidebar-nav [role="tab"]:hover {
  color: var(--color-surface);
  background: rgba(255,255,255,0.04);
}
.sidebar-nav [role="tab"][aria-selected="true"] {
  color: var(--color-surface);
  background: rgba(255,255,255,0.07);
  border-left-color: var(--color-brand);
  font-weight: 600;
}
.sidebar-footer {
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid rgba(255,255,255,0.06);
}
.sidebar-footer .key-status {
  color: rgba(255,255,255,0.6);
  font-size: var(--text-xs);
}
.sidebar-footer .key-status strong { color: var(--color-verified); }
.sidebar-footer .logout-link {
  display: inline-block;
  margin-top: var(--space-2);
  color: rgba(255,255,255,0.6);
  font-size: var(--text-xs);
  cursor: pointer;
  text-decoration: none;
}
.sidebar-footer .logout-link:hover { color: var(--color-surface); }

/* === MAIN CONTENT === */
.main-content {
  margin-left: 240px;
  min-height: 100vh;
}
.header-bar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  min-height: 56px;
}
.header-bar label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-muted-foreground);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.header-bar .header-spacer { flex: 1; }
.header-bar .auto-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-muted-foreground);
  cursor: pointer;
}
.header-bar .auto-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--color-brand);
  cursor: pointer;
}
.header-bar .btn-refresh {
  height: 34px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-foreground);
  font-size: var(--text-sm);
}
.header-bar .btn-refresh:hover { border-color: var(--color-brand); color: var(--color-brand); }
.header-bar .last-updated { font-size: var(--text-xs); color: var(--color-muted-foreground); white-space: nowrap; }
.content-area { padding: var(--space-5) var(--space-6) var(--space-6); }

/* === MOBILE TAB BAR (visible < 768px, replaces sidebar) === */
.mobile-tabs {
  display: none;
  flex-wrap: wrap;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-4);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.mobile-tabs [role="tab"] {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--tab-bg);
  color: var(--color-foreground);
  padding: var(--space-2) var(--space-1);
  font-size: var(--text-xs);
  font-weight: 500;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mobile-tabs [role="tab"][aria-selected="true"] {
  border-color: var(--tab-active-border);
  border-bottom: 3px solid var(--tab-active-border);
  font-weight: 700;
  color: var(--color-brand);
  background: var(--color-surface);
}

/* === PERIOD BAR === */
.period-bar {
  padding: var(--space-3) var(--space-6);
  font-size: var(--text-sm);
  color: var(--color-muted-foreground);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/* === CARDS === */
.card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-default);
  padding: var(--space-6);
  margin-bottom: var(--space-6);
}

/* === KPI GRID === */
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--space-3);
}
.kpi {
  background: var(--kpi-bg);
  border: 1px solid var(--kpi-border);
  border-left: 3px solid var(--color-brand);
  border-radius: var(--radius-default);
  padding: var(--space-4) var(--space-5);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.kpi:hover { border-color: var(--color-brand); box-shadow: var(--shadow-sm); }
.kpi-label {
  font-size: var(--text-xs);
  color: var(--kpi-label-color);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  margin-bottom: var(--space-1);
}
.kpi-val {
  font-size: 1.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-foreground);
  line-height: 1.2;
}

/* === TABLES === */
table { border-collapse: collapse; width: 100%; font-size: var(--text-base); }
thead th {
  background: var(--color-ink-light);
  color: var(--color-paper);
  font-weight: 600;
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: left;
  padding: var(--space-2) var(--space-3);
  white-space: nowrap;
}
tbody td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-grid-line);
  vertical-align: top;
}
tbody tr:hover { background: rgba(185, 71, 46, 0.03); }
td.num, th.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }

/* === SECTION SPACING === */
section[role="tabpanel"] h2 { margin-top: var(--space-5); }
section[role="tabpanel"] > :first-child { margin-top: 0; }
section[role="tabpanel"] > :first-child:is(h2) { margin-top: 0; }

/* === TRAFFIC CHART === */
.traffic-chart { padding: var(--space-3) var(--space-4); background: var(--chart-bg); border-radius: var(--radius-default); }
.traffic-chart svg { display: block; width: 100%; height: auto; max-height: 16rem; }
.traffic-chart .grid-line { stroke: var(--color-grid-line); stroke-width: 1; }
.traffic-chart .traffic-line { fill: none; stroke: var(--chart-line); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.traffic-chart .paid-line { fill: none; stroke: var(--chart-paid); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.traffic-chart .axis-label { fill: var(--color-muted-foreground); font-size: 12px; }
.traffic-legend { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: var(--space-3); color: var(--color-muted-foreground); font-size: var(--text-base); }
.traffic-legend strong { color: var(--color-foreground); }
.traffic-legend .total::before, .traffic-legend .paid::before { content: ''; display: inline-block; width: .75rem; height: .2rem; margin-right: .35rem; vertical-align: middle; background: var(--chart-line); }
.traffic-legend .paid::before { background: var(--chart-paid); }
.traffic-data { margin-top: var(--space-3); }

/* === ENDPOINT LIST === */
.endpoint-list { display: grid; gap: var(--space-1); }
.endpoint-card {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) repeat(3, minmax(4.5rem, .7fr));
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-2) var(--space-4);
  background: var(--endpoint-bg);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  transition: border-color .15s ease, background-color .15s ease;
}
.endpoint-card:hover { border-color: var(--color-border); background: var(--color-paper); }
.endpoint-name { min-width: 0; overflow-wrap: anywhere; }
.endpoint-name code { font-size: .9rem; }
.endpoint-stat { min-width: 0; }
.endpoint-stat-label { display: block; color: var(--color-muted-foreground); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .04em; }
.endpoint-stat-value { display: block; font-variant-numeric: tabular-nums; font-weight: 600; }

/* === PAGINATION === */
.pagination { display: flex; align-items: center; justify-content: center; gap: var(--space-3); margin: var(--space-3) 0; }
.pagination button {
  min-width: 2.75rem;
  height: 36px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  background: var(--tab-bg);
  color: var(--color-foreground);
  font-weight: 400;
}
.pagination button:not(:disabled):hover { border-color: var(--color-brand); color: var(--color-brand); }
.pagination button:disabled { cursor: not-allowed; opacity: .45; }
.pagination span { color: var(--color-muted-foreground); font-size: var(--text-base); }

/* === FILTERS === */
.filters { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; padding: var(--space-3) 0; }
.filters label { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--color-muted-foreground); }
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  border: 1px solid var(--card-border);
  border-radius: 9999px;
  padding: 2px var(--space-2);
  background: var(--tab-bg);
  font-size: var(--text-xs);
  color: var(--color-foreground);
}
.filter-chips { display: flex; flex-wrap: wrap; gap: var(--space-1); }

/* === TOOLBAR === */
.toolbar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
.btn-sm {
  height: 36px;
  padding: 0 var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-foreground);
  font-size: var(--text-sm);
  font-weight: 500;
}
.btn-sm:hover { border-color: var(--color-brand); color: var(--color-brand); }
.btn-brand {
  background: var(--btn-bg);
  color: var(--btn-fg);
  border: 1px solid transparent;
}
.btn-brand:hover { background: var(--color-brand-hover); }

/* === GRID LAYOUTS === */
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); }
.grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-5); }

/* === STATUS CLASSES === */
.st-2 { color: var(--color-success); font-weight: 600; }
.st-4 { color: var(--color-warning); font-weight: 600; }
.st-5 { color: var(--color-destructive); font-weight: 600; }

/* === BAR === */
.bar { background: var(--color-success); height: 8px; min-width: 2px; }

/* === WARNING === */
.warning { color: #7b351f; background: #fff4ce; border: 1px solid #c98b63; padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); font-size: var(--text-sm); }

/* === OVERRIDES FOR JS-GENERATED CONTENT INSIDE CARDS === */
.card .traffic-chart { margin: 0; padding: 0; background: none; border: none; }
.card .traffic-chart .traffic-data { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); margin-top: var(--space-3); }
.card .traffic-chart .traffic-data table { margin: 0; }
.card .traffic-chart .traffic-data table thead th { background: var(--color-ink-light); }
.card table { margin: 0; }
.card .endpoint-list { margin: 0; }
.overview-filters { padding: var(--space-3) 0; }
.recent-filters-wrap { padding: var(--space-3) 0; border-bottom: 1px solid var(--color-grid-line); margin-bottom: var(--space-3); }

/* === SCROLLABLE REGIONS === */
.table-wrap { overflow-x: auto; max-width: 100%; }
#recent, #leads, #by-endpoint, #endpoint-economics, #zero-result, #zero-result-by-endpoint, #repeat-clients, #user-agents, #mcp-discovery { overflow-x: auto; }

/* === LOGIN === */
#login { display: flex; align-items: center; justify-content: center; min-height: 60vh; }
#login-form {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-default);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  max-width: 28rem;
}
#login-form label { font-weight: 600; font-size: var(--text-sm); }
#login-form button {
  align-self: flex-start;
  background: var(--btn-bg);
  color: var(--btn-fg);
  border: none;
  padding: var(--space-3) var(--space-6);
}
#login-form button:hover { background: var(--color-brand-hover); }
#login-msg { font-size: var(--text-sm); margin: 0; }

/* === RESPONSIVE === */
@media (max-width: 768px) {
  .sidebar { display: none; }
  .mobile-tabs { display: flex; }
  .main-content { margin-left: 0; }
  .header-bar { padding: var(--space-3) var(--space-4); }
  .content-area { padding: var(--space-4); }
  .period-bar { padding: var(--space-2) var(--space-4); }
  .kpis { grid-template-columns: 1fr; }
  .grid2, .grid3 { grid-template-columns: 1fr; }
  .endpoint-card { grid-template-columns: minmax(0, 1fr) repeat(2, minmax(4rem, .8fr)); }
  .endpoint-card .endpoint-stat:last-child { grid-column: 2 / -1; }
}

/* === ACCESSIBILITY === */
:focus-visible { outline: 3px solid var(--color-brand); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}

/* === EMPTY STATE === */
.empty-state { color: var(--color-muted-foreground); padding: var(--space-4); text-align: center; font-size: var(--text-sm); }
section[hidden] { display: none; }
</style>
</head>
<body>

<!-- Desktop sidebar -->
<aside class="sidebar" aria-label="Dashboard navigation">
  <div class="sidebar-logo">
    <a href="/dashboard">Licita</a>
    <span class="subtitle">Operator Dashboard</span>
  </div>
  <nav class="sidebar-nav" role="tablist" aria-label="Dashboard sections">
    <button role="tab" aria-controls="panel-overview" type="button" data-tab-button="overview" data-view="overview" aria-selected="true" tabindex="0">Overview</button>
    <button role="tab" aria-controls="panel-growth" type="button" data-tab-button="growth" data-view="growth" aria-selected="false" tabindex="-1">Growth</button>
    <button role="tab" aria-controls="panel-leads" type="button" data-tab-button="leads" data-view="leads" aria-selected="false" tabindex="-1">Leads</button>
    <button role="tab" aria-controls="panel-economics" type="button" data-tab-button="economics" data-view="economics" aria-selected="false" tabindex="-1">Endpoint Economics</button>
    <button role="tab" aria-controls="panel-gaps" type="button" data-tab-button="gaps" data-view="data-quality" aria-selected="false" tabindex="-1">Data Quality</button>
  </nav>
  <div class="sidebar-footer">
    <div class="key-status">Key: <strong>active</strong></div>
  </div>
</aside>

<!-- Main content area -->
<div class="main-content">

  <div id="login" hidden>
    <form id="login-form">
      <label for="key">Operator key</label>
      <input type="password" id="key" name="key" autocomplete="current-password" autofocus>
      <button type="submit">Unlock</button>
      <p id="login-msg" class="err"></p>
    </form>
  </div>

  <div id="dash" hidden>
    <!-- Sticky header bar with date controls -->
    <div class="header-bar">
      <label>From <input type="date" id="from"></label>
      <label>To <input type="date" id="to"></label>
      <span class="header-spacer"></span>
      <label class="auto-label"><input type="checkbox" id="auto-refresh" checked> Auto-refresh 15s</label>
      <button id="refresh" class="btn-refresh" type="button">Refresh</button>
      <span id="last-updated" class="last-updated" aria-live="polite"></span>
    </div>

    <!-- Mobile tab bar (hidden on desktop) -->
    <nav class="mobile-tabs" role="tablist" aria-label="Dashboard sections">
      <button role="tab" aria-controls="panel-overview" type="button" data-tab-button="overview" data-view="overview">Overview</button>
      <button role="tab" aria-controls="panel-growth" type="button" data-tab-button="growth" data-view="growth">Growth</button>
      <button role="tab" aria-controls="panel-leads" type="button" data-tab-button="leads" data-view="leads">Leads</button>
      <button role="tab" aria-controls="panel-economics" type="button" data-tab-button="economics" data-view="economics">Endpoint Economics</button>
      <button role="tab" aria-controls="panel-gaps" type="button" data-tab-button="gaps" data-view="data-quality">Data Quality</button>
    </nav>

    <div class="period-bar">
      <span id="period" class="muted" aria-live="polite">All available dates</span>
      <span id="filter-chips" class="filter-chips" aria-label="Active filters"></span>
      <span id="load-state" class="muted" aria-live="polite"></span>
      <button id="retry" class="btn-sm" type="button">Retry</button>
    </div>

    <div class="content-area">

      <!-- Overview panel -->
      <section id="panel-overview" role="tabpanel" data-tab="overview" aria-label="Overview">
        <div class="card">
          <h2>KPIs</h2>
          <div id="kpis" class="kpis"></div>
        </div>

        <div class="card">
          <h2>Traffic by day</h2>
          <div id="traffic-by-day"></div>
        </div>

        <div class="card">
          <h2>Traffic by endpoint</h2>
          <div id="by-endpoint"></div>
        </div>

        <div class="card">
          <h2>Recent activity</h2>
          <div class="recent-filters-wrap">
            <form id="recent-filters" class="filters" aria-label="Filter recent activity">
              <label>Endpoint <input id="recent-endpoint" name="recent_endpoint" type="search" placeholder="/v1/search"></label>
              <label>Source <select id="recent-source" name="recent_source"><option value="">All sources</option><option value="rest">REST</option><option value="mcp">MCP</option></select></label>
              <label>Payment <select id="recent-paid" name="recent_paid"><option value="">All requests</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select></label>
              <label>Status <select id="recent-status" name="recent_status"><option value="">All statuses</option><option value="2xx">2xx success</option><option value="4xx">4xx client error</option><option value="5xx">5xx server error</option></select></label>
              <button id="clear-recent-filters" class="btn-sm" type="button">Clear filters</button>
            </form>
          </div>
          <p id="recent-result-count" class="muted" aria-live="polite"></p>
          <div id="recent"></div>
          <div id="pager-recent" class="pagination" aria-label="Recent activity pagination"></div>
        </div>
      </section>

      <!-- Growth panel -->
      <section id="panel-growth" role="tabpanel" data-tab="growth" aria-label="Growth" hidden>
        <div class="card">
          <h2>Growth cohorts</h2>
          <div class="kpis">
            <div class="kpi"><div class="kpi-label">Weekly active paying agents</div><div class="kpi-val" id="nsm"></div></div>
          </div>
          <div id="growth-funnel"></div>
          <div id="growth-rows"></div>
          <div id="funnel-warning" role="alert"></div>
        </div>

        <div class="card">
          <h2>MCP discovery</h2>
          <div id="mcp-discovery"></div>
        </div>
      </section>

      <!-- Leads panel -->
      <section id="panel-leads" role="tabpanel" data-tab="leads" aria-label="Leads" hidden>
        <div class="card">
          <h2>Demo pipeline</h2>
          <p class="muted">Email is shown only to authorized operators. <button id="open-details" class="btn-sm" type="button" aria-expanded="false">Open details</button></p>
          <div id="lead-kpis" class="kpis" aria-label="Status: new Status: contacted Status: used Status: paid"></div>
          <div id="leads" hidden></div>
        </div>
      </section>

      <!-- Endpoint economics panel -->
      <section id="panel-economics" role="tabpanel" data-tab="economics" aria-label="Endpoint economics" hidden>
        <div class="card">
          <h2>Endpoint economics</h2>
          <div id="endpoint-economics"></div>
        </div>

        <div class="card">
          <h2>Who accessed</h2>
          <div class="grid2">
            <div><h3 class="h3">Repeat paid clients</h3><div id="repeat-clients"></div></div>
            <div><h3 class="h3">User agents</h3><div id="user-agents"></div></div>
          </div>
        </div>

        <div class="card">
          <h2>Top requested</h2>
          <div class="grid3">
            <div><h3 class="h3">CPVs</h3><div id="top-cpvs"></div></div>
            <div><h3 class="h3">Buyers</h3><div id="top-buyers"></div></div>
            <div><h3 class="h3">Companies</h3><div id="top-companies"></div></div>
          </div>
        </div>

        <div class="card">
          <h2>Payments</h2>
          <div class="grid2">
            <div><h3 class="h3">By network / provider</h3><div id="payments-net"></div></div>
          </div>
        </div>
      </section>

      <!-- Data quality panel -->
      <section id="panel-gaps" role="tabpanel" data-tab="gaps" aria-label="Data gaps" hidden>
        <div class="card">
          <h2>Data gaps</h2>
          <p class="muted">Measured zero-result queries by endpoint. Unavailable panels remain labeled, not converted to zero.</p>
          <button id="clear-filters" class="btn-sm" type="button">Clear filters</button>
          <div id="zero-result"></div>
          <div id="zero-result-by-endpoint"></div>
        </div>
      </section>

    </div><!-- /content-area -->
  </div><!-- /dash -->
</div><!-- /main-content -->

<script>
const KEY = 'licita_operator_key';
const LS = sessionStorage;
const $ = (id) => document.getElementById(id);
const initialParams = new URLSearchParams(location.search);
const state = { timer: null, tab: initialParams.get('view') === 'data-quality' ? 'gaps' : initialParams.get('view') || initialParams.get('tab') || 'overview', page: initialParams.get('page') || '1', recent_endpoint: '', recent_source: '', recent_paid: '', recent_status: '' };
const validTabs = ['overview', 'growth', 'leads', 'economics', 'gaps'];
function syncUrl(tab) { const params = new URLSearchParams(location.search); params.set('view', tab === 'gaps' ? 'data-quality' : tab); if ($('from').value) params.set('from', $('from').value); else params.delete('from'); if ($('to').value) params.set('to', $('to').value); else params.delete('to'); if (state.page !== '1') params.set('page', state.page); else params.delete('page'); [['recent_endpoint', state.recent_endpoint], ['recent_source', state.recent_source], ['recent_paid', state.recent_paid], ['recent_status', state.recent_status]].forEach(([key, value]) => value ? params.set(key, value) : params.delete(key)); history.pushState({}, '', location.pathname + '?' + params.toString()); renderFilters(); }
function restoreUrl() { const params = new URLSearchParams(location.search); const view = params.get('view'); state.tab = view === 'data-quality' ? 'gaps' : validTabs.includes(view) ? view : 'overview'; const page = Number(params.get('page')); state.page = Number.isInteger(page) && page > 0 ? String(page) : '1'; state.recent_endpoint = params.get('recent_endpoint') || ''; state.recent_source = params.get('recent_source') || ''; state.recent_paid = params.get('recent_paid') || ''; state.recent_status = params.get('recent_status') || ''; $('from').value = params.get('from') || ''; $('to').value = params.get('to') || ''; $('recent-endpoint').value = state.recent_endpoint; $('recent-source').value = state.recent_source; $('recent-paid').value = state.recent_paid; $('recent-status').value = state.recent_status; }

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

function renderTrafficChart(rows) {
  if (!rows.length) return '<p class="muted">No traffic recorded in this period.</p>';
  const width = 720, height = 240, left = 48, right = 16, top = 18, bottom = 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const max = Math.max(1, ...rows.map((r) => Number(r.requests) || 0));
  const x = (i) => left + (rows.length === 1 ? plotWidth / 2 : (i / (rows.length - 1)) * plotWidth);
  const y = (value) => top + plotHeight - ((Number(value) || 0) / max) * plotHeight;
  const line = (key, className) => rows.map((r, i) => x(i).toFixed(1) + ',' + y(r[key]).toFixed(1)).join(' ');
  const labels = rows.map((r, i) => i === 0 || i === rows.length - 1 || i % Math.ceil(rows.length / 6) === 0
    ? '<text class="axis-label" x="' + x(i).toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle">' + esc(String(r.date).slice(5)) + '</text>' : '').join('');
  const grid = [0, .5, 1].map((fraction) => '<line class="grid-line" x1="' + left + '" x2="' + (width - right) + '" y1="' + y(max * fraction).toFixed(1) + '" y2="' + y(max * fraction).toFixed(1) + '" />' +
    '<text class="axis-label" x="' + (left - 8) + '" y="' + (y(max * fraction) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(max * fraction) + '</text>').join('');
  const table = '<details class="traffic-data"><summary>View daily values</summary><table><caption>Daily traffic values</caption><thead><tr><th scope="col">Date</th><th scope="col" class="num">Requests</th><th scope="col" class="num">Paid</th></tr></thead><tbody>' + rows.map((r) => '<tr><td>' + esc(r.date) + '</td><td class="num">' + esc(r.requests) + '</td><td class="num">' + esc(r.paid_requests) + '</td></tr>').join('') + '</tbody></table></details>';
  return '<figure class="traffic-chart" aria-labelledby="traffic-chart-title" aria-describedby="traffic-chart-description"><svg viewBox="0 0 ' + width + ' ' + height + '" role="img"><title id="traffic-chart-title">Daily endpoint traffic</title><desc id="traffic-chart-description">Total requests and paid requests by UTC day.</desc>' + grid + '<polyline class="traffic-line" points="' + line('requests', 'traffic-line') + '" /><polyline class="paid-line" points="' + line('paid_requests', 'paid-line') + '" />' + labels + '</svg><figcaption class="traffic-legend"><span class="total"><strong>Total requests</strong></span><span class="paid"><strong>Paid requests</strong></span><span>UTC dates</span></figcaption>' + table + '</figure>';
}

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
  $('traffic-by-day').innerHTML = renderTrafficChart(stats.daily_traffic || []);

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

  const byEp = (stats.requests_by_endpoint || [])
    .filter((r) => Number(r.requests || 0) > 0)
    .sort((a, b) => Number(b.paid_requests || 0) - Number(a.paid_requests || 0) || Number(b.requests || 0) - Number(a.requests || 0));
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
  const recentFiltered = recent.filter((r) => {
    const status = Number(r.status || 0);
    const statusClass = status >= 500 ? '5xx' : status >= 400 ? '4xx' : status >= 200 && status < 300 ? '2xx' : '';
    return (!state.recent_endpoint || String(r.endpoint || '').toLowerCase().includes(state.recent_endpoint.toLowerCase())) &&
      (!state.recent_source || r.source === state.recent_source) &&
      (!state.recent_paid || (state.recent_paid === 'paid' ? Boolean(r.paid) : !r.paid)) &&
      (!state.recent_status || state.recent_status === statusClass);
  });
  $('recent-result-count').textContent = recentFiltered.length + ' matching requests';
  $('recent').innerHTML = renderRecentRows(pageRows(recentFiltered, Number(state.page) || 1));
  bindPager('recent', recentFiltered, (rows) => { $('recent').innerHTML = renderRecentRows(rows); });

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
        fetch('/v1/stats/recent?limit=200' + (range ? '&' + range.slice(1) : ''), { headers: { 'x-operator-key': key } }),
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
['recent-endpoint', 'recent-source', 'recent-paid', 'recent-status'].forEach((id) => $(id).addEventListener('input', () => {
  state[id.replace('recent-', 'recent_')] = $(id).value;
  state.page = '1';
  syncUrl(state.tab);
  load();
}));
$('clear-recent-filters').addEventListener('click', () => {
  ['recent-endpoint', 'recent-source', 'recent-paid', 'recent-status'].forEach((id) => { $(id).value = ''; state[id.replace('recent-', 'recent_')] = ''; });
  state.page = '1';
  syncUrl(state.tab);
  load();
});
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

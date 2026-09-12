export const HUMAN_CSS = `
/* ========================================================================
   LICITA DESIGN SYSTEM — Webdesign layouts Library (v2.1)
   Warm editorial: terracotta accent, serif display, warm paper surface.
   Editorial SaaS layout-first. Contrast hardened per WCAG AA audit:
   - ink-mid #3C4554 (8.7:1 on paper), muted #46535C (7.2:1 on paper)
   - signal-text #9A3A24 for all small signal text (kicker/plan/chips)
   - code-card accent #e8a37b on ink bands
   Public surfaces must keep stable: /styles.css, all pages, /llms.txt.
   ======================================================================== */

/* === PRIMITIVES === */
:root {
  /* Color */
  --color-ink: #16232B;
  --color-ink-light: #2a3242;
  --color-ink-mid: #3C4554;
  --color-paper: #F6F3EA;
  --color-surface: #FFFFFF;
  --color-rule: #C9C3B5;
  --color-grid-line: #e3e6eb;
  --color-signal: #B9472E;
  --color-signal-text: #9A3A24;
  --color-signal-hover: #8f321f;
  --color-verified: #356B52;
  --color-green-600: #1a7f37;
  --color-amber-600: #9a6700;
  --color-red-600: #cf222e;
  --color-muted: #46535C;
  /* Spacing (4px base) */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-7: 1.75rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  /* Typography */
  --font-body: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
  --font-heading: 'Source Serif 4', Georgia, serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --text-xs: 0.72rem;
  --text-sm: 0.85rem;
  --text-base: 1rem;
  --text-lg: 1.15rem;
  --text-xl: 1.35rem;
  --text-2xl: 1.75rem;
  --text-3xl: clamp(2.25rem, 5.5vw, 3.75rem);
  /* Radius */
  --radius-sm: 0.25rem;
  --radius-default: 0.5rem;
  --radius-lg: 0.75rem;
  /* Depth */
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);
  --shadow-lg: 0 8px 24px rgb(0 0 0 / 0.12);
  /* Transitions */
  --transition-fast: 120ms ease;
  --transition-base: 200ms ease;
  /* Layout (template conventions) */
  --content-width: 72rem;
  --section-pad-y: clamp(3rem, 6vw, 5rem);
  --header-h: 4rem;
}

/* === SEMANTIC === */
:root {
  --color-foreground: var(--color-ink);
  --color-foreground-light: var(--color-ink-light);
  --color-foreground-mid: var(--color-ink-mid);
  --color-background: var(--color-paper);
  --color-surface-alt: var(--color-surface);
  --color-border: var(--color-rule);
  --color-brand: var(--color-signal);
  --color-brand-hover: var(--color-signal-hover);
  --color-success: var(--color-green-600);
  --color-warning: var(--color-amber-600);
  --color-destructive: var(--color-red-600);
  --color-muted-foreground: var(--color-muted);
  --link-color: var(--color-verified);
}

/* === COMPONENT TOKENS === */
:root {
  --card-bg: var(--color-surface-alt);
  --card-border: var(--color-border);
  --btn-bg: var(--color-brand);
  --btn-fg: #FFFFFF;
  --chart-line: var(--color-success);
  --chart-paid: var(--color-brand);
}

/* ========================================================================
   RESET & BASE
   ======================================================================== */
*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-body);
  font-size: var(--text-base);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
img { max-width: 100%; height: auto; display: block; }

/* ========================================================================
   TYPOGRAPHY
   ======================================================================== */
h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading);
  color: var(--color-foreground);
  text-wrap: balance;
  line-height: 1.15;
}
h1 { font-size: var(--text-3xl); letter-spacing: -0.025em; margin: 0 0 var(--space-4); }
h2 {
  font-size: var(--text-2xl);
  margin: var(--space-8) 0 var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-foreground);
}
/* U8: soften the h2 divider on content-dense pages (docs, pricing, use-cases, data, trust). */
main:has(> h1) h2 { border-bottom-color: color-mix(in srgb, var(--color-border) 40%, transparent); }
h3 { font-size: var(--text-lg); margin: var(--space-6) 0 var(--space-2); }
h4 { font-size: var(--text-base); font-weight: 600; margin: var(--space-4) 0 var(--space-2); }
p { margin: 0 0 var(--space-3); }
p:last-child { margin-bottom: 0; }
strong { font-weight: 600; }
a { color: var(--link-color); text-decoration: none; transition: color var(--transition-fast); }
a:hover { color: var(--color-signal-text); }
/* Inline text links are underlined (mockups v2.1); controls/cards are not. */
main a:not(.btn):not(.chip):not(.usecase-card):not(.tag) {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-decoration-color: color-mix(in srgb, var(--color-verified) 45%, transparent);
  text-underline-offset: 3px;
}
main a:hover { text-decoration-color: currentColor; }
code, .mono {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: var(--color-grid-line);
  padding: 0.15em 0.35em;
  border-radius: var(--radius-sm);
}
pre {
  background: var(--color-ink);
  color: var(--color-paper);
  border-radius: var(--radius-default);
  padding: var(--space-4);
  overflow-x: auto;
  font-size: var(--text-sm);
  line-height: 1.5;
  margin: var(--space-3) 0;
}
pre code { background: none; padding: 0; color: inherit; }
.muted { color: var(--color-muted-foreground); }
.kicker {
  display: inline-block;
  font: 600 0.72rem var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-signal-text);
  margin-bottom: 0.5rem;
}
.visually-hidden {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.source-stamp {
  color: var(--color-success);
  font: var(--text-xs) var(--font-mono), monospace;
  letter-spacing: 0.03em;
}

/* ========================================================================
   LAYOUT
   ======================================================================== */
main { max-width: var(--content-width); margin: 0 auto; padding: 0 var(--space-6) var(--space-12); }
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-4); }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); }
.section { padding: var(--section-pad-y) 0; }
.section h2 { margin-top: 0; }
.section-head { margin-bottom: var(--space-4); }
.section-head h2 { border: 0; margin: 0 0 var(--space-2); padding: 0; }
@media (max-width: 768px) {
  .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
  main { padding: 0 var(--space-3) var(--space-8); }
}

/* ========================================================================
   NAVIGATION — Header Charlie (static, single header; mockups v2.1)
   ======================================================================== */
.site-header {
  background: var(--color-paper);
  border-bottom: 1px solid var(--color-border);
  position: static;
}
.header-bar {
  max-width: var(--content-width);
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  height: var(--header-h);
  padding: 0 var(--space-6);
}
.site-brand {
  font-family: var(--font-heading);
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--color-foreground);
  text-decoration: none;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
.site-brand:hover { color: var(--color-brand); }
.site-nav {
  display: flex;
  gap: var(--space-5);
  align-items: center;
  flex-wrap: wrap;
}
.site-nav a {
  text-decoration: none;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-foreground-mid);
  transition: color var(--transition-fast);
}
.site-nav a:hover { color: var(--color-brand); text-decoration: underline; text-underline-offset: 4px; }
.header-cta { white-space: nowrap; }
/* Language switcher — path-preserving header control (R5), visible both locales. */
.lang-switch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.25rem;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-default);
  background: var(--color-surface);
  color: var(--color-foreground-mid);
  font-size: var(--text-sm);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: border-color var(--transition-fast), color var(--transition-fast);
}
.lang-switch:hover { border-color: var(--color-signal); color: var(--color-signal-text); }
.burger {
  display: none;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-foreground);
  font-size: 1rem;
  cursor: pointer;
  touch-action: manipulation;
}
.burger:hover { border-color: var(--color-signal); color: var(--color-signal-text); }
.skip-link {
  position: absolute;
  left: -999px;
  top: var(--space-4);
  background: var(--color-ink);
  color: #fff;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-default);
  z-index: 100;
}
.skip-link:focus { left: var(--space-4); }
@media (max-width: 900px) {
  .site-nav { gap: var(--space-3); }
}
@media (max-width: 720px) {
  .header-bar { padding: 0 var(--space-3); }
  .site-nav { display: none; }
  .site-nav.open {
    display: flex;
    position: absolute;
    top: var(--header-h);
    left: 0;
    right: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    background: var(--color-paper);
    border-bottom: 1px solid var(--color-rule);
    padding: var(--space-2) var(--space-6) var(--space-4);
  }
  .site-nav.open a { padding: var(--space-3) 0; width: 100%; }
  .burger { display: inline-flex; }
  .header-cta { margin-left: var(--space-3); }
  .header-cta .btn { padding: var(--space-2) var(--space-3); font-size: var(--text-xs); min-height: 2.25rem; }
}

/* ========================================================================
   CARDS
   ======================================================================== */
.card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-default);
  padding: var(--space-5);
  transition: box-shadow var(--transition-base), border-color var(--transition-base);
}
.card:hover {
  box-shadow: var(--shadow-md);
  border-color: color-mix(in srgb, var(--color-brand) 30%, var(--card-border));
}
.card-header {
  font-family: var(--font-heading);
  font-size: var(--text-lg);
  font-weight: 600;
  margin-bottom: var(--space-3);
  color: var(--color-foreground);
}
.card-flush { padding: 0; }
.card-flush > * { padding-left: var(--space-5); padding-right: var(--space-5); }
.card-flush > *:first-child { padding-top: var(--space-5); }
.card-flush > *:last-child { padding-bottom: var(--space-5); }

/* ========================================================================
   BUTTONS
   ======================================================================== */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-2) var(--space-5);
  border: 1px solid var(--color-brand);
  border-radius: var(--radius-default);
  background: var(--btn-bg);
  color: var(--btn-fg);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  text-decoration: none;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.btn:hover { background: var(--color-brand-hover); border-color: var(--color-brand-hover); color: var(--btn-fg); }
.btn:active { transform: translateY(1px); }
.btn-lg { min-height: 48px; padding: var(--space-3) var(--space-6); font-size: var(--text-base); }
.btn-secondary {
  background: transparent;
  color: var(--color-foreground);
  border-color: var(--color-border);
}
.btn-secondary:hover {
  background: var(--color-surface-alt);
  border-color: var(--color-signal-text);
  color: var(--color-signal-text);
}
.btn-ghost {
  background: transparent;
  color: var(--color-foreground-mid);
  border-color: transparent;
  padding: var(--space-1) var(--space-3);
  min-height: 36px;
}
.btn-ghost:hover { background: var(--color-grid-line); color: var(--color-foreground); }
.btn-sm { min-height: 36px; padding: var(--space-1) var(--space-3); font-size: var(--text-xs); }

/* ========================================================================
   FORMS
   ======================================================================== */
input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="date"], select, textarea {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-foreground);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  min-height: 40px;
}
input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px rgba(185, 71, 46, 0.15);
}
label {
  display: block;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-foreground-light);
  margin-bottom: var(--space-1);
}

/* ========================================================================
   TABLES
   ======================================================================== */
table { border-collapse: collapse; width: 100%; font-size: var(--text-sm); }
thead th {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  font-weight: 600;
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-foreground-mid);
  background: var(--color-grid-line);
  border-bottom: 2px solid var(--color-border);
}
tbody td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-grid-line);
  vertical-align: top;
}
tbody tr:hover { background: color-mix(in srgb, var(--color-signal) 4%, transparent); }
td.num, th.num { font-variant-numeric: tabular-nums; text-align: right; font-family: var(--font-mono); }

/* ========================================================================
   BADGES & TAGS
   ======================================================================== */
.badge {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  border-radius: var(--radius-sm);
  line-height: 1;
}
.badge-success { background: color-mix(in srgb, var(--color-success) 12%, transparent); color: var(--color-success); }
.badge-warning { background: color-mix(in srgb, var(--color-warning) 12%, transparent); color: var(--color-warning); }
.badge-destructive { background: color-mix(in srgb, var(--color-destructive) 12%, transparent); color: var(--color-destructive); }
.badge-neutral { background: var(--color-grid-line); color: var(--color-foreground-mid); }
.tag {
  display: inline-block;
  background: color-mix(in srgb, var(--color-signal) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-signal) 30%, transparent);
  border-radius: 999px;
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--color-signal-text);
}

/* ========================================================================
   HOMEPAGE — HERO (Hero Alfa + live evidence card)
   ======================================================================== */
.hero {
  padding: var(--section-pad-y) 0 calc(var(--section-pad-y) * 0.6);
  background:
    radial-gradient(1200px 480px at 85% -10%, rgba(185,71,46,0.07), transparent 60%),
    var(--color-paper);
}
.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: clamp(1.5rem, 4vw, 3rem);
  align-items: center;
}
.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font: 600 0.72rem var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-signal-text);
  border: 1px solid color-mix(in srgb, var(--color-signal) 35%, transparent);
  background: color-mix(in srgb, var(--color-signal) 6%, transparent);
  padding: var(--space-1) var(--space-3);
  border-radius: 999px;
  margin-bottom: var(--space-5);
}
.hero h1 { margin-bottom: var(--space-5); }
.hero-subtitle { font-size: var(--text-lg); color: var(--color-foreground-mid); max-width: 34rem; }
.hero-ctas { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-7); }
.hero-caption { margin-top: 1rem; font-size: var(--text-sm); color: var(--color-muted); font-family: var(--font-mono); }

/* Live evidence card (hydrated by GET /v1/demo) */
.evidence-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}
.evidence-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--color-grid-line);
  background: var(--color-paper);
}
.evidence-card-head .title {
  font: 600 0.72rem var(--font-mono);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-foreground-mid);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.live-dot {
  width: var(--space-2);
  height: var(--space-2);
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 18%, transparent);
}
.evidence-card-head .stamp {
  font: 600 0.68rem var(--font-mono);
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
  padding: var(--space-1) var(--space-3);
  border-radius: 999px;
  white-space: nowrap;
}
.evidence-body { padding: var(--space-4) var(--space-5); }
.evidence-body .finding + .finding { margin-top: var(--space-5); padding-top: var(--space-4); border-top: 1px solid var(--color-grid-line); }
.evidence-body .finding h4 { font-family: var(--font-heading); font-size: var(--text-lg); margin: var(--space-2) 0 var(--space-1); }
.evidence-body .finding .meta { font-size: var(--text-sm); color: var(--color-foreground-mid); }
.provenance-gutter {
  border-top: 1px solid var(--color-grid-line);
  padding: var(--space-3) var(--space-5);
  background: var(--color-paper);
  font: var(--text-xs) var(--font-mono);
  color: var(--color-muted);
}
.provenance-gutter .row { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); align-items: baseline; }
.provenance-gutter .label { letter-spacing: 0.08em; color: var(--color-signal-text); font-weight: 600; }

/* Evidence rail — live container holding rendered findings/provenance */
.evidence-rail {
  border-left: 4px solid var(--color-signal);
  padding: var(--space-5) var(--space-6);
  background: var(--color-surface);
  border-radius: 0 var(--radius-default) var(--radius-default) 0;
  border: 1px solid var(--color-border);
}
#demo-sample.evidence-rail {
  border: 0;
  border-radius: 0;
  background: none;
  padding: 0;
}
.evidence-rail h3 {
  font-family: var(--font-heading);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--color-foreground);
  margin: 0 0 var(--space-2);
}
.evidence-rail[data-state="loading"] { color: var(--color-muted-foreground); }
.evidence-rail .source-stamp {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-muted-foreground);
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-grid-line);
}
.evidence-lines {
  list-style: none;
  padding: 0;
  margin: var(--space-2) 0;
}
.evidence-lines li {
  font-size: var(--text-sm);
  color: var(--color-foreground-mid);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--color-grid-line);
}
.evidence-lines li:last-child { border-bottom: none; }

/* ========================================================================
   HOMEPAGE — TRUST STRIP (source chips)
   ======================================================================== */
.trust-strip { border-top: 1px solid var(--color-border); border-bottom: 1px solid var(--color-border); padding: var(--space-4) 0; }
.trust-chips { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-foreground-mid);
  font-size: var(--text-sm);
  text-decoration: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.chip:hover { border-color: var(--color-signal); box-shadow: var(--shadow-sm); color: var(--color-ink); }
.chip strong { color: var(--color-ink); font-weight: 600; }
.chip .dot {
  width: 0.45rem;
  height: 0.45rem;
  flex: none;
  border-radius: 50%;
  background: var(--color-verified);
}

/* ========================================================================
   HOMEPAGE — EXAMPLE CARD (research brief code sample)
   ======================================================================== */
.example-card pre { margin: 0; background: var(--color-ink); }
.example-card pre .k { color: var(--color-verified); }
.example-card pre .v, .example-card pre .ok { color: #7fc49c; }
.example-card pre .acc { color: #e8a37b; }
.example-card pre .dstamp { color: #9fb3bd; }

/* ========================================================================
   HOMEPAGE — USE CASE CARDS
   ======================================================================== */
.usecase-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4);
  margin: var(--space-6) 0;
}
@media (min-width: 1120px) {
  .usecase-grid { grid-template-columns: repeat(4, 1fr); }
}
.usecase-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-default);
  padding: var(--space-5);
  text-decoration: none;
  color: inherit;
  transition: box-shadow var(--transition-base), border-color var(--transition-base), transform var(--transition-base);
  position: relative;
  display: block;
}
.usecase-card::after {
  content: '→';
  position: absolute;
  right: var(--space-4);
  top: var(--space-5);
  color: var(--color-muted-foreground);
  font-size: var(--text-lg);
  transition: color var(--transition-fast), transform var(--transition-fast);
}
.usecase-card:hover {
  box-shadow: var(--shadow-md);
  border-color: color-mix(in srgb, var(--color-brand) 30%, var(--color-border));
  transform: translateY(-2px);
  color: inherit;
}
.usecase-card:hover::after {
  color: var(--color-signal-text);
  transform: translateX(3px);
}
.usecase-card .ico { color: var(--color-signal); font-size: 1.2rem; margin-bottom: var(--space-4); display: block; }
.usecase-card h3 {
  font-family: var(--font-heading);
  font-size: var(--text-lg);
  margin: 0 0 var(--space-2);
  color: var(--color-foreground);
}
.usecase-card p {
  font-size: var(--text-sm);
  color: var(--color-foreground-mid);
  margin: 0 0 var(--space-3);
}
.usecase-card .more {
  font: 600 0.7rem var(--font-mono);
  color: var(--color-verified);
}
@media (max-width: 768px) {
  .usecase-grid { grid-template-columns: 1fr; }
}

/* ========================================================================
   HOMEPAGE — PRICING CARDS
   ======================================================================== */
.pricing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
  gap: var(--space-4);
  margin: var(--space-6) 0;
}
.price-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-default);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.price-card.featured { border-color: color-mix(in srgb, var(--color-signal) 55%, var(--color-border)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-signal) 55%, transparent), var(--shadow-md); }
.price-card .plan {
  font: 600 0.72rem var(--font-mono);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--color-signal-text);
}
.price-card .amount { display: flex; align-items: baseline; gap: var(--space-2); margin-bottom: var(--space-2); font-variant-numeric: tabular-nums; flex-wrap: wrap; }
.price-card .amount .n { font-family: var(--font-heading); font-size: var(--text-2xl); font-weight: 700; color: var(--color-foreground); }
.price-card .amount .u { font-size: var(--text-sm); color: var(--color-muted); font-family: var(--font-mono); }
.price-card .desc { font-size: var(--text-sm); color: var(--color-foreground-mid); flex: 1; }
.pricing-note { font-size: var(--text-sm); color: var(--color-muted); margin-top: var(--space-3); }
@media (max-width: 768px) {
  .pricing-grid { grid-template-columns: 1fr; max-width: 26rem; }
}

/* ========================================================================
   HOMEPAGE — FAQ ACCORDION (native details/summary)
   ======================================================================== */
.faq-list { margin-top: var(--space-4); }
.faq-item {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-default);
  background: var(--color-surface);
  margin-bottom: var(--space-3);
  overflow: hidden;
}
.faq-item summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  font-weight: 600;
  color: var(--color-foreground);
}
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary:focus-visible { outline: 3px solid var(--color-brand); outline-offset: -3px; }
.faq-item .chev { font-family: var(--font-mono); color: var(--color-signal-text); transition: transform var(--transition-fast); }
.faq-item[open] .chev { transform: rotate(180deg); }
.faq-item .answer {
  padding: 0 var(--space-5) var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-foreground-mid);
}

/* ========================================================================
   HOMEPAGE — CTA BAND (ink, same form contract)
   ======================================================================== */
.cta-section {
  background: var(--color-ink);
  color: #fff;
  padding: var(--space-10) var(--space-6);
  border-radius: var(--radius-lg);
  margin: var(--space-8) 0;
}
/* U2: as a homepage .section the CTA band owns its own rhythm (no double padding). */
.section.cta-section { margin: 0; padding: var(--section-pad-y) var(--space-6); }
.cta-section h2 {
  color: #fff;
  border: 0;
  margin: 0 0 var(--space-3);
  padding: 0;
  font-size: var(--text-2xl);
}
.cta-section p {
  color: rgba(255,255,255,0.85);
  max-width: 40rem;
  margin-bottom: var(--space-5);
}
.cta-section code {
  background: rgba(255,255,255,0.12);
  color: #fff;
  padding: 0.15em 0.4em;
  border-radius: var(--radius-sm);
  font-size: 0.9em;
  border: 1px solid rgba(255,255,255,0.15);
}
.cta-section .btn-secondary {
  color: #fff;
  border-color: rgba(255,255,255,0.3);
  background: transparent;
}
.cta-section .btn-secondary:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.5);
  color: #fff;
}
.cta-form {
  display: flex;
  gap: var(--space-3);
  align-items: start;
  flex-wrap: wrap;
}
.cta-form label { color: #fff; font-weight: 600; width: 100%; }
.cta-form input[type="email"] {
  flex: 1;
  min-width: 240px;
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.2);
  color: #fff;
  padding: var(--space-3) var(--space-4);
}
.cta-form input[type="email"]::placeholder { color: rgba(255,255,255,0.45); }
.cta-form input[type="email"]:focus {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px rgba(185, 71, 46, 0.3);
}
.cta-message {
  min-height: 1.5em;
  margin-top: var(--space-2);
  width: 100%;
  color: rgba(255,255,255,0.9);
}
.cta-section .retention { font-size: var(--text-sm); color: rgba(255,255,255,0.7); }
.cta-section .retention a { color: #e2986b; }
.cta-section .kicker { color: #e8a37b; }

/* ========================================================================
   FOOTER — Footer Alfa (paper, border-top)
   ======================================================================== */
.site-footer {
  background: var(--color-paper);
  color: var(--color-ink);
  border-top: 1px solid var(--color-border);
  padding: var(--space-12) 0 var(--space-8);
  margin-top: var(--space-12);
}
.site-footer a { color: var(--color-verified); }
.site-footer a:hover { color: var(--color-signal-text); }
.footer-inner, .footer-top {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 0 var(--space-6);
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: var(--space-8);
}
.footer-brand {
  font-family: var(--font-heading);
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--color-foreground);
  margin-bottom: var(--space-3);
}
.footer-desc {
  font-size: var(--text-sm);
  color: var(--color-muted);
  line-height: 1.6;
  max-width: 24rem;
}
.footer-col h4 {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-foreground-mid);
  margin: 0 0 var(--space-3);
}
.footer-col ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.footer-col li { margin-bottom: var(--space-2); }
.footer-col a {
  font-size: var(--text-sm);
  color: var(--color-muted);
  text-decoration: none;
  transition: color var(--transition-fast);
}
.footer-col a:hover { color: var(--color-signal-text); text-decoration: underline; text-underline-offset: 3px; }
.footer-bottom {
  max-width: var(--content-width);
  margin: var(--space-6) auto 0;
  padding: var(--space-4) var(--space-6) 0;
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2) var(--space-7);
  flex-wrap: wrap;
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--color-muted);
}
.footer-bottom code { background: none; padding: 0; }
@media (max-width: 768px) {
  .footer-inner, .footer-top { grid-template-columns: 1fr 1fr; gap: var(--space-6); }
  .footer-bottom { flex-direction: column; text-align: center; }
}

/* ========================================================================
   ACCESSIBILITY
   ======================================================================== */
:focus-visible {
  outline: 3px solid var(--color-brand);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

/* ========================================================================
   RESPONSIVE
   ======================================================================== */
@media (max-width: 900px) {
  .hero-grid { grid-template-columns: 1fr; gap: 2rem; }
}
@media (max-width: 768px) {
  .hero h1 { font-size: clamp(1.8rem, 6vw, 3rem); }
  .cta-section { padding: var(--space-6) var(--space-4); }
  .section.cta-section { padding: var(--space-8) var(--space-4); }
  .cta-form { flex-direction: column; }
  .cta-form input[type="email"] { min-width: 0; width: 100%; }
  .trust-chips { flex-direction: column; align-items: stretch; }
}
`;
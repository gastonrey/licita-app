export const HUMAN_CSS = `
/* ========================================================================
   LICITA DESIGN SYSTEM
   Warm editorial: terracotta accent, serif headings, warm paper surface.
   Quality bar: Stripe / Linear / Vercel.
   ======================================================================== */

/* === PRIMITIVES === */
:root {
  /* Color */
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
  /* Spacing (4px base) */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
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
  --text-2xl: 2rem;
  --text-3xl: clamp(2.5rem, 7vw, 5.2rem);
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
  --link-color: var(--color-success);
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
h1 { font-size: var(--text-3xl); letter-spacing: -0.03em; margin: 0 0 var(--space-4); }
h2 {
  font-size: var(--text-xl);
  margin: var(--space-8) 0 var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-foreground);
}
h3 { font-size: var(--text-lg); margin: var(--space-6) 0 var(--space-2); }
h4 { font-size: var(--text-base); font-weight: 600; margin: var(--space-4) 0 var(--space-2); }
p { margin: 0 0 var(--space-3); }
p:last-child { margin-bottom: 0; }
strong { font-weight: 600; }
a { color: var(--link-color); text-decoration: none; transition: color var(--transition-fast); }
a:hover { color: var(--color-brand-hover); }
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
.container { max-width: 72rem; margin: 0 auto; padding: 0 var(--space-6); }
main { max-width: 72rem; margin: 0 auto; padding: 0 var(--space-6) var(--space-12); }
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-4); }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); }
@media (max-width: 768px) {
  .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
  main { padding: 0 var(--space-3) var(--space-8); }
}

/* ========================================================================
   NAVIGATION
   ======================================================================== */
.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  position: sticky;
  top: 0;
  z-index: 10;
}
.site-brand {
  font-family: var(--font-heading);
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--color-foreground);
  text-decoration: none;
  letter-spacing: -0.02em;
}
.site-brand:hover { color: var(--color-brand); }
.site-nav {
  display: flex;
  gap: var(--space-5);
  align-items: center;
}
.site-nav a {
  text-decoration: none;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-foreground-mid);
  transition: color var(--transition-fast);
}
.site-nav a:hover { color: var(--color-brand); }
.skip-link {
  position: absolute;
  left: -999px;
  top: var(--space-4);
  background: var(--color-ink);
  color: white;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-default);
  z-index: 100;
}
.skip-link:focus { left: var(--space-4); }
@media (max-width: 768px) {
  .site-header { padding: var(--space-3) var(--space-3); flex-wrap: wrap; gap: var(--space-2); }
  .site-nav { gap: var(--space-3); flex-wrap: wrap; }
  .site-nav a { font-size: var(--text-xs); }
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
.btn:hover { background: var(--color-brand-hover); border-color: var(--color-brand-hover); }
.btn:active { transform: translateY(1px); }
.btn-secondary {
  background: transparent;
  color: var(--color-foreground);
  border-color: var(--color-border);
}
.btn-secondary:hover {
  background: var(--color-surface-alt);
  border-color: var(--color-foreground-mid);
  color: var(--color-foreground);
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
  background: var(--color-grid-line);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--color-foreground-mid);
}

/* ========================================================================
   HOMEPAGE — HERO
   ======================================================================== */
.hero {
  padding: var(--space-16) 0 var(--space-10);
  max-width: 58rem;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--space-12) var(--space-8);
  border: 1px solid var(--color-border);
}
.hero-eyebrow {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-brand);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: var(--space-3);
}
.hero h1 {
  font-family: var(--font-heading);
  font-size: var(--text-3xl);
  line-height: 1.05;
  letter-spacing: -0.03em;
  margin-bottom: var(--space-4);
  color: var(--color-foreground);
}
.hero-subtitle {
  font-size: var(--text-lg);
  color: var(--color-foreground-mid);
  max-width: 44rem;
  line-height: 1.6;
  margin-bottom: var(--space-6);
}

/* ========================================================================
   HOMEPAGE — CTA SECTION
   ======================================================================== */
.cta-section {
  background: var(--color-ink);
  color: #fff;
  padding: var(--space-10) var(--space-6);
  border-radius: var(--radius-lg);
  margin: var(--space-8) 0;
}
.cta-section h2 {
  color: #fff;
  border: 0;
  margin: 0 0 var(--space-3);
  padding: 0;
  font-size: var(--text-2xl);
}
.cta-section p {
  color: rgba(255,255,255,0.82);
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
  color: rgba(255,255,255,0.85);
}

/* ========================================================================
   HOMEPAGE — SCOPE GRID
   ======================================================================== */
.scope-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-4);
  margin: var(--space-6) 0;
}
.scope-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-default);
  padding: var(--space-5);
  transition: box-shadow var(--transition-base);
}
.scope-card:hover { box-shadow: var(--shadow-md); }
.scope-card h3 {
  font-family: var(--font-heading);
  font-size: var(--text-lg);
  margin: 0 0 var(--space-2);
  color: var(--color-foreground);
}
.scope-card p {
  font-size: var(--text-sm);
  color: var(--color-foreground-mid);
  margin: 0;
}
@media (max-width: 768px) {
  .scope-grid { grid-template-columns: 1fr; }
}

/* ========================================================================
   HOMEPAGE — EVIDENCE RAIL
   ======================================================================== */
.evidence-rail {
  border-left: 4px solid var(--color-brand);
  padding: var(--space-5) var(--space-6);
  background: var(--color-surface);
  border-radius: 0 var(--radius-default) var(--radius-default) 0;
  border: 1px solid var(--color-border);
  border-left: 4px solid var(--color-brand);
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
   HOMEPAGE — USE CASE CARDS
   ======================================================================== */
.usecase-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4);
  margin: var(--space-6) 0;
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
  transform: translateY(-1px);
}
.usecase-card:hover::after {
  color: var(--color-brand);
  transform: translateX(3px);
}
  border-color: color-mix(in srgb, var(--color-brand) 30%, var(--color-border));
  color: inherit;
}
.usecase-card h3 {
  font-family: var(--font-heading);
  font-size: var(--text-lg);
  margin: 0 0 var(--space-2);
  color: var(--color-foreground);
}
.usecase-card p {
  font-size: var(--text-sm);
  color: var(--color-foreground-mid);
  margin: 0;
}
@media (max-width: 768px) {
  .usecase-grid { grid-template-columns: 1fr; }
}

/* ========================================================================
   FOOTER
   ======================================================================== */
.site-footer {
  background: var(--color-ink);
  color: rgba(255,255,255,0.7);
  padding: var(--space-10) var(--space-6) var(--space-6);
  margin-top: var(--space-12);
}
.site-footer a { color: rgba(255,255,255,0.9); }
.site-footer a:hover { color: #fff; }
.footer-inner {
  max-width: 72rem;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 2fr repeat(3, 1fr);
  gap: var(--space-8);
}
.footer-brand {
  font-family: var(--font-heading);
  font-size: var(--text-xl);
  font-weight: 700;
  color: #fff;
  margin-bottom: var(--space-3);
}
.footer-desc {
  font-size: var(--text-sm);
  color: rgba(255,255,255,0.72);
  line-height: 1.6;
  max-width: 24rem;
}
.footer-col h4 {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255,255,255,0.65);
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
  color: rgba(255,255,255,0.85);
  text-decoration: none;
  transition: color var(--transition-fast);
}
.footer-col a:hover { color: #fff; }
.footer-bottom {
  max-width: 72rem;
  margin: var(--space-6) auto 0;
  padding-top: var(--space-4);
  border-top: 1px solid rgba(255,255,255,0.15);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--text-xs);
  color: rgba(255,255,255,0.6);
}
@media (max-width: 768px) {
  .footer-inner { grid-template-columns: 1fr 1fr; gap: var(--space-6); }
  .footer-bottom { flex-direction: column; gap: var(--space-2); text-align: center; }
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
@media (max-width: 768px) {
  .hero { padding: var(--space-8) 0 var(--space-6); }
  .hero h1 { font-size: clamp(1.8rem, 6vw, 3rem); }
  .cta-section { padding: var(--space-6) var(--space-4); }
  .cta-form { flex-direction: column; }
  .cta-form input[type="email"] { min-width: 0; width: 100%; }
}
`;

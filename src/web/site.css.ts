export const HUMAN_CSS = `
:root { --registry-ink:#16232B; --paper:#F6F3EA; --rule:#C9C3B5; --signal:#B9472E; --verified:#356B52; --muted:#5B6870; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--paper); color: var(--registry-ink); font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif; line-height: 1.55; }
main { max-width: 76rem; margin: 0 auto; padding: 0 1.5rem 5rem; }
h1,h2,h3 { font-family: 'Source Serif 4', Georgia, serif; text-wrap: balance; }
h1 { font-size: clamp(2.5rem, 7vw, 5.2rem); line-height: 1.02; letter-spacing: -.03em; }
h2 { border-bottom: 1px solid var(--rule); padding-bottom: .5rem; margin-top: 3rem; }
a { color: var(--verified); }
code, .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
.skip-link { position: absolute; left: -999px; top: 1rem; background: var(--registry-ink); color: white; padding: .75rem 1rem; z-index: 2; }
.skip-link:focus { left: 1rem; }
.site-nav { display:flex; gap:1rem; flex-wrap:wrap; border-bottom:1px solid var(--rule); padding:1rem 0; }
.site-nav a { text-decoration:none; font-size:.9rem; }
.human-home { max-width: 68rem; }
.hero { padding: 5rem 0 3rem; max-width: 58rem; }
.hero p { max-width: 48rem; font-size: 1.15rem; color: var(--muted); }
.home-columns { display:grid; grid-template-columns:minmax(0, 2fr) minmax(16rem, 1fr); gap:3rem; align-items:start; }
.evidence-rail { border-left: 4px solid var(--signal); padding: 1.25rem 1.5rem; background:#fff; }
.evidence-rail[data-state="loading"] { color:var(--muted); }
.source-stamp { color:var(--verified); font: .78rem 'IBM Plex Mono', monospace; letter-spacing:.03em; }
.trust-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(14rem,1fr)); gap:1rem; }
.trust-grid > div { border-top:2px solid var(--rule); padding-top:.75rem; }
.cta { background: var(--registry-ink); color:#fff; padding: 1.5rem; margin: 3rem 0; border-left: 4px solid var(--signal); }
.cta h2 { color:#fff; border:0; margin-top:0; }
.cta input[type=email] { min-width:min(100%, 20rem); padding:.75rem; border:1px solid var(--rule); }
.btn { min-height:44px; padding:.7rem 1rem; border:1px solid var(--signal); background:var(--signal); color:#fff; font-weight:700; cursor:pointer; touch-action:manipulation; }
.btn:hover { background:#8f321f; }
.demo-message { min-height:1.5em; }
.site-footer { border-top:1px solid var(--rule); margin-top:3rem; padding-top:1.5rem; }
:focus-visible { outline:3px solid var(--signal); outline-offset:3px; }
@media (max-width:720px) { main { padding-inline:1rem; } .home-columns { grid-template-columns:1fr; gap:1rem; } .hero { padding-top:3rem; } .cta input[type=email] { width:100%; min-width:0; margin-bottom:.75rem; } }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior:auto; } *, *::before, *::after { animation-duration:.01ms !important; transition-duration:.01ms !important; } }
`;

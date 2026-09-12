// registerWeb(app, config) — discovery surfaces (SPEC §7): /, /docs, /pricing,
// /llms.txt, /robots.txt, the MCP server card and the dev faucet. Plain
// semantic HTML, no JS. Customer-facing brand is "Licita".
// /openapi.json is served by src/api/server.ts (W2); we only link to it.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CREDIT_BUNDLES, ENDPOINT_PRICES } from '../domain/types.js';
import { absoluteUrl, type AppConfig } from '../config.js';
import { registerDevFaucet } from '../pay/devProvider.js';
import { HUMAN_CSS } from './site.css.js';
import { t, href, otherLocale, languageName, type LocaleCode } from './i18n.js';
import type { TrustPageSlug } from './locales/types.js';

const CSS = `
:root { color-scheme: light; }
main > *:first-child { margin-top: 0; }
`;

/** Escape a string for safe interpolation into HTML attribute values. */
function escapeAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

/** Escape a string for safe interpolation into XML text nodes. */
function escapeXml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}

/** Fallback meta description for pages without a dedicated one. */
const SITE_DESCRIPTION =
  'Licita — evidence-backed public procurement intelligence: EU (TED) and Spain (PLACSP) tenders, buyers, suppliers and deterministic renewal signals, queryable over REST and MCP.';

/**
 * SEO/social head extras for a human page (spec DR3/DR4 + R3): per-locale
 * canonical, hreflang pair (es | en) + x-default→/, og:locale + og:locale:alternate,
 * og:type/site_name/title/url and meta description, all derived from
 * config.baseUrl (root-relative fallback when BASE_URL is unset — dev/test).
 * Single-locale pages (/docs) render canonical + their own og:locale only —
 * no hreflang alternates, no x-default (design: docs opts.switcher=false).
 */
function pageMeta(
  locale: LocaleCode,
  config: AppConfig,
  path: string,
  title: string,
  description?: string,
  opts: { singleLocale?: boolean } = {},
): string {
  const url = escapeAttr(absoluteUrl(config.baseUrl, path));
  const esHref = absoluteUrl(
    config.baseUrl,
    locale === 'es' ? path : path === '/en' ? '/' : path.replace(/^\/en(?=\/|$)/, '') || '/',
  );
  const enHref = absoluteUrl(
    config.baseUrl,
    locale === 'en' ? path : path === '/' ? '/en' : `/en${path}`,
  );
  const lines = [`<link rel="canonical" href="${url}">`];
  if (!opts.singleLocale) {
    lines.push(
      `<link rel="alternate" hreflang="es" href="${escapeAttr(esHref)}">`,
      `<link rel="alternate" hreflang="en" href="${escapeAttr(enHref)}">`,
      `<link rel="alternate" hreflang="x-default" href="${escapeAttr(absoluteUrl(config.baseUrl, '/'))}">`,
    );
  }
  lines.push(`<meta property="og:locale" content="${locale === 'es' ? 'es_ES' : 'en_US'}">`);
  if (!opts.singleLocale) {
    lines.push(`<meta property="og:locale:alternate" content="${locale === 'es' ? 'en_US' : 'es_ES'}">`);
  }
  lines.push(
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Licita">',
    `<meta property="og:title" content="${escapeAttr(`${title} — Licita`)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta name="description" content="${escapeAttr(description ?? SITE_DESCRIPTION)}">`,
  );
  return lines.join('\n');
}

function page(
  locale: LocaleCode,
  title: string,
  body: string,
  opts: { config?: AppConfig; path?: string; description?: string; switcher?: boolean; noindex?: boolean } = {},
): string {
  const meta =
    opts.config && opts.path !== undefined
      ? pageMeta(locale, opts.config, opts.path, title, opts.description, {
          singleLocale: opts.switcher === false,
        })
      : '';
  const jsonLd = `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["WebSite", "SoftwareApplication"],
  "name": "Licita",
  "url": "${opts.config && opts.path !== undefined ? absoluteUrl(opts.config.baseUrl, opts.path) : opts.config?.baseUrl ?? ''}",
  "inLanguage": "${locale}",
  "description": "${opts.description ?? t(locale, 'jsonLd.description')}",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web"
}
</script>`.trim();
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#F6F3EA">
${opts.noindex ? '<meta name="robots" content="noindex">' : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Serif+4:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
${meta}
${jsonLd}
<title>${title} — Licita</title>
<style>${CSS}</style>
</head>
<body>
${nav(locale, opts.path ?? '/', opts.switcher !== false)}
<main id="main-content">
${body}
</main>
${footer(locale)}
<script>(function(){var b=document.getElementById('burger'),n=document.getElementById('primary-nav');if(b&&n){b.addEventListener('click',function(){var o=n.classList.toggle('open');b.setAttribute('aria-expanded',o?'true':'false');b.textContent=o?'✕':'☰';});}})();</script>
</body></html>`;
}

/**
 * Header Charlie (static, single header) — shared across every public page.
 * `path` is the page's own route (used to keep the locale switcher on the
 * same page); `withSwitch` renders the path-preserving `.lang-switch` link.
 */
function nav(locale: LocaleCode, path: string, withSwitch: boolean): string {
  const l = locale;
  const target = otherLocale(l);
  const switchHref =
    l === 'en' ? (path === '/en' ? '/' : path.replace(/^\/en(?=\/|$)/, '') || '/') : href('en', path);
  const switcher = withSwitch
    ? `\n<a class="lang-switch" lang="${target}" hreflang="${target}" href="${switchHref}">${languageName(target)}</a>`
    : '';
  return `<a class="skip-link" href="#main-content">${t(l, 'nav.skipToContent')}</a>
<header class="site-header">
<div class="header-bar">
<a class="site-brand" href="${href(l, '/')}">${t(l, 'nav.brand')}</a>
<nav class="site-nav" id="primary-nav" aria-label="${t(l, 'nav.navLabel')}"><a href="${href(l, '/')}">${t(l, 'nav.home')}</a><a href="${href(l, '/use-cases')}">${t(l, 'nav.useCases')}</a><a href="${href(l, '/data')}">${t(l, 'nav.coverageAndMethodology')}</a><a href="${href(l, '/pricing')}">${t(l, 'nav.pricing')}</a><a href="${href(l, '/docs')}">${t(l, 'nav.docs')}</a><a href="${href(l, '/mcp')}">${t(l, 'nav.mcp')}</a></nav>
<button class="burger" id="burger" type="button" aria-expanded="false" aria-controls="primary-nav" aria-label="${t(l, 'nav.toggleMenu')}">☰</button>
<span class="header-cta"><a class="btn btn-sm" href="${href(l, '/#demo')}">${t(l, 'nav.requestDemo')}</a></span>${switcher}
</div>
</header>`;
}

/** ENDPOINT_PRICES rows (Research is config-owned and rendered separately). */
function endpointRows(locale: LocaleCode): string {
  return Object.entries(ENDPOINT_PRICES)
    .map(
      ([endpoint, price]) =>
        `<tr><td><code>${endpoint}</code></td><td class="num">${
          price === '0.00' ? `<span class="tag">${t(locale, 'pricing.priceTable.freeTag')}</span>` : `$${price}`
        }</td></tr>`,
    )
    .join('\n');
}

/** Price table: POST /v1/research (config-driven price) above the fixed ladder. */
function priceTable(config: AppConfig, locale: LocaleCode): string {
  const researchRow = `<tr><td><code>POST /v1/research</code></td><td class="num">$${config.researchPriceUsd}</td></tr>`;
  return `<table>
<thead><tr><th>${t(locale, 'pricing.priceTable.endpointHeader')}</th><th>${t(locale, 'pricing.priceTable.priceHeader')}</th></tr></thead>
<tbody>
${researchRow}
${endpointRows(locale)}
</tbody>
</table>`;
}

/** Placeholder (never real paid data) demo of POST /v1/research: request → response. */
const RESEARCH_EXAMPLE = `# POST /v1/research — pay per call (USDC via x402)
{"query": "health sector IT services", "limit": 5}

→ 200 OK
{
  "data": {
    "topic": "health sector IT services",
    "confidence": "high",
    "summary": "Recent EU procurement activity for \\"health sector IT services\\": 3 tender(s) published in the last 90 day(s), 2 renewal signal(s), 1 company opportunity, 2 active buyer(s).",
    "findings": [
      {
        "type": "tender",
        "title": "Servicios de ciberseguridad para hospitales públicos",
        "detail": "Tender 13001: 72000000; estimated value EUR 180000.",
        "source": "ted",
        "source_ref": "130001-2026",
        "timestamp": "2026-06-20",
        "evidence": ["tender: Servicios de ciberseguridad para hospitales públicos"]
      },
      {
        "type": "renewal",
        "title": "Renewal signal: Marco de servicios cloud hospitalario",
        "detail": "framework_expiry; renewal window 2026-09-01 to 2027-09-01; incumbent ACME S.A.; buyer Servicio Andaluz de Salud.",
        "source": "signal",
        "source_ref": "https://ted.europa.eu/udl?uri=TED:NOTICE:222-2026:TEXT:EN:HTML",
        "timestamp": "2026-08-18",
        "evidence": ["confidence: high", "basis: {\\"window_start\\":\\"2026-09-01\\"}"]
      }
    ],
    "windows": {"tenders_days": 90, "renewals_days": 365}
  },
  "meta": {
    "request_id": "7f3c9e21-1234-4a00-8000-000000000000",
    "price_usd": "0.50",
    "paid": true,
    "provenance": [
      {"source": "ted", "source_ref": "130001-2026"},
      {"source": "signal", "source_ref": "https://ted.europa.eu/udl?uri=TED:NOTICE:222-2026:TEXT:EN:HTML"}
    ],
    "generated_at": "2026-08-18T10:00:00.000Z",
    "methodology": "Deterministic high-level EU procurement intelligence over the licita database — NOT a probability estimate."
  }
}`;

const MCP_TOOLS = [
  'search_tenders',
  'get_tender',
  'get_company',
  'get_company_awards',
  'get_company_opportunities',
  'get_buyer_history',
  'get_renewals',
  'get_pricing',
  'research',
  'billing_get_balance',
  'billing_purchase_credits',
];

// Demand-capture CTA: lightweight mailto, no signup/DB/RGPD.
const CONTACT_EMAIL = 'eutendersai@gmail.com';

/** Footer Alfa (paper) — shared across every public page. */
function footer(locale: LocaleCode): string {
  const l = locale;
  const year = String(new Date().getFullYear());
  return `<footer class="site-footer">
<div class="footer-top">
  <div>
    <div class="footer-brand">Licita</div>
    <p class="footer-desc">${t(l, 'footer.desc')}</p>
  </div>
  <div class="footer-col">
    <h4>${t(l, 'footer.product')}</h4>
    <ul>
      <li><a href="${href(l, '/use-cases')}">${t(l, 'footer.useCases')}</a></li>
      <li><a href="${href(l, '/pricing')}">${t(l, 'footer.pricing')}</a></li>
      <li><a href="${href(l, '/docs')}">${t(l, 'footer.docs')}</a></li>
      <li><a href="${href(l, '/mcp')}">${t(l, 'footer.mcp')}</a></li>
      <li><a href="${href(l, '/data')}">${t(l, 'footer.coverageAndMethodology')}</a></li>
    </ul>
  </div>
  <div class="footer-col">
    <h4>${t(l, 'footer.company')}</h4>
    <ul>
      <li><a href="${href(l, '/methodology')}">${t(l, 'footer.methodology')}</a></li>
      <li><a href="${href(l, '/security')}">${t(l, 'footer.security')}</a></li>
      <li><a href="${href(l, '/privacy')}">${t(l, 'footer.privacy')}</a></li>
      <li><a href="${href(l, '/terms')}">${t(l, 'footer.terms')}</a></li>
      <li><a href="${href(l, '/status')}">${t(l, 'footer.status')}</a></li>
    </ul>
  </div>
  <div class="footer-col">
    <h4>${t(l, 'footer.contact')}</h4>
    <ul>
      <li><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></li>
      <li><a href="https://github.com/gastonrey/licita-app">${t(l, 'footer.github')}</a></li>
    </ul>
  </div>
</div>
<div class="footer-bottom">
  <span>${t(l, 'footer.copyright', { year })}</span>
  <span>${t(l, 'footer.provenance')}</span>
</div>
</footer>`;
}


// Frozen demo-sample + demo-request script: byte-identical on both locales
// (S2.1 needle). Extracted by tests via the `<script>const sample=...` block.
const HOME_SCRIPT = `<script>const sample=document.getElementById('demo-sample');const safe=(v)=>String(v??'Not reported').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const lines=(xs)=>'<ul class="evidence-lines">'+(xs||[]).map(x=>'<li>'+safe(x)+'</li>').join('')+'</ul>';fetch('/v1/demo').then(r=>{if(!r.ok)throw new Error('sample unavailable');return r.json()}).then(({data,meta})=>{const t=data.tender,r=data.renewal;sample.dataset.state='ready';sample.innerHTML=(t?'<h3>'+safe(t.title)+'</h3><p><strong>Buyer:</strong> '+safe(t.buyer?.name)+' · <strong>Value:</strong> '+safe(t.estimated_value)+' '+safe(t.currency||'')+' · <strong>Published:</strong> '+safe(t.published_at)+'</p>'+lines(t.evidence):'<p>No current sample is available.</p>')+(r?'<p><strong>Renewal signal:</strong> '+safe(r.signal_type)+' · '+safe(r.confidence)+' confidence · '+safe(r.contract?.end_date)+'</p>'+lines(r.evidence):'<p>No current renewal sample is available.</p>')+'<p class="source-stamp">'+safe(t?.source||r?.source||'source')+' · '+safe(t?.source_ref||r?.source_ref)+' · generated '+safe(meta?.generated_at)+'</p>'+((t?.url||r?.url)?'<p><a class="upstream" href="'+safe(t?.url||r?.url)+'" target="_blank" rel="noreferrer">Open upstream source</a></p>':'')+'<p class="source-stamp">source_metadata: '+safe(JSON.stringify(data.source_metadata||[]))+'</p>'}).catch(()=>{sample.dataset.state='error';sample.innerHTML='<p>Sample unavailable. <a href="/docs">Read the methodology</a>.</p>'});document.getElementById('demo-request').addEventListener('submit',async(e)=>{e.preventDefault();const f=e.currentTarget,m=document.getElementById('demo-message'),b=f.querySelector('button');m.textContent='Requesting a demo…';b.disabled=true;try{const r=await fetch('/v1/demo/request?source=homepage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.email.value})});if(!r.ok){const body=await r.json().catch(()=>({}));throw new Error(body.error?.hint||'Check your email and try again.')}m.textContent='Request received. We will follow up by email; no meeting was booked.';f.reset()}catch(err){m.textContent=err.message+' You can also email ${CONTACT_EMAIL}.'}finally{b.disabled=false}})</script>`;

function homePage(config: AppConfig, locale: LocaleCode, demoStatus = false): string {
  const l = locale;
  const mcpEndpoint = absoluteUrl(config.apiBaseUrl ?? config.baseUrl, '/mcp');
  const path = href(l, '/');
  const vars = {
    creemPrice: (config.creem.priceCents / 100).toFixed(2),
    researchPrice: config.researchPriceUsd,
    mcpEndpoint,
    email: CONTACT_EMAIL,
    year: String(new Date().getFullYear()),
    paymentsMode: config.paymentsMode,
  };
  return page(
    l,
    t(l, 'home.title'),
    `
<header class="hero hero-grid">
<div class="hero-copy">
<p class="hero-eyebrow">${t(l, 'home.heroEyebrow')}<span class="eyebrow-dot">·</span>${t(l, 'home.heroEyebrowTag')}</p>
<h1>${t(l, 'home.heroTitle')}</h1>
<p class="hero-subtitle">${t(l, 'home.heroSubtitle')}</p>
<div class="hero-ctas">
<a class="btn btn-lg" href="${href(l, '/#demo')}">${t(l, 'home.heroCtas.demo')}</a>
<a class="btn btn-secondary btn-lg" href="/v1/demo">${t(l, 'home.heroCtas.sample')}</a>
</div>
<p class="hero-caption">${t(l, 'home.heroCaption')}</p>
</div>
<aside class="evidence-card" aria-label="${t(l, 'home.evidenceCard.aria')}">
<div class="evidence-card-head"><span class="title"><span class="live-dot" aria-hidden="true"></span>${t(l, 'home.evidenceCard.title')}</span><span class="stamp">${t(l, 'home.evidenceCard.stamp')}</span></div>
<article id="demo-sample" class="evidence-body evidence-rail" data-state="loading" aria-live="polite"><p>${t(l, 'home.evidenceCard.loading')}</p><p class="source-stamp">${t(l, 'home.evidenceCard.sourceStamp')}</p></article>
</aside>
</header>

<section class="section">
<h2>${t(l, 'home.builtOn')}</h2>
<div class="trust-strip">
  <a class="chip" href="${href(l, '/data/eu')}"><span class="chip-kicker">${t(l, 'home.trustStrip.eu.kicker')}</span>${t(l, 'home.trustStrip.eu.label')}</a>
  <a class="chip" href="${href(l, '/data/spain')}"><span class="chip-kicker">${t(l, 'home.trustStrip.es.kicker')}</span>${t(l, 'home.trustStrip.es.label')}</a>
  <a class="chip" href="${href(l, '/data')}"><span class="chip-kicker">${t(l, 'home.trustStrip.dates.kicker')}</span>${t(l, 'home.trustStrip.dates.label')}</a>
  <a class="chip" href="https://github.com/gastonrey/licita-app"><span class="chip-kicker">${t(l, 'home.trustStrip.openSource.kicker')}</span>${t(l, 'home.trustStrip.openSource.label')}</a>
  <a class="chip" href="${href(l, '/status')}"><span class="chip-kicker">${t(l, 'home.trustStrip.status.kicker')}</span>${t(l, 'home.trustStrip.status.label')}</a>
</div>
</section>

<section class="section cta-section" id="demo">
<h2>${t(l, 'home.ctaDemo.title')}</h2>
<p>${t(l, 'home.ctaDemo.body')}</p>
<form id="demo-request" class="cta-form" method="post" action="/v1/demo/request">
<label for="demo-email">${t(l, 'home.ctaDemo.emailLabel')}</label>
<input id="demo-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" required placeholder="${t(l, 'home.ctaDemo.emailPlaceholder')}">
<button class="btn" type="submit">${t(l, 'home.ctaDemo.submit')}</button>
<p id="demo-message" class="cta-message" role="status" aria-live="polite">${demoStatus ? t(l, 'home.ctaDemo.success') : ''}</p>
</form>
<noscript><p>${t(l, 'home.ctaDemo.noscript', vars)}</p></noscript>
</section>

<section class="section">
<h2>${t(l, 'home.usecases.title')}</h2>
<div class="usecase-grid">
  <a class="usecase-card" href="${href(l, '/use-cases/tender-intelligence')}"><h3>${t(l, 'home.usecases.cards.tender-intelligence.title')}</h3><p>${t(l, 'home.usecases.cards.tender-intelligence.desc')}</p></a>
  <a class="usecase-card" href="${href(l, '/use-cases/company-research')}"><h3>${t(l, 'home.usecases.cards.company-research.title')}</h3><p>${t(l, 'home.usecases.cards.company-research.desc')}</p></a>
  <a class="usecase-card" href="${href(l, '/use-cases/buyer-intelligence')}"><h3>${t(l, 'home.usecases.cards.buyer-intelligence.title')}</h3><p>${t(l, 'home.usecases.cards.buyer-intelligence.desc')}</p></a>
  <a class="usecase-card" href="${href(l, '/use-cases/renewals-forecasting')}"><h3>${t(l, 'home.usecases.cards.renewals-forecasting.title')}</h3><p>${t(l, 'home.usecases.cards.renewals-forecasting.desc')}</p></a>
</div>
</section>

<section class="section">
<h2>${t(l, 'home.pricing.title')}</h2>
<p class="muted">${config.creem.enabled ? t(l, 'home.pricing.introCreem') : t(l, 'home.pricing.intro')}</p>
<div class="pricing-grid">
  ${config.creem.enabled ? `
  <div class="price-card featured">
    <span class="plan">${t(l, 'home.pricing.cards.monthly.plan')}</span>
    <div class="amount"><span class="n">${t(l, 'home.pricing.cards.monthly.amountN', vars)}</span><span class="u">${t(l, 'home.pricing.cards.monthly.amountU')}</span></div>
    <p class="desc">${t(l, 'home.pricing.cards.monthly.desc')}</p>
    <span class="tag">${t(l, 'home.pricing.cards.monthly.tag')}</span>
  </div>` : ''}
  <div class="price-card">
    <span class="plan">${t(l, 'home.pricing.cards.research.plan')}</span>
    <div class="amount"><span class="n">${t(l, 'home.pricing.cards.research.amountN', vars)}</span><span class="u">${t(l, 'home.pricing.cards.research.amountU')}</span></div>
    <p class="desc">${t(l, 'home.pricing.cards.research.desc')}</p>
    <span class="tag">${t(l, 'home.pricing.cards.research.tag')}</span>
  </div>
  <div class="price-card${config.creem.enabled ? '' : ' featured'}">
    <span class="plan">${t(l, 'home.pricing.cards.core.plan')}</span>
    <div class="amount"><span class="n">${t(l, 'home.pricing.cards.core.amountN')}</span><span class="u">${t(l, 'home.pricing.cards.core.amountU')}</span></div>
    <p class="desc">${t(l, 'home.pricing.cards.core.desc')}</p>
    <span class="tag">${t(l, 'home.pricing.cards.core.tag')}</span>
  </div>
  <div class="price-card">
    <span class="plan">${t(l, 'home.pricing.cards.credits.plan')}</span>
    <div class="amount"><span class="n">${t(l, 'home.pricing.cards.credits.amountN')}</span><span class="u">${t(l, 'home.pricing.cards.credits.amountU')}</span></div>
    <p class="desc">${t(l, 'home.pricing.cards.credits.desc')}</p>
    <span class="tag">${t(l, 'home.pricing.cards.credits.tag')}</span>
  </div>
</div>
<p class="pricing-note">${t(l, 'home.pricing.note')}</p>
</section>

<section class="section grid-2">
<div>
<h2>${t(l, 'home.coverage.title')}</h2>
<p class="muted">${t(l, 'home.coverage.body')}</p>
<p class="muted">${t(l, 'home.coverage.dataLinks')}</p>
</div>
<div>
<h2>${t(l, 'home.developers.title')}</h2>
<p class="muted">${t(l, 'home.developers.body')}</p>
</div>
</section>

<section class="section">
<h2>${t(l, 'home.faq.title')}</h2>
<div class="faq-list">
  <details class="faq-item" open>
    <summary>${t(l, 'home.faq.items.accountSubscription.question')}<span class="chev" aria-hidden="true">▾</span></summary>
    <p class="answer">${config.creem.enabled ? t(l, 'home.faq.items.accountSubscription.answerCreem') : t(l, 'home.faq.items.accountSubscription.answer')}</p>
  </details>
  <details class="faq-item">
    <summary>${t(l, 'home.faq.items.creditsAndKeys.question')}<span class="chev" aria-hidden="true">▾</span></summary>
    <p class="answer">${t(l, 'home.faq.items.creditsAndKeys.answer')}</p>
  </details>
  <details class="faq-item">
    <summary>${t(l, 'home.faq.items.usdcWallet.question')}<span class="chev" aria-hidden="true">▾</span></summary>
    <p class="answer">${t(l, 'home.faq.items.usdcWallet.answer')}</p>
  </details>
  <details class="faq-item">
    <summary>${t(l, 'home.faq.items.demoRetention.question')}<span class="chev" aria-hidden="true">▾</span></summary>
    <p class="answer">${t(l, 'home.faq.items.demoRetention.answer')}</p>
  </details>
</div>
</section>

<section class="section cta-section">
<h2>${t(l, 'home.connect.title')}</h2>
<p>${t(l, 'home.connect.body', vars)}</p>
<p><a class="btn btn-secondary" href="${href(l, '/docs')}">${t(l, 'home.connect.docsLink')}</a> <a class="btn btn-secondary" href="/v1/demo">${t(l, 'home.connect.sampleLink')}</a></p>
</section>

${HOME_SCRIPT}`,
    {
      config,
      path,
      description: t(l, 'home.metaDescription'),
    },
  );
}


const DOCS_CURL_SEARCH = `# 1. Try a paid endpoint without payment → HTTP 402 + base64 PAYMENT-REQUIRED header
curl -i 'http://localhost:3000/v1/search?q=software&type=award'
# → 402
#   PAYMENT-REQUIRED: <base64 { x402Version: 2, resource, accepts: [{ scheme: "exact",
#     network: "eip155:84532", asset: "<USDC>", amount: "<base units>", payTo: "<addr>", ... }] }>

# 2. Sign an EIP-3009 transferWithAuthorization of USDC with an x402 client
#    (or viem directly) from the PAYMENT-REQUIRED requirement → base64 payload <payload>

# 3. Retry with the payment payload (v2; legacy X-PAYMENT also accepted)
curl -s 'http://localhost:3000/v1/search?q=software&type=award' \\
  -H "PAYMENT-SIGNATURE: <payload>"
# → {"data":[...],"meta":{"paid":true,"price_usd":"0.02",...}}

# 4. Local development only (PAYMENTS_MODE=dev): mint a dev token instead
curl -s -X POST 'http://localhost:3000/v1/dev-faucet' \\
  -H 'content-type: application/json' \\
  -d '{"endpoint":"GET /v1/search"}'
# → {"token":"<token>","proof":"<token>","endpoint":"GET /v1/search","amount":"0.02","expires_at":"..."}
curl -s 'http://localhost:3000/v1/search?q=software&type=award' \\
  -H "X-PAYMENT: <token>"`;

function docsPage(config: AppConfig): string {
  return page(
    'en',
    'Docs',
    `
<h1>Docs — Licita</h1>

<h2>Discovery order (for agents)</h2>
<ol>
<li><code>GET /llms.txt</code> — concise machine-readable service description.</li>
<li><code>GET /openapi.json</code> — full REST schema.</li>
<li><code>GET /v1/pricing</code> — machine-readable price ladder + payment flow.</li>
<li>Call paid endpoints, paying per call (below), or use MCP at <code>/mcp</code>.</li>
</ol>

<h2>Research — POST /v1/research</h2>
<p>One paid call (<code>$${config.researchPriceUsd}</code> USDC via x402, config-driven) turns a topic
into a deterministic research brief. NO LLM and no external APIs: every finding comes from the licita
database through the same builders as the raw endpoints, so it is reproducible and fully auditable.</p>
<ul>
<li><strong>Contract</strong> — body <code>{ "query": "&lt;topic&gt;", "limit": 1–10 }</code>; returns
<code>data.topic</code>, <code>data.confidence</code>, <code>data.summary</code>,
<code>data.findings[]</code> and <code>data.windows</code> in the standard envelope.</li>
<li><strong>Finding types</strong> — <code>tender</code>, <code>renewal</code>, <code>opportunity</code>,
<code>buyer</code>; each carries <code>evidence[]</code> plus <code>source</code>/<code>source_ref</code>.</li>
<li><strong>Confidence rule</strong> — evidence-strength heuristic: ≥2 distinct finding types with a
finding within the last 90 days → <code>high</code>; exactly 1 → <code>medium</code>; else
<code>low</code>. Deterministic and explainable, <em>not</em> a probability estimate.
<code>meta.methodology</code> states this framing explicitly.</li>
<li><strong>Evidence &amp; provenance</strong> — each finding lists its evidence lines; the envelope
exposes <code>meta.provenance</code> (deduped <code>{ source, source_ref }</code>, up to 10) and
<code>meta.generated_at</code>.</li>
</ul>
<p class="muted">Example: <code>POST /v1/research {"query": "health sector IT services", "limit": 5}</code>
→ a brief with confidence, summary and findings (see the homepage for the full shape).</p>

<h2>Demo — GET /v1/demo</h2>
<p>Free, zero-cost sample of what the paid API returns: the single most recent tender and the single
most recent renewal signal, each under an explicit <code>sample: true</code> marker, plus the list of
currently priced endpoints. Values are real rows — never fabricated. Use it to validate Licita data
before paying.</p>

<h2>Payment flow (x402 v2)</h2>
<p>Priced endpoints require a payment per call. Unpaid requests get <code>HTTP 402</code>
with the exact requirement in a base64 <code>PAYMENT-REQUIRED</code> response header
(<code>{ x402Version: 2, resource, accepts: [{ scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra }] }</code>).</p>
<ol>
<li>Call a paid endpoint without payment → <code>402</code> + <code>PAYMENT-REQUIRED</code> header.</li>
<li>Sign an EIP-3009 <code>transferWithAuthorization</code> of USDC for the advertised amount on the
advertised network (scheme <code>exact</code>) with an x402 client, producing a base64 payment payload.</li>
<li>Retry the original request with <code>PAYMENT-SIGNATURE: &lt;payload&gt;</code> (v2).
The legacy v1 header <code>X-PAYMENT</code> is still accepted for backward compatibility.</li>
<li>The server verifies <strong>and settles</strong> the payment through its facilitator before serving
content; proofs are single-use.</li>
</ol>
<p>Local development only (<code>PAYMENTS_MODE=${config.paymentsMode}</code>): when the payments mode is
<code>dev</code>, <code>POST /v1/dev-faucet</code> mints a dev token instead — retry with
<code>X-PAYMENT: &lt;token&gt;</code>. The faucet is <strong>not available in production</strong>.</p>
<pre>${DOCS_CURL_SEARCH}</pre>

<h2>Billing — prepaid credits &amp; the Creem MoR subscription arm</h2>
<p>Per-call proofs are the default way to pay. For regular usage, prepaid
<strong>credit bundles</strong> (5/10/25 USDC, one-time x402 purchase) are cheaper: send
<code>x-client-key</code> on every priced request and calls debit the balance
(<code>GET /v1/billing</code> reads it). Credits never expire and never touch the x402
proof path.</p>
${
  config.creem.enabled
    ? `<p><strong>Monthly subscription (Creem MoR)</strong>: <code>POST /v1/creem/checkout</code>
with an email opens a Creem Checkout session for <code>€${(config.creem.priceCents / 100).toFixed(2)}/month</code>
(config-driven — the price shown here is always the configured <code>CREEM_PRICE_CENTS</code>). After payment,
Creem calls <code>POST /v1/creem/webhook</code> (signature-verified) and the account is marked
<code>kind=creem</code> for 30 days. The subscriber's API key (<code>lct_...</code>) is generated
and emailed to the checkout email right after payment — send it as <code>x-client-key</code> to buy
credits and debit from your balance.</p>
<p class="muted">How subscriber calls are billed (honest description): a subscription grants
<strong>one-time credits</strong>, not metered per-call billing — each priced call debits your credit
balance, and running out simply returns <code>402</code> until you refill. Trial keys that upgrade
preserve their remaining calls; credits are consumed first and the preserved 25 trial calls stay usable.
Creem handles the payment itself; Licita never sees a card number.</p>`
    : `<p class="muted">Creem billing is <strong>not enabled</strong> on this deployment
(<code>CREEM_ENABLED=false</code>), so no subscription is advertised here and
<code>/v1/creem/*</code> answers <code>404</code>. The prepaid credit path above is fully available.</p>`
}
${
  config.trialEnabled
    ? `<p class="muted"><strong>Known trade-off for trial keys (B1)</strong>: a trial key's quota is
<code>calls_remaining</code> (25 calls), but the guard that prevents double-spending against credits
also blocks the very last call — the 25th call answers <code>403 trial_exhausted</code> with 0 calls
left. Effectively 24 of the 25 calls are usable; this is a conservative safety choice, documented openly.</p>`
    : `<p class="muted">Trial/pro keys are <strong>not enabled</strong> on this deployment
(<code>TRIAL_ENABLED=false</code>), so no trial quota branch is documented here; <code>lct_</code>
api_clients keys are inert and fall back to the credit/x402 proof path. Creem-subscriber keys
(<code>kind=creem</code>) are unaffected — they were purchased, not granted.</p>`
}

<h2>Endpoints</h2>
${priceTable(config, 'en')}
<p class="muted"><code>GET /v1/stats</code> additionally requires header
<code>x-operator-key</code>. Common query params: <code>page</code>, <code>size</code> (≤100),
<code>cpv</code> (prefix), <code>region</code> (NUTS), <code>from</code>/<code>to</code> (YYYY-MM-DD).</p>

<h2>MCP</h2>
<p>Streamable-HTTP MCP server at <code>POST /mcp</code> (transport is free; tools are
priced like their REST equivalents). Each tool accepts an optional
<code>payment_token</code> argument — the base64 payment payload (the same value a
REST client sends as <code>PAYMENT-SIGNATURE</code>). Unpaid calls return
<code>{"payment_required": true, "price_usd": "...", "how_to_pay": {...}}</code>
as normal content (not an error) — parse it, create the payment with an x402 client
from the <code>PAYMENT-REQUIRED</code> requirement, and retry with
<code>payment_token</code> set. In dev mode <code>how_to_pay</code> points at the
faucet instead.</p>
<p class="muted">Paid tools also accept <code>client_key</code>: when set, the call first tries to pay
from the prepaid balance (see <a href="/pricing">/pricing</a> → Credits &amp; billing) before requiring
a per-call proof. Buy credits via <code>billing_purchase_credits</code> and check the balance via
<code>billing_get_balance</code>.</p>
<pre># tools/list then e.g.
{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"search_tenders",
           "arguments":{"q":"software","type":"award","payment_token":"<token>"}}}</pre>

<h2>Discovery — Bazaar &amp; the server card</h2>
<ul>
<li><strong>Bazaar extension on 402s</strong> — every paid endpoint and paid MCP tool advertises its
discovery info via <code>extensions.bazaar</code> on the 402 <code>PAYMENT-REQUIRED</code>, so x402
facilitators can catalog Licita in Bazaar search (method, input/output examples, input schema).</li>
<li><strong>Server card</strong> — static MCP server card at
<a href="/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a>: identity, SSE
transport URL and the 11 tools with descriptions and input schemas, for directory crawlers that prefer
a static card over a live scan.</li>
<li><strong>How a facilitator catalogs Licita</strong> — hit <code>GET /v1/pricing</code> (free) for
the ladder, then any paid call; the 402 requirement carries <code>extensions.bazaar</code> and the
sanitized service metadata (name "Licita", tags <code>procurement/tenders/eu/contracts/ai</code>).
Read the card at <code>/.well-known/mcp/server-card.json</code> for the MCP surface.</li>
</ul>

<h2>Conventions</h2>
<ul>
<li>Envelope: <code>{"data": ..., "meta": {"request_id", "price_usd", "paid", "provenance": [...]}}</code>.</li>
<li>Errors: <code>{"error": {"code", "message", "hint"}}</code> — the hint is agent-actionable.</li>
<li>Nulls are never fabricated: unknown values stay <code>null</code>.</li>
<li>Framework agreement values are ceiling amounts, not actual spend.</li>
<li>Renewal signals (<code>GET /v1/renewals</code>) are deterministic heuristics over historical awards
and contract dates with confidence <code>low</code>/<code>medium</code>/<code>high</code> — not calibrated
probabilities. Each signal exposes its full evidence in <code>basis</code>.</li>
</ul>`,
    { config, path: '/docs', description: 'How to call Licita: discovery order, x402 payment flow, credits, MCP tools, server card and response conventions.', switcher: false },
  );
}

function pricingPage(config: AppConfig, locale: LocaleCode): string {
  const l = locale;
  const vars = {
    creemPrice: (config.creem.priceCents / 100).toFixed(2),
    researchPrice: config.researchPriceUsd,
    paymentsMode: config.paymentsMode,
    email: CONTACT_EMAIL,
    year: String(new Date().getFullYear()),
    mcpEndpoint: absoluteUrl(config.apiBaseUrl ?? config.baseUrl, '/mcp'),
  };
  const bundles = Object.entries(CREDIT_BUNDLES)
    .map(
      ([endpoint, cents]) =>
        `<tr><td><code>${endpoint}</code></td><td class="num">$${(cents / 100).toFixed(2)}</td></tr>`,
    )
    .join('\n');
  return page(
    l,
    t(l, 'pricing.title'),
    `
<h1>${t(l, 'pricing.title')}</h1>
<p class="muted">${t(l, 'pricing.intro', vars)}</p>
${priceTable(config, l)}
<p class="muted">${t(l, 'pricing.demoFreeNote')}</p>
<h2>${t(l, 'pricing.creditsTitle')}</h2>
${config.creem.enabled ? `<p class="muted">${t(l, 'pricing.creditsIntroCreem')}</p>` : `<p class="muted">${t(l, 'pricing.creditsIntro')}</p>`}
<table>
<thead><tr><th>${t(l, 'pricing.bundles.bundleHeader')}</th><th>${t(l, 'pricing.bundles.priceHeader')}</th></tr></thead>
<tbody>
${bundles}
</tbody>
</table>
<p class="muted">${t(l, 'pricing.twoRails')}</p>
${config.creem.enabled ? `<h2>${t(l, 'pricing.monthlyTitle')}</h2>\n<p class="muted">${t(l, 'pricing.monthlyBody', vars)}</p>\n` : ''}
<p class="muted">${t(l, 'pricing.buyLine')}</p>
<h2>${t(l, 'pricing.howPaymentTitle')}</h2>
<ol>
<li>${t(l, 'pricing.steps.0')}</li>
<li>${t(l, 'pricing.steps.1')}</li>
<li>${t(l, 'pricing.steps.2')}</li>
<li>${t(l, 'pricing.steps.3')}</li>
</ol>`,
    { config, path: href(l, '/pricing'), description: t(l, 'pricing.metaDescription') },
  );
}

function llmsTxt(config: AppConfig): string {
  const lines = Object.entries(ENDPOINT_PRICES)
    .map(([endpoint, price]) => `- ${endpoint} — ${price === '0.00' ? 'free' : `$${price}/call`}`)
    .join('\n');
  return `# Licita — public procurement intelligence for AI agents

## Overview
Licita answers the questions an agent needs to act on EU public procurement: recent tenders,
renewal/re-tender signals, company opportunities and active buyer activity. It sells decisions and
intelligence, not raw data: every finding carries evidence, a confidence label (low|medium|high) and
provenance (source + source_ref + upstream url). Data: TED (Tenders Electronic Daily) award notices
(live, default) plus PLACSP when PLACSP ingestion is enabled. Nulls are never fabricated.

## Try it — POST /v1/research (paid, ${config.paymentsMode === 'dev' ? 'dev' : 'x402'} mode)
POST /v1/research  {"query": "health sector IT services", "limit": 5}
→ 200 {"data": {"topic": "health sector IT services", "confidence": "high",
     "summary": "Recent EU procurement activity for \\"health sector IT services\\": 3 tender(s) ...",
     "findings": [{"type": "tender", "title": "Servicios de ciberseguridad para hospitales públicos",
       "detail": "Tender 13001: 72000000; estimated value EUR 180000.", "source": "ted",
       "source_ref": "130001-2026", "timestamp": "2026-06-20",
       "evidence": ["tender: Servicios de ciberseguridad para hospitales públicos"]}],
     "windows": {"tenders_days": 90, "renewals_days": 365}},
   "meta": {"request_id": "<uuid>", "price_usd": "${config.researchPriceUsd}", "paid": true,
     "provenance": [{"source": "ted", "source_ref": "130001-2026"}],
     "generated_at": "<iso>", "methodology": "...NOT a probability estimate."}}
Confidence rule: evidence-strength heuristic over distinct finding types with a finding within the
last 90 days: >=2 types → high, 1 → medium, else low. Deterministic over the licita database (no LLM).

## Endpoints (USD per call; JSON envelope {data, meta})
- POST /v1/research — $${config.researchPriceUsd}/call (research brief; always paid, config-driven)
${lines}
- Common params: q (full-text), cpv (prefix), buyer, company, region (NUTS), from/to (YYYY-MM-DD),
  type=award|tender|contract, page, size (<=100)
- GET /v1/demo is a free labeled sample (recent tender + renewal signal) — validate before paying.
- GET /v1/stats additionally requires header x-operator-key (operator only)

## MCP
- Streamable-HTTP at POST /mcp (transport is free; tools priced like their REST equivalents).
  Tools: search_tenders, get_tender, get_company, get_company_awards, get_company_opportunities,
  get_buyer_history, get_renewals, get_pricing, research, billing_get_balance, billing_purchase_credits.
- Static server card: /.well-known/mcp/server-card.json (identity, SSE URL, tool schemas).
- Every tool accepts optional payment_token — the base64 payment payload (same value a REST client
  sends as PAYMENT-SIGNATURE). Unpaid calls return {"payment_required": true, "price_usd": ...,
  "how_to_pay": {...}} with isError=false (parse as data, then pay + retry with payment_token).
- Paid tools also accept optional client_key: when set, the call first tries to pay from the prepaid
  balance instead of requiring a per-call proof.

## Credits (prepaid balance)
- One-time x402 purchase, no subscription. Buy: POST /v1/billing/credits/5 (or /10 /25) — $5.00 /
  $10.00 / $25.00. The payment proof is verified and recorded (replay blocked), then the account is
  credited.
- Pay from balance: send header x-client-key: <your key> on every priced request (REST) or the
  client_key argument on paid MCP tools. Insufficient balance falls back to the normal 402 flow.
- Check balance: GET /v1/billing (free) with header x-client-key; 404 when no account exists yet.
- MCP: billing_purchase_credits (paid, args: client_key + amount 5|10|25 + payment_token) and
  billing_get_balance (free, args: client_key).

## Payment (x402 v2; current mode: ${config.paymentsMode})
1. Call a paid endpoint without payment → HTTP 402 with a base64 PAYMENT-REQUIRED response header.
   The header value is JSON { x402Version: 2, resource, accepts[] }; accepts[0] is the exact
   requirement: scheme "exact", network (CAIP-2), USDC asset contract, amount (base units), payTo
   (recipient), maxTimeoutSeconds, and the EIP-712 domain (extra.name / extra.version) for signing.
2. Sign an EIP-3009 transferWithAuthorization of USDC for that amount on the stated network with an
   x402 client (or viem), producing a base64 payment payload.
3. Retry the request with the base64 payload in the PAYMENT-SIGNATURE header (v2). The server
   verifies AND settles the payment with its facilitator before serving content; proofs are
   single-use (replay rejected).
4. Legacy: the v1 X-PAYMENT header is still accepted for backward compatibility; v1 payloads are
   clearly marked x402Version: 1.
5. Local development ONLY (PAYMENTS_MODE=dev): POST /v1/dev-faucet {"endpoint": "<METHOD PATH>"} →
   {token, expires_at}; retry with header X-PAYMENT: <token>. The faucet route exists only when
   PAYMENTS_MODE=dev and NODE_ENV is not production — it is NOT available in production (the path 404s).

## Discovery
- /llms.txt (this file), /openapi.json (OpenAPI 3.1), /v1/pricing (machine-readable price ladder +
  payment flow), /docs (human docs), /pricing (price table), /mcp (MCP endpoint),
  /.well-known/mcp/server-card.json (MCP server card)
- Paid 402s carry extensions.bazaar (x402 Bazaar discovery extension) so facilitators catalog Licita.
- Use cases: /use-cases (index) and /use-cases/tender-intelligence, /use-cases/company-research,
  /use-cases/buyer-intelligence, /use-cases/renewals-forecasting — agent missions with the exact
  endpoints, costs and real response shapes.
- Data: /data (overview), /data/spain (PLACSP Spain), /data/eu (TED EU) — sources, coverage, examples.

## Response envelope
- Success: {"data": ..., "meta": {"request_id", "price_usd", "paid", "provenance": [...]}}.
  meta.provenance is an array of { source, source_ref, url }.
- Error: {"error": {"code", "message", "hint"}}. codes: invalid_query | not_found |
  payment_required | rate_limited | internal. The hint is agent-actionable.
- Nulls are never fabricated; framework agreement values are ceiling amounts, not actual spend.

## Renewals honesty
- GET /v1/renewals signals (framework_expiry | duration_expiry | recurrence) are a DETERMINISTIC
  HEURISTIC over historical awards and contract dates — NOT calibrated probabilities.
  meta.methodology states this framing; meta.confidence_scale is only [low, medium, high]; every
  signal exposes its full evidence in basis.

## Limits
- Rate limit: 60 requests/min per client; over limit → 429 with retry-after.
- ToS / attribution: reuse the data per the upstream sources' terms (TED and PLACSP) and attribute
  the source when republishing. See /docs.
`;
}

// --- MCP server card (SEP-1649 conservative well-known card) ---------------------
// Static JSON at /.well-known/mcp/server-card.json for directory crawlers that
// prefer a static card over a live scan (Smithery, Glama, others). Tool
// names/descriptions/inputSchema MIRROR src/mcp/server.ts TOOLS (deliberately
// not imported: pages.ts must stay dependency-free of the MCP module graph and
// the inputSchema values here are plain JSON Schema mirrors of the zod shapes).

// SERVER_CARD_URL is derived from config.apiBaseUrl (falling back to config.baseUrl) at runtime (serverCard function).

const PAYMENT_TOKEN_SCHEMA = {
  type: 'string',
  description:
    'Payment proof: dev mode → single-use token from POST /v1/dev-faucet; x402 mode → base64 payment payload (the PAYMENT-SIGNATURE / X-PAYMENT header value)',
} as const;

const CLIENT_KEY_SCHEMA = {
  type: 'string',
  description:
    'Prepaid credit balance key: when set, paid calls first try to debit this account instead of requiring a per-call proof.',
} as const;

const ID_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'integer', description: 'numeric id from search results' },
    payment_token: PAYMENT_TOKEN_SCHEMA,
    client_key: CLIENT_KEY_SCHEMA,
  },
  required: ['id'],
} as const;

const PAGE_SHAPE = { page: { type: 'integer' }, size: { type: 'integer' } } as const;

const SERVER_CARD_TOOLS: Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}> = [
  {
    name: 'search_tenders',
    description:
      'Search Spanish public-sector IT/software/cyber procurement: awards, tenders and contracts. Filters: q (full-text), cpv (prefix), buyer, company, region (NUTS), from/to (YYYY-MM-DD), type=award|tender|contract. Returns compact rows with ids for the other tools.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', maxLength: 200 },
        cpv: { type: 'string', description: 'CPV code or prefix, e.g. "72"' },
        buyer: { type: 'string', minLength: 2, maxLength: 200 },
        company: { type: 'string', minLength: 2, maxLength: 200 },
        region: { type: 'string', description: 'NUTS code or prefix, e.g. "ES61"' },
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD' },
        type: { type: 'string', enum: ['award', 'tender', 'contract'] },
        ...PAGE_SHAPE,
        payment_token: PAYMENT_TOKEN_SCHEMA,
        client_key: CLIENT_KEY_SCHEMA,
      },
    },
  },
  {
    name: 'get_tender',
    description:
      'Full tender detail by id: buyer, CPVs, deadline, estimated value, all awards/lots with winners, plus provenance (source + TED url).',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: ID_INPUT_SCHEMA,
  },
  {
    name: 'get_company',
    description:
      "Company profile by id: name, country, NIF, aliases and source identifiers (cross-source identity), plus aggregate stats (wins, total awarded value, top CPVs, top buyers).",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: ID_INPUT_SCHEMA,
  },
  {
    name: 'get_company_awards',
    description: 'Paginated award history for a company: dates, lots, values, tender + buyer context.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: { ...ID_INPUT_SCHEMA.properties, ...PAGE_SHAPE },
      required: ['id'],
    },
  },
  {
    name: 'get_company_opportunities',
    description:
      "Active/recent tenders matching a company's historical CPV/buyer profile, with a deterministic similarity score (explained in score_explanation).",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: { ...ID_INPUT_SCHEMA.properties, ...PAGE_SHAPE },
      required: ['id'],
    },
  },
  {
    name: 'get_buyer_history',
    description:
      'Buyer profile by id: award history, supplier concentration (top-supplier share) and per-CPV-division recurrence (median months between awards).',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: ID_INPUT_SCHEMA,
  },
  {
    name: 'get_renewals',
    description:
      'Forecast signals for likely re-tenders: contracts/frameworks approaching renewal. Filters: cpv (prefix), buyer, window_months (default 12, max 36), min_confidence=low|medium|high.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        cpv: { type: 'string' },
        buyer: { type: 'string', minLength: 2, maxLength: 200 },
        window_months: { type: 'integer', minimum: 1, maximum: 36 },
        min_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        ...PAGE_SHAPE,
        payment_token: PAYMENT_TOKEN_SCHEMA,
        client_key: CLIENT_KEY_SCHEMA,
      },
    },
  },
  {
    name: 'get_pricing',
    description: 'Machine-readable price ladder for all endpoints/tools plus the payment flow. Always free.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: { payment_token: PAYMENT_TOKEN_SCHEMA },
    },
  },
  {
    name: 'research',
    description:
      'High-level EU public procurement intelligence for a topic: recent tenders, relevant renewal signals, company opportunities and active buyers, each with evidence and an evidence-strength confidence label. ' +
      'Deterministic over the licita database (no LLM). Costs $0.50 USDC per call (x402). ' +
      'Use when an agent needs a research brief on a topic rather than raw rows from search_tenders/get_renewals.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'topic to research (matches tender full-text, company/buyer names, renewal signals)' },
        limit: { type: 'integer', description: 'max findings to return' },
        payment_token: PAYMENT_TOKEN_SCHEMA,
        client_key: CLIENT_KEY_SCHEMA,
      },
      required: ['query'],
    },
  },
  {
    name: 'billing_get_balance',
    description:
      'Check the prepaid credit balance for a client key (in cents and USD). Always free. Returns not_found when no account exists yet — buy credits via billing_purchase_credits to create one.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        client_key: {
          type: 'string',
          description: 'prepaid credit account key (must match the key used when buying credits)',
        },
      },
      required: ['client_key'],
    },
  },
  {
    name: 'billing_purchase_credits',
    description:
      'Buy a prepaid credit bundle (5, 10 or 25 USD) paid per-endpoint via x402 (mirrors REST POST /v1/billing/credits/:amount). ' +
      'Set amount to the bundle you pay for with payment_token; the proof is verified against that exact bundle, then the account is credited and the balance returned. ' +
      'Afterwards send client_key on every paid tool to pay from balance instead of per-call proofs.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        client_key: {
          type: 'string',
          description: 'prepaid credit account key to credit',
        },
        amount: {
          anyOf: [
            { type: 'string', enum: ['5', '10', '25'] },
            { type: 'integer', enum: [5, 10, 25] },
          ],
          description: 'bundle amount in USD: 5, 10 or 25',
        },
        payment_token: PAYMENT_TOKEN_SCHEMA,
      },
      required: ['client_key', 'amount'],
    },
  },
];

// --- P1: static use-case and data pages (agent-first discovery/SEO) ---------
// Plain semantic HTML like the rest of the site; every example is a REAL row
// shape (labeled example) so crawlers and agents see honest outputs.

interface UseCase {
  slug: string;
  example: string; // pre block, labeled example (locale-independent)
}

const USECASES: UseCase[] = [
  {
    slug: 'tender-intelligence',
    example: `# GET /v1/search?q=proteccion+de+datos&type=award  ($0.02 USDC)
→ {"data":[{ "id": 8684, "source": "placsp", "source_ref": "2026/CONTRAT/000064",
   "buyer": "Alcaldía del Ayuntamiento de Oleiros", "type": "award",
   "title": "Servizo de desenvolvemento de funcións e obrigas do delegado de protección de datos..." }],
   "meta": {"paid": true, "price_usd": "0.02", "provenance": [{"source":"placsp","source_ref":"2026/CONTRAT/000064"}]}}`,
  },
  {
    slug: 'company-research',
    example: `# GET /v1/companies/:id  ($0.05 USDC)
→ {"data": {"name": "APDTIC PROFESIONALES S.L.", "country": "ES", "nif": "...",
   "wins": 1, "total_awarded_eur": 18000, "top_cpvs": [{"cpv": "79000000", "count": 1}],
   "top_buyers": [{"buyer": "Alcaldía del Ayuntamiento de Oleiros", "count": 1}]},
   "meta": {"paid": true, "price_usd": "0.05"}}`,
  },
  {
    slug: 'buyer-intelligence',
    example: `# GET /v1/buyers/:id/history  ($0.05 USDC)
→ {"data": {"id": 1680, "name": "Alcaldía del Ayuntamiento de Oleiros", "awards_total": 1,
   "supplier_concentration": 1.0, "recurrence": [{"cpv": "79000000", "median_months": null}]},
   "meta": {"paid": true, "price_usd": "0.05"}}`,
  },
  {
    slug: 'renewals-forecasting',
    example: `# GET /v1/renewals?window_months=12&cpv=72  ($0.25 USDC)
→ {"data": {"signals": [{"id": 1, "signal_type": "duration_expiry", "cpv": "72000000",
   "buyer": {"name": "Consorci Hospital Clínic de Barcelona"},
   "window_start": "2022-09-18", "window_end": "2023-03-17", "confidence": "low",
   "basis": {"signal_type": "duration_expiry", "tender_ref": "..."}}],
   "meta": {"paid": true, "price_usd": "0.25",
   "methodology": "Deterministic heuristic — NOT calibrated probabilities."}}`,
  },
];

const USECASE_SLUGS: string[] = USECASES.map((uc) => uc.slug);
const EXAMPLE_BY_SLUG: Record<string, string> = Object.fromEntries(USECASES.map((uc) => [uc.slug, uc.example]));

function useCasesIndex(config: AppConfig, locale: LocaleCode): string {
  const l = locale;
  return page(
    l,
    t(l, 'usecases.title'),
    `
<h1>${t(l, 'usecases.title')}</h1>
<p class="muted">${t(l, 'usecases.intro')}</p>
${USECASE_SLUGS.map(
  (slug) => `<h2><a href="${href(l, `/use-cases/${slug}`)}">${t(l, `usecaseDetail.${slug}.title`)}</a></h2>
<p>${t(l, `usecaseDetail.${slug}.problem`)}</p>
<p class="muted">${t(l, `usecaseDetail.${slug}.tools`)}</p>`,
).join('\n')}
<h2>${t(l, 'usecases.freeTitle')}</h2>
<p>${t(l, 'usecases.freeBody')}</p>`,
    { config, path: href(l, '/use-cases'), description: t(l, 'usecases.metaDescription') },
  );
}

function useCasePage(config: AppConfig, locale: LocaleCode, slug: string): string | null {
  if (!USECASE_SLUGS.includes(slug)) return null;
  const l = locale;
  return page(
    l,
    `Use case: ${t(l, `usecaseDetail.${slug}.title`)}`,
    `
<h1>${t(l, `usecaseDetail.${slug}.title`)}</h1>
<p>${t(l, `usecaseDetail.${slug}.problem`)}</p>
<h2>${t(l, 'usecases.detail.toolsTitle')}</h2>
<p>${t(l, `usecaseDetail.${slug}.tools`)}</p>
<h2>${t(l, 'usecases.detail.exampleTitle')}</h2>
<pre>${EXAMPLE_BY_SLUG[slug]}</pre>
<h2>${t(l, 'usecases.detail.honestyTitle')}</h2>
<p class="muted">${t(l, `usecaseDetail.${slug}.honestNote`)}</p>
<p class="muted"><a href="${href(l, '/use-cases')}">${t(l, 'usecases.detail.allUseCases')}</a></p>`,
    { config, path: href(l, `/use-cases/${slug}`), description: t(l, `usecaseDetail.${slug}.problem`) },
  );
}

function dataPage(config: AppConfig, locale: LocaleCode, kind: 'overview' | 'spain' | 'eu'): string {
  const l = locale;
  const base = kind === 'overview' ? 'data.overview' : kind === 'spain' ? 'data.spain' : 'data.eu';
  const path = kind === 'overview' ? '/data' : kind === 'spain' ? '/data/spain' : '/data/eu';
  const bullets = [0, 1, 2].map((i) => `<li>${t(l, `${base}.bullets.${i}`)}</li>`).join('\n');
  const tail =
    kind === 'overview'
      ? `<h2>${t(l, 'data.overview.accessTitle')}</h2>
<p>${t(l, 'data.overview.accessBody')}</p>`
      : `<p class="muted"><a href="${href(l, '/data')}">${t(l, `${base}.overviewLink`)}</a></p>`;
  return page(
    l,
    t(l, `${base}.h1`),
    `
<h1>${t(l, `${base}.h1`)}</h1>
<p class="muted">${t(l, `${base}.intro`)}</p>
<ul>
${bullets}
</ul>
${tail}`,
    { config, path: href(l, path) },
  );
}

const TRUST_SLUGS: TrustPageSlug[] = ['methodology', 'security', 'privacy', 'terms', 'status'];

function trustPage(config: AppConfig, locale: LocaleCode, slug: TrustPageSlug): string {
  const l = locale;
  return page(
    l,
    t(l, `trust.${slug}.title`),
    `\n<h1>${t(l, `trust.${slug}.title`)}</h1>${t(l, `trust.${slug}.body`, { email: CONTACT_EMAIL })}<p><a href="${href(l, '/')}">${t(l, 'footer.backToLicita')}</a></p>`,
    { config, path: href(l, `/${slug}`) },
  );
}

function serverCard(config: AppConfig): Record<string, unknown> {
  return {
    schemaVersion: '2025-12-11',
    name: 'licita',
    description:
      'Public procurement intelligence for AI agents: EU tenders, renewal signals, company opportunities and buyer activity. Pay per call with USDC via x402.',
    url: absoluteUrl(config.apiBaseUrl ?? config.baseUrl, '/mcp'),
    transports: ['sse'],
    tools: SERVER_CARD_TOOLS,
  };
}

// --- Sitemap (spec DR3) ----------------------------------------------------------
// Public human-facing pages only: machine channels (/llms.txt, /openapi.json,
// /mcp, /v1/*) are not indexable pages and are deliberately not listed.
// URLs are derived from config.baseUrl (root-relative fallback when unset —
// dev/test only; production requires https BASE_URL via validateConfig).

const SITEMAP_PATHS = [
  '/',
  '/use-cases',
  ...USECASE_SLUGS.map((slug) => `/use-cases/${slug}`),
  '/data',
  '/data/spain',
  '/data/eu',
  '/pricing',
  '/docs',
  ...TRUST_SLUGS.map((slug) => `/${slug}`),
];

/**
 * Sitemap (spec DR3 + R3): every human pair contributes its own <url> carrying
 * es | en | x-default xhtml:link alternates; /docs is single-locale and emits a
 * bare <loc> entry with no alternates. No /es URLs ever appear. Alternate hrefs
 * are derived from config.baseUrl (root-relative fallback in dev/test).
 */
function sitemapXml(config: AppConfig): string {
  const human = SITEMAP_PATHS.filter((p) => p !== '/docs');
  const entries = human
    .map((path) => {
      const es = absoluteUrl(config.baseUrl, path);
      const en = absoluteUrl(config.baseUrl, path === '/' ? '/en' : `/en${path}`);
      const def = absoluteUrl(config.baseUrl, '/');
      return `  <url><loc>${escapeXml(es)}</loc>
    <xhtml:link rel="alternate" hreflang="es" href="${escapeXml(es)}" />
    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(en)}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(def)}" />
  </url>`;
    })
    .join('\n');
  const docs = `  <url><loc>${escapeXml(absoluteUrl(config.baseUrl, '/docs'))}</loc></url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
${docs}
</urlset>
`;
}

/**
 * Locale-aware HTML 404 (spec R4/M2): es at root, en under /en. noindex (never
 * index an error page), no canonical/hreflang/OG — informational head only.
 */
export function renderWeb404(_config: AppConfig, locale: LocaleCode): string {
  return page(locale, t(locale, 'notFound.title'), `\n<h1>${t(locale, 'notFound.heading')}</h1>`, {
    switcher: false,
    noindex: true,
  });
}

/**
 * Register web discovery surfaces: bilingual human pages (ES at root, EN under
 * `/en`), /docs (EN root, single-locale), /styles.css, /llms.txt,
 * /.well-known/mcp/server-card.json, /robots.txt, /sitemap.xml — all free —
 * plus the dev faucet (POST /v1/dev-faucet).
 */
export function registerWeb(app: FastifyInstance, config: AppConfig): void {
  const demoStatus = (req: FastifyRequest) => (req.query as { demo?: string }).demo === 'success';
  const notFound = (locale: LocaleCode) => renderWeb404(config, locale);

  app.get('/', async (req, reply) => reply.type('text/html; charset=utf-8').send(homePage(config, 'es', demoStatus(req))));
  app.get('/en', async (req, reply) => reply.type('text/html; charset=utf-8').send(homePage(config, 'en', demoStatus(req))));
  app.get('/styles.css', async (_req, reply) => reply.type('text/css; charset=utf-8').send(HUMAN_CSS));
  app.get('/docs', async (_req, reply) => reply.type('text/html; charset=utf-8').send(docsPage(config)));
  app.get('/use-cases', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(useCasesIndex(config, 'es')),
  );
  app.get('/en/use-cases', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(useCasesIndex(config, 'en')),
  );
  app.get('/use-cases/:slug', async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const html = useCasePage(config, 'es', slug);
    if (!html) return reply.code(404).type('text/html; charset=utf-8').send(notFound('es'));
    return reply.type('text/html; charset=utf-8').send(html);
  });
  app.get('/en/use-cases/:slug', async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const html = useCasePage(config, 'en', slug);
    if (!html) return reply.code(404).type('text/html; charset=utf-8').send(notFound('en'));
    return reply.type('text/html; charset=utf-8').send(html);
  });
  app.get('/data', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(dataPage(config, 'es', 'overview')),
  );
  app.get('/en/data', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(dataPage(config, 'en', 'overview')),
  );
  app.get('/data/spain', async (_req, reply) => reply.type('text/html; charset=utf-8').send(dataPage(config, 'es', 'spain')));
  app.get('/en/data/spain', async (_req, reply) => reply.type('text/html; charset=utf-8').send(dataPage(config, 'en', 'spain')));
  app.get('/data/eu', async (_req, reply) => reply.type('text/html; charset=utf-8').send(dataPage(config, 'es', 'eu')));
  app.get('/en/data/eu', async (_req, reply) => reply.type('text/html; charset=utf-8').send(dataPage(config, 'en', 'eu')));
  for (const slug of TRUST_SLUGS) {
    app.get(`/${slug}`, async (_req, reply) => reply.type('text/html; charset=utf-8').send(trustPage(config, 'es', slug)));
    app.get(`/en/${slug}`, async (_req, reply) => reply.type('text/html; charset=utf-8').send(trustPage(config, 'en', slug)));
  }
  app.get('/pricing', async (_req, reply) => reply.type('text/html; charset=utf-8').send(pricingPage(config, 'es')));
  app.get('/en/pricing', async (_req, reply) => reply.type('text/html; charset=utf-8').send(pricingPage(config, 'en')));
  app.get('/en/', async (_req, reply) => reply.redirect('/en', 301));
  app.get('/es', async (req, reply) => reply.redirect(req.url.replace(/^\/es(?=\/|$)/, '') || '/', 301));
  app.get('/es/*', async (req, reply) => reply.redirect(req.url.replace(/^\/es(?=\/|$)/, '') || '/', 301));
  app.get('/llms.txt', async (_req, reply) => reply.type('text/plain; charset=utf-8').send(llmsTxt(config)));
  app.get('/robots.txt', async (_req, reply) =>
    reply.type('text/plain; charset=utf-8').send('User-agent: *\nAllow: /\n'),
  );
  app.get('/sitemap.xml', async (_req, reply) =>
    reply.type('application/xml; charset=utf-8').send(sitemapXml(config)),
  );
  app.get('/.well-known/mcp/server-card.json', async (_req, reply) =>
    reply.type('application/json; charset=utf-8').send(serverCard(config)),
  );
  registerDevFaucet(app, config);
}

// registerWeb(app, config) — discovery surfaces (SPEC §7): /, /docs, /pricing,
// /llms.txt, /robots.txt, the MCP server card and the dev faucet. Plain
// semantic HTML, no JS. Customer-facing brand is "Licita".
// /openapi.json is served by src/api/server.ts (W2); we only link to it.

import type { FastifyInstance } from 'fastify';
import { CREDIT_BUNDLES, ENDPOINT_PRICES } from '../domain/types.js';
import type { AppConfig } from '../config.js';
import { registerDevFaucet } from '../pay/devProvider.js';
import { HUMAN_CSS } from './site.css.js';

const CSS = `
:root { color-scheme: light; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  margin: 0; background: #fafafa; color: #1f2430; line-height: 1.55; }
main { max-width: 52rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; color: #182030; }
h2 { font-size: 1.15rem; margin-top: 2rem; color: #2a3242; border-bottom: 1px solid #e3e6eb; padding-bottom: .25rem; }
a { color: #2f5d8a; }
code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .85em; }
pre { background: #f0f1f4; border: 1px solid #e0e3e9; border-radius: 6px; padding: .75rem 1rem; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; margin: .75rem 0; font-size: .9rem; }
th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #e3e6eb; }
th { color: #4a5468; font-weight: 600; }
td.num { font-variant-numeric: tabular-nums; }
.muted { color: #5b6575; }
nav a { margin-right: 1rem; }
.tag { display: inline-block; background: #eceff3; border-radius: 4px; padding: 0 .4em; font-size: .8em; color: #45506a; }
`;

function page(title: string, body: string, head = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
<title>${title} — Licita</title>
<style>${CSS}</style>
</head>
<body><main>
${body}
</main></body>
</html>`;
}

const NAV = `<a class="skip-link" href="#main-content">Skip to content</a><nav class="site-nav" aria-label="Primary"><a href="/">Home</a><a href="/use-cases">Use cases</a><a href="/data">Coverage &amp; methodology</a><a href="/pricing">Pricing</a><a href="/docs">Docs</a><a href="/mcp">MCP</a></nav>`;

/** ENDPOINT_PRICES rows (Research is config-owned and rendered separately). */
const ENDPOINT_ROWS = Object.entries(ENDPOINT_PRICES)
  .map(
    ([endpoint, price]) =>
      `<tr><td><code>${endpoint}</code></td><td class="num">${price === '0.00' ? '<span class="tag">free</span>' : `$${price}`}</td></tr>`,
  )
  .join('\n');

/** Price table: POST /v1/research (config-driven price) above the fixed ladder. */
function priceTable(config: AppConfig): string {
  const researchRow = `<tr><td><code>POST /v1/research</code></td><td class="num">$${config.researchPriceUsd}</td></tr>`;
  return `<table>
<thead><tr><th>Endpoint</th><th>Price (USD / call)</th></tr></thead>
<tbody>
${researchRow}
${ENDPOINT_ROWS}
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
const CONTACT_EMAIL = 'gastonrey@gmail.com';

function homePage(config: AppConfig, demoStatus = false): string {
  return page(
    'Licita — know which public contracts deserve your next conversation',
     `${NAV}
<div id="main-content" class="human-home"><section class="hero"><p class="source-stamp">EU PUBLIC PROCUREMENT INTELLIGENCE · EVIDENCE FIRST</p><h1>Know which public contracts deserve your next conversation.</h1>
<p>Licita turns indexed procurement notices into evidence-backed opportunity, buyer, supplier and deterministic renewal signals for professional teams and their agents.</p></section>

<div class="home-columns"><section><h2>Current index sample</h2><article id="demo-sample" class="evidence-rail" data-state="loading" aria-live="polite"><p>Loading…</p><p class="source-stamp">GET /v1/demo · sample status</p></article></section><aside><h2>Scope at a glance</h2><div class="trust-grid"><div><strong>TED</strong><br>EU award notices<br><span class="source-stamp">Enabled · freshness shown at ingestion</span></div><div><strong>PLACSP</strong><br>Spain contracts when enabled<br><span class="source-stamp">Status is operational, not assumed</span></div><div><strong>Dates</strong><br>Publication date ≠ award/contract date<br><span class="source-stamp">Unknown: Not reported</span></div></div></aside></div>

<section class="cta"><h2>See your next opportunity in context.</h2>
<p>A free labeled sample from the current index, followed by a guided review of your market. We retain demo emails for 30 days unless the lead advances to contacted, used or paid.</p>
<form id="demo-request" method="post" action="/v1/demo/request"><label for="demo-email">Work email</label><br>
<input id="demo-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" required placeholder="name@company.com">
<button class="btn" type="submit">Request the product demo</button><p id="demo-message" class="demo-message" role="status" aria-live="polite">${demoStatus ? 'Demo request received. We will follow up by email; no meeting was booked.' : ''}</p></form>
<noscript><p>Email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> to request a demo.</p></noscript></section>

 <section><h2>Coverage, trust &amp; privacy</h2><p>Coverage is strongest in the indexed IT, software and cyber vertical. See <a href="/data">source scope and methodology</a> for enabled sources, date ranges and last successful ingestion. Every finding carries a source reference and upstream link where known. We store only a normalized email, channel and source URL; operator access is restricted and deletion requests can be sent to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p><p><a href="/methodology">Methodology</a> · <a href="/security">Security</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/status">Status</a> · <a href="mailto:${CONTACT_EMAIL}">Contact</a></p></section>

<h2>Get access</h2>
<p>Licita is live and connectable right now — point an MCP client at
<code>https://eutenders.duckdns.org/mcp</code> and try the free demo
(<a href="/v1/demo">GET /v1/demo</a>) before paying. To discuss a project, a
white-label data deal or a prepaid plan, email <a
href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

<h2>Pay per call, machine-to-machine</h2>
<p>Pay per call with <strong>USDC via x402</strong> — no subscriptions, no signup, machine-to-machine.
An unpaid request returns <code>HTTP 402</code> with the exact payment requirement in a base64
<code>PAYMENT-REQUIRED</code> header; sign the EIP-3009 authorization and retry with
<code>PAYMENT-SIGNATURE</code>. The server verifies <em>and settles</em> before serving content. Start at
<code>GET /v1/pricing</code> for the full price ladder.</p>

<h2>How agents use it</h2>
<ul>
<li><strong>MCP</strong> — streamable-HTTP server at <code>/mcp</code> with 11 tools
(<code>${MCP_TOOLS.join('</code>, <code>')}</code>). Static server card:
<a href="/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a>.</li>
<li><strong>REST</strong> — priced per call, x402-compatible. Send the base64 payment payload as the
<code>PAYMENT-SIGNATURE</code> header (legacy v1 <code>X-PAYMENT</code> still accepted). Start at
<a href="/llms.txt">/llms.txt</a> → <a href="/openapi.json">/openapi.json</a> → <a href="/v1/pricing">/v1/pricing</a>.</li>
<li><strong>Humans</strong> — <a href="/docs">/docs</a> quickstart, <a href="/pricing">/pricing</a> ladder.</li>
</ul>

<h2>What questions it answers</h2>
<ul>
<li><strong>Who bought what, who won, for how much, under which CPV codes.</strong></li>
<li><strong>Company track record: wins, total awarded value, top CPVs and buyers.</strong></li>
<li><strong>Buyer history: award history, supplier concentration, re-tender recurrence.</strong></li>
<li><strong>Upcoming renewals: contracts and frameworks likely to be re-tendered soon
(deterministic heuristic with per-signal evidence — not a probability model).</strong></li>
</ul>

<h2>Use cases</h2>
<p>Concrete agent missions with the exact endpoints and costs:
<a href="/use-cases/tender-intelligence">tender intelligence</a>,
<a href="/use-cases/company-research">company research</a>,
<a href="/use-cases/buyer-intelligence">buyer intelligence</a>,
<a href="/use-cases/renewals-forecasting">renewals forecasting</a>.</p>

<h2>Data</h2>
<p>What Licita indexes and where it comes from:
<a href="/data">data overview</a>, <a href="/data/spain">Spain (PLACSP)</a>,
<a href="/data/eu">EU (TED)</a>.</p>

<h2>Payment mode</h2>
<p>Payments mode: <code>${config.paymentsMode}</code>. Priced endpoints return
<code>402</code> with a base64 <code>PAYMENT-REQUIRED</code> header describing the exact
USDC requirement (x402 v2): sign the EIP-3009 authorization and retry with
<code>PAYMENT-SIGNATURE</code>. In dev mode a token faucet is available at
<code>POST /v1/dev-faucet</code> (local development only — not in production).
See <a href="/docs">docs</a> for the full flow.</p>
${priceTable(config)}
<h2>Distribution &amp; registry</h2>
<p>Licita is discoverable by agents through MCP registries and directories:</p>
<ul>
<li><strong>MCP registry manifest</strong> — <code>/server.json</code> (streamable-HTTP at
<code>https://eutenders.duckdns.org/mcp</code>).</li>
<li><strong>Static server card</strong> — <code>/.well-known/mcp/server-card.json</code>
(identity, SSE URL, the 11 tool schemas) for directory crawlers.</li>
<li><strong>Bazaar extension</strong> — paid 402s carry <code>extensions.bazaar</code>, so x402
facilitators catalog Licita automatically.</li>
<li><strong>Directories</strong> — listed on Glama and mcp.so (badges in the README).</li>
<li><strong>Source</strong> — <a href="https://github.com/gastonrey/licita-app">GitHub repository</a> (MIT).</li>
</ul>
<footer class="site-footer"><p>Questions? <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
<p class="muted">Provenance: every data row exposes <code>meta.provenance</code> as
<code>[{ source, source_ref, url }]</code> — the upstream source, its publication reference, and the
original notice where known. Nulls are never fabricated.</p></footer></div>
 <script>const sample=document.getElementById('demo-sample');const safe=(v)=>String(v??'Not reported').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const lines=(xs)=>'<ul class="evidence-lines">'+(xs||[]).map(x=>'<li>'+safe(x)+'</li>').join('')+'</ul>';fetch('/v1/demo').then(r=>{if(!r.ok)throw new Error('sample unavailable');return r.json()}).then(({data,meta})=>{const t=data.tender,r=data.renewal;sample.dataset.state='ready';sample.innerHTML=(t?'<h3>'+safe(t.title)+'</h3><p><strong>Buyer:</strong> '+safe(t.buyer?.name)+' · <strong>Value:</strong> '+safe(t.estimated_value)+' '+safe(t.currency||'')+' · <strong>Published:</strong> '+safe(t.published_at)+'</p>'+lines(t.evidence):'<p>No current sample is available.</p>')+(r?'<p><strong>Renewal signal:</strong> '+safe(r.signal_type)+' · '+safe(r.confidence)+' confidence · '+safe(r.contract?.end_date)+'</p>'+lines(r.evidence):'<p>No current renewal sample is available.</p>')+'<p class="source-stamp">'+safe(t?.source||r?.source||'source')+' · '+safe(t?.source_ref||r?.source_ref)+' · generated '+safe(meta?.generated_at)+'</p>'+((t?.url||r?.url)?'<p><a class="upstream" href="'+safe(t?.url||r?.url)+'" target="_blank" rel="noreferrer">Open upstream source</a></p>':'')+'<p class="source-stamp">source_metadata: '+safe(JSON.stringify(data.source_metadata||[]))+'</p>'}).catch(()=>{sample.dataset.state='error';sample.innerHTML='<p>Sample unavailable. <a href="/docs">Read the methodology</a>.</p>'});document.getElementById('demo-request').addEventListener('submit',async(e)=>{e.preventDefault();const f=e.currentTarget,m=document.getElementById('demo-message'),b=f.querySelector('button');m.textContent='Requesting a demo…';b.disabled=true;try{const r=await fetch('/v1/demo/request?source=homepage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:f.email.value})});if(!r.ok){const body=await r.json().catch(()=>({}));throw new Error(body.error?.hint||'Check your email and try again.')}m.textContent='Request received. We will follow up by email; no meeting was booked.';f.reset()}catch(err){m.textContent=err.message+' You can also email ${CONTACT_EMAIL}.'}finally{b.disabled=false}})</script>`,
     `<link rel="stylesheet" href="/styles.css">`,
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
    'Docs',
    `${NAV}
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

<h2>Endpoints</h2>
${priceTable(config)}
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
  );
}

function pricingPage(config: AppConfig): string {
  return page(
    'Pricing',
    `${NAV}
<h1>Pricing</h1>
<p class="muted">Per-call prices in USD. Machine-readable version:
<a href="/v1/pricing">/v1/pricing</a>. Payments mode: <code>${config.paymentsMode}</code>.
<code>POST /v1/research</code> costs <code>$${config.researchPriceUsd}</code> per call (config-driven).</p>
${priceTable(config)}
<p class="muted"><code>GET /v1/demo</code> is free: a labeled sample of the paid data (recent tender +
renewal signal), so agents can validate quality before paying.</p>
<h2>Credits &amp; billing</h2>
<p class="muted">Prepaid credit bundles — a one-time x402 purchase, no subscription. Buy a bundle, then
pay every call from your balance by sending <code>x-client-key: &lt;your key&gt;</code> on the request
(instead of a per-call payment proof).</p>
<table>
<thead><tr><th>Bundle</th><th>Price (USD)</th></tr></thead>
<tbody>
${Object.entries(CREDIT_BUNDLES)
  .map(
    ([endpoint, cents]) =>
      `<tr><td><code>${endpoint}</code></td><td class="num">$${(cents / 100).toFixed(2)}</td></tr>`,
  )
  .join('\n')}
</tbody>
</table>
<p class="muted">Buy: <code>POST /v1/billing/credits/5</code> (or <code>/10</code> <code>/25</code>) with
the normal x402 payment flow (402 → <code>PAYMENT-SIGNATURE</code> retry). Check balance:
<code>GET /v1/billing</code> with header <code>x-client-key: &lt;your key&gt;</code>. MCP:
<code>billing_purchase_credits</code> / <code>billing_get_balance</code>.</p>
<h2>How payment works</h2>
<ol>
<li>Call a paid endpoint → <code>402</code> with a base64 <code>PAYMENT-REQUIRED</code> header
describing the exact USDC requirement (scheme <code>exact</code>, EIP-3009 transferWithAuthorization).</li>
<li>Sign the authorization with an x402 client and retry with
<code>PAYMENT-SIGNATURE: &lt;payload&gt;</code> (v2; the legacy <code>X-PAYMENT</code> header still works).</li>
<li>The server verifies and settles the payment before serving content; proofs are single-use.</li>
<li>Local dev only (<code>PAYMENTS_MODE=dev</code>): <code>POST /v1/dev-faucet {"endpoint":"&lt;METHOD PATH&gt;"}</code>
→ <code>{ token, expires_at }</code>, then retry with <code>X-PAYMENT</code> (REST) or
<code>payment_token</code> (MCP). Not available in production.</li>
</ol>`,
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

const SERVER_CARD_URL = 'https://eutenders.duckdns.org/mcp';

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
  title: string;
  problem: string;
  tools: string; // prose: which endpoints/MCP tools + price
  example: string; // pre block, labeled example
  honestNote: string;
}

const USECASES: UseCase[] = [
  {
    slug: 'tender-intelligence',
    title: 'Tender intelligence — find recent tenders and who won',
    problem:
      'An agent needs recent procurement activity on a topic: which tenders were published or awarded, by whom, for how much, with provenance.',
    tools:
      '<code>GET /v1/search</code> ($0.02/call) for compact rows, <code>GET /v1/tenders/:id</code> ($0.02/call) for full tender + award detail. MCP: <code>search_tenders</code>, <code>get_tender</code>.',
    example: `# GET /v1/search?q=proteccion+de+datos&type=award  ($0.02 USDC)
→ {"data":[{ "id": 8684, "source": "placsp", "source_ref": "2026/CONTRAT/000064",
   "buyer": "Alcaldía del Ayuntamiento de Oleiros", "type": "award",
   "title": "Servizo de desenvolvemento de funcións e obrigas do delegado de protección de datos..." }],
   "meta": {"paid": true, "price_usd": "0.02", "provenance": [{"source":"placsp","source_ref":"2026/CONTRAT/000064"}]}}`,
    honestNote: 'Every row exposes meta.provenance (source + source_ref + upstream url). Nulls are never fabricated.',
  },
  {
    slug: 'company-research',
    title: 'Company research — track record and live opportunities',
    problem:
      'An agent evaluating a supplier needs wins, total awarded value, top CPVs and buyers, plus tenders matching that company profile right now.',
    tools:
      '<code>GET /v1/companies/:id</code> ($0.05), <code>GET /v1/companies/:id/awards</code> ($0.05), <code>GET /v1/companies/:id/opportunities</code> ($0.10). MCP: <code>get_company</code>, <code>get_company_awards</code>, <code>get_company_opportunities</code>.',
    example: `# GET /v1/companies/:id  ($0.05 USDC)
→ {"data": {"name": "APDTIC PROFESIONALES S.L.", "country": "ES", "nif": "...",
   "wins": 1, "total_awarded_eur": 18000, "top_cpvs": [{"cpv": "79000000", "count": 1}],
   "top_buyers": [{"buyer": "Alcaldía del Ayuntamiento de Oleiros", "count": 1}]},
   "meta": {"paid": true, "price_usd": "0.05"}}`,
    honestNote: 'Company identity is cross-source (NIF + aliases + source identifiers); aggregates are computed over the indexed history only and every response exposes meta.provenance.',
  },
  {
    slug: 'buyer-intelligence',
    title: 'Buyer intelligence — activity, concentration, recurrence',
    problem:
      'An agent needs a buyer profile: award history, supplier concentration (top-supplier share) and per-CPV recurrence so it can time outreach.',
    tools:
      '<code>GET /v1/buyers/:id/history</code> ($0.05/call). MCP: <code>get_buyer_history</code>.',
    example: `# GET /v1/buyers/:id/history  ($0.05 USDC)
→ {"data": {"id": 1680, "name": "Alcaldía del Ayuntamiento de Oleiros", "awards_total": 1,
   "supplier_concentration": 1.0, "recurrence": [{"cpv": "79000000", "median_months": null}]},
   "meta": {"paid": true, "price_usd": "0.05"}}`,
    honestNote: 'Concentration/recurrence are derived from indexed awards; small histories can show 1.0 concentration — read counts alongside ratios. Every response exposes meta.provenance.',
  },
  {
    slug: 'renewals-forecasting',
    title: 'Renewals forecasting — which contracts will be re-tendered',
    problem:
      'An agent hunting pipeline wants contracts and frameworks likely to be re-tendered in a window, with per-signal evidence.',
    tools:
      '<code>GET /v1/renewals?window_months=12</code> ($0.25/call) or <code>POST /v1/research</code> ($0.50/call) for a full brief. MCP: <code>get_renewals</code>, <code>research</code>.',
    example: `# GET /v1/renewals?window_months=12&cpv=72  ($0.25 USDC)
→ {"data": {"signals": [{"id": 1, "signal_type": "duration_expiry", "cpv": "72000000",
   "buyer": {"name": "Consorci Hospital Clínic de Barcelona"},
   "window_start": "2022-09-18", "window_end": "2023-03-17", "confidence": "low",
   "basis": {"signal_type": "duration_expiry", "tender_ref": "..."}}],
   "meta": {"paid": true, "price_usd": "0.25",
   "methodology": "Deterministic heuristic — NOT calibrated probabilities."}}`,
    honestNote:
      'Signals are a deterministic heuristic over historical awards and dates with confidence low|medium|high — never a probability estimate. Every signal exposes its full evidence in basis, and the envelope carries meta.provenance.',
  },
];

const USECASE_INDEX = `
<h1>Use cases</h1>
<p class="muted">Concrete agent missions, the exact endpoints and MCP tools that solve them, their cost,
and what a real response looks like. Every example is a labeled sample — agents get the same shapes
after paying per call.</p>
${USECASES.map(
  (uc) => `<h2><a href="/use-cases/${uc.slug}">${uc.title}</a></h2>
<p>${uc.problem}</p>
<p class="muted">${uc.tools}</p>`,
).join('\n')}
<h2>Free first look</h2>
<p>Validate the data before paying: <a href="/v1/demo">GET /v1/demo</a> returns a labeled sample of the
most recent tender + renewal signal at no cost.</p>`;

function useCasePage(slug: string): string | null {
  const uc = USECASES.find((u) => u.slug === slug);
  if (!uc) return null;
  return page(
    `Use case: ${uc.title}`,
    `${NAV}
<h1>${uc.title}</h1>
<p>${uc.problem}</p>
<h2>Tools</h2>
<p>${uc.tools}</p>
<h2>Example response (labeled sample)</h2>
<pre>${uc.example}</pre>
<h2>Honesty note</h2>
<p class="muted">${uc.honestNote}</p>
<p class="muted"><a href="/use-cases">all use cases</a></p>`,
  );
}

const DATA_OVERVIEW = `
<h1>Data</h1>
<p class="muted">What Licita indexes, where it comes from, and how agents can validate it before paying.
Counts are updated on ingestion — they are operational facts, not projections.</p>
<ul>
<li><strong>Current records and indexed ranges</strong> are returned from live source metadata; no fixed coverage claim is made.</li>
<li><strong>TED</strong> (Tenders Electronic Daily) — EU award notices, live by default:
<a href="/data/eu">EU data page</a>.</li>
<li><strong>PLACSP</strong> — Spanish public-sector contracts (<code>2026/CONTRAT/…</code> refs) when PLACSP
ingestion is enabled: <a href="/data/spain">Spain data page</a>.</li>
</ul>
<h2>Access</h2>
<p>Free: <a href="/v1/demo">GET /v1/demo</a> (labeled sample), <a href="/v1/pricing">price ladder</a>,
<a href="/llms.txt">/llms.txt</a>, <a href="/openapi.json">OpenAPI</a>. Paid: every row returns
<code>meta.provenance</code> (source + source_ref + upstream url); nulls are never fabricated.</p>`;

const DATA_SPAIN = `
<h1>Data — Spain (PLACSP)</h1>
<p class="muted">Spanish public-sector procurement contracts ingested from PLACSP when enabled.
Publication references look like <code>2026/CONTRAT/000064</code>.</p>
<ul>
<li><strong>Coverage</strong> — awards with buyer, winner, CPV codes, values and publication refs;
Spanish public-sector entities (city councils, regional governments, agencies).</li>
<li><strong>Example rows</strong> — award by Alcaldía del Ayuntamiento de Oleiros to
APDTIC PROFESIONALES S.L. (ref <code>2026/CONTRAT/000064</code>); award by Dirección General de
IBERMUTUA to Mnemo Evolution &amp; Integration Services, S.A.</li>
<li><strong>Query</strong> — <code>GET /v1/search?q=…&amp;type=award</code>, <code>GET /v1/companies/:id</code>,
<code>GET /v1/buyers/:id/history</code>, <code>GET /v1/renewals</code>.</li>
</ul>
<p class="muted"><a href="/data">data overview</a></p>`;

const DATA_EU = `
<h1>Data — EU (TED)</h1>
<p class="muted">EU public procurement award notices ingested from TED (Tenders Electronic Daily).
Provenance links to the original notice (<code>ted.europa.eu/udl?uri=TED:NOTICE:…</code>).</p>
<ul>
<li><strong>Coverage</strong> — notices with publication-number, buyer, winner, CPV, values,
submissions and framework-agreement flags across EU member states.</li>
<li><strong>Renewal signals</strong> — duration-expiry, framework-expiry and recurrence signals are
derived from historical awards (deterministic heuristic, confidence low|medium|high).</li>
<li><strong>Query</strong> — <code>GET /v1/search</code>, <code>GET /v1/tenders/:id</code>,
<code>POST /v1/research</code> (topic brief), <code>GET /v1/renewals</code>.</li>
</ul>
<p class="muted"><a href="/data">data overview</a></p>`;

function dataPage(kind: 'overview' | 'spain' | 'eu'): string {
  const map = {
    overview: ['Data', DATA_OVERVIEW],
    spain: ['Data — Spain (PLACSP)', DATA_SPAIN],
    eu: ['Data — EU (TED)', DATA_EU],
  } as const;
  const [title, body] = map[kind];
  return page(title, `${NAV}\n${body}`);
}

const TRUST_PAGES: Record<string, [string, string]> = {
  methodology: ['Methodology', '<p>Licita presents source rows and deterministic heuristics with their evidence. Confidence is evidence strength, not a probability. Coverage counts, indexed ranges and freshness are shown only when supplied by the live index; unknown values are Not reported.</p>'],
  security: ['Security', '<p>Operator statistics and lead details require the server-side operator key. Public demo capture is rate limited and stores only a normalized email, channel, source URL and lifecycle timestamps. Licita does not claim a certification or SLA on this page.</p>'],
  privacy: ['Privacy', '<p>Demo emails are retained for 30 days unless the lead advances to contacted, used or paid. Access is restricted to operators. Request deletion or ask a privacy question by email.</p>'],
  terms: ['Terms', '<p>Use Licita and upstream data in accordance with applicable law and the terms of TED and PLACSP. This page is informational; contact us before relying on data for a material decision.</p>'],
  status: ['Status', '<p>Service status and source freshness are operational values, not guarantees. Check the response metadata and contact us to report an issue. No uptime SLA is claimed here.</p>'],
};

function serverCard(config: AppConfig): Record<string, unknown> {
  return {
    schemaVersion: '2025-12-11',
    name: 'licita',
    description:
      'Public procurement intelligence for AI agents: EU tenders, renewal signals, company opportunities and buyer activity. Pay per call with USDC via x402.',
    url: SERVER_CARD_URL,
    transports: ['sse'],
    tools: SERVER_CARD_TOOLS,
  };
}

/**
 * Register web discovery surfaces: GET /, /docs, /pricing, /llms.txt,
 * /.well-known/mcp/server-card.json, /robots.txt — all free — plus the dev
 * faucet (POST /v1/dev-faucet).
 */
export function registerWeb(app: FastifyInstance, config: AppConfig): void {
  app.get('/', async (req, reply) => reply.type('text/html; charset=utf-8').send(homePage(config, (req.query as { demo?: string }).demo === 'success')));
  app.get('/styles.css', async (_req, reply) => reply.type('text/css; charset=utf-8').send(HUMAN_CSS));
  app.get('/docs', async (_req, reply) => reply.type('text/html; charset=utf-8').send(docsPage(config)));
  app.get('/use-cases', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(page('Use cases', `${NAV}\n${USECASE_INDEX}`)),
  );
  app.get('/use-cases/:slug', async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const html = useCasePage(slug);
    if (!html) return reply.code(404).type('text/html; charset=utf-8').send(page('Not found', `${NAV}\n<h1>Not found</h1>`));
    return reply.type('text/html; charset=utf-8').send(html);
  });
  app.get('/data', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(dataPage('overview')),
  );
  app.get('/data/spain', async (_req, reply) => reply.type('text/html; charset=utf-8').send(dataPage('spain')));
  app.get('/data/eu', async (_req, reply) => reply.type('text/html; charset=utf-8').send(dataPage('eu')));
  for (const [slug, [title, body]] of Object.entries(TRUST_PAGES)) {
    app.get(`/${slug}`, async (_req, reply) => reply.type('text/html; charset=utf-8').send(page(title, `${NAV}\n<h1>${title}</h1>${body}<p><a href="/">Back to Licita</a></p>`)));
  }
  app.get('/pricing', async (_req, reply) => reply.type('text/html; charset=utf-8').send(pricingPage(config)));
  app.get('/llms.txt', async (_req, reply) => reply.type('text/plain; charset=utf-8').send(llmsTxt(config)));
  app.get('/robots.txt', async (_req, reply) =>
    reply.type('text/plain; charset=utf-8').send('User-agent: *\nAllow: /\n'),
  );
  app.get('/.well-known/mcp/server-card.json', async (_req, reply) =>
    reply.type('application/json; charset=utf-8').send(serverCard(config)),
  );
  registerDevFaucet(app, config);
}

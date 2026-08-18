// registerWeb(app, config) — discovery surfaces (SPEC §7): /, /docs, /pricing,
// /llms.txt, /robots.txt, the MCP server card and the dev faucet. Plain
// semantic HTML, no JS. Customer-facing brand is "Licita".
// /openapi.json is served by src/api/server.ts (W2); we only link to it.

import type { FastifyInstance } from 'fastify';
import { ENDPOINT_PRICES } from '../domain/types.js';
import type { AppConfig } from '../config.js';
import { registerDevFaucet } from '../pay/devProvider.js';

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

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Licita</title>
<style>${CSS}</style>
</head>
<body><main>
${body}
</main></body>
</html>`;
}

const NAV = `<nav class="muted"><a href="/">home</a><a href="/docs">docs</a><a href="/pricing">pricing</a><a href="/openapi.json">openapi.json</a><a href="/llms.txt">llms.txt</a><a href="/mcp">/mcp (MCP)</a></nav>`;

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
];

function homePage(config: AppConfig): string {
  return page(
    'Licita — public procurement intelligence for AI agents',
    `${NAV}
<h1>Public procurement intelligence for AI agents</h1>
<p class="muted">Licita answers the questions an agent needs to act on EU public procurement: what was
recently tendered, what is about to be re-tendered, which companies are positioned to win, and which
buyers are active — each answer with evidence, a confidence label and provenance.</p>

<h2>Try it — POST /v1/research</h2>
<p>One call turns a topic into a research brief: recent tenders, renewal signals, company opportunities
and active buyers, with a deterministic confidence (<code>low</code>/<code>medium</code>/<code>high</code>)
and per-finding evidence plus provenance.</p>
<pre>${RESEARCH_EXAMPLE}</pre>

<h2>Pay per call, machine-to-machine</h2>
<p>Pay per call with <strong>USDC via x402</strong> — no subscriptions, no signup, machine-to-machine.
An unpaid request returns <code>HTTP 402</code> with the exact payment requirement in a base64
<code>PAYMENT-REQUIRED</code> header; sign the EIP-3009 authorization and retry with
<code>PAYMENT-SIGNATURE</code>. The server verifies <em>and settles</em> before serving content. Start at
<code>GET /v1/pricing</code> for the full price ladder.</p>

<h2>How agents use it</h2>
<ul>
<li><strong>MCP</strong> — streamable-HTTP server at <code>/mcp</code> with 9 tools
(<code>${MCP_TOOLS.join('</code>, <code>')}</code>). Static server card:
<a href="/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a>.</li>
<li><strong>REST</strong> — priced per call, x402-compatible. Send the base64 payment payload as the
<code>PAYMENT-SIGNATURE</code> header (legacy v1 <code>X-PAYMENT</code> still accepted). Start at
<a href="/llms.txt">/llms.txt</a> → <a href="/openapi.json">/openapi.json</a> → <a href="/v1/pricing">/v1/pricing</a>.</li>
<li><strong>Humans</strong> — <a href="/docs">/docs</a> quickstart, <a href="/pricing">/pricing</a> ladder.</li>
</ul>

<h2>What questions it answers</h2>
<ul>
<li>Who bought what, who won, for how much, under which CPV codes.</li>
<li>Company track record: wins, total awarded value, top CPVs and buyers.</li>
<li>Buyer history: award history, supplier concentration, re-tender recurrence.</li>
<li>Upcoming renewals: contracts and frameworks likely to be re-tendered soon
(deterministic heuristic with per-signal evidence — not a probability model).</li>
</ul>

<h2>Payment mode</h2>
<p>Payments mode: <code>${config.paymentsMode}</code>. Priced endpoints return
<code>402</code> with a base64 <code>PAYMENT-REQUIRED</code> header describing the exact
USDC requirement (x402 v2): sign the EIP-3009 authorization and retry with
<code>PAYMENT-SIGNATURE</code>. In dev mode a token faucet is available at
<code>POST /v1/dev-faucet</code> (local development only — not in production).
See <a href="/docs">docs</a> for the full flow.</p>
${priceTable(config)}
<p class="muted">Provenance: every data row exposes <code>meta.provenance</code> as
<code>[{ source, source_ref, url }]</code> — the upstream source, its publication reference, and the
original notice where known. Nulls are never fabricated.</p>`,
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
transport URL and the 9 tools with descriptions and input schemas, for directory crawlers that prefer
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
  get_buyer_history, get_renewals, get_pricing, research.
- Static server card: /.well-known/mcp/server-card.json (identity, SSE URL, tool schemas).
- Every tool accepts optional payment_token — the base64 payment payload (same value a REST client
  sends as PAYMENT-SIGNATURE). Unpaid calls return {"payment_required": true, "price_usd": ...,
  "how_to_pay": {...}} with isError=false (parse as data, then pay + retry with payment_token).

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

const ID_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'integer', description: 'numeric id from search results' },
    payment_token: PAYMENT_TOKEN_SCHEMA,
  },
  required: ['id'],
} as const;

const PAGE_SHAPE = { page: { type: 'integer' }, size: { type: 'integer' } } as const;

const SERVER_CARD_TOOLS: Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> = [
  {
    name: 'search_tenders',
    description:
      'Search Spanish public-sector IT/software/cyber procurement: awards, tenders and contracts. Filters: q (full-text), cpv (prefix), buyer, company, region (NUTS), from/to (YYYY-MM-DD), type=award|tender|contract. Returns compact rows with ids for the other tools.',
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
      },
    },
  },
  {
    name: 'get_tender',
    description:
      'Full tender detail by id: buyer, CPVs, deadline, estimated value, all awards/lots with winners, plus provenance (source + TED url).',
    inputSchema: ID_INPUT_SCHEMA,
  },
  {
    name: 'get_company',
    description:
      "Company profile by id: name, country, NIF, aliases and source identifiers (cross-source identity), plus aggregate stats (wins, total awarded value, top CPVs, top buyers).",
    inputSchema: ID_INPUT_SCHEMA,
  },
  {
    name: 'get_company_awards',
    description: 'Paginated award history for a company: dates, lots, values, tender + buyer context.',
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
    inputSchema: ID_INPUT_SCHEMA,
  },
  {
    name: 'get_renewals',
    description:
      'Forecast signals for likely re-tenders: contracts/frameworks approaching renewal. Filters: cpv (prefix), buyer, window_months (default 12, max 36), min_confidence=low|medium|high.',
    inputSchema: {
      type: 'object',
      properties: {
        cpv: { type: 'string' },
        buyer: { type: 'string', minLength: 2, maxLength: 200 },
        window_months: { type: 'integer', minimum: 1, maximum: 36 },
        min_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        ...PAGE_SHAPE,
        payment_token: PAYMENT_TOKEN_SCHEMA,
      },
    },
  },
  {
    name: 'get_pricing',
    description: 'Machine-readable price ladder for all endpoints/tools plus the payment flow. Always free.',
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
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'topic to research (matches tender full-text, company/buyer names, renewal signals)' },
        limit: { type: 'integer', description: 'max findings to return' },
        payment_token: PAYMENT_TOKEN_SCHEMA,
      },
      required: ['query'],
    },
  },
];

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
  app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(homePage(config)));
  app.get('/docs', async (_req, reply) => reply.type('text/html; charset=utf-8').send(docsPage(config)));
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
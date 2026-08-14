// registerWeb(app, config) — discovery surfaces (SPEC §7): /, /docs, /pricing,
// /llms.txt, /robots.txt, plus the dev faucet. Plain semantic HTML, no JS.
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
<title>${title} — licita-agent</title>
<style>${CSS}</style>
</head>
<body><main>
${body}
</main></body>
</html>`;
}

const NAV = `<nav class="muted"><a href="/">home</a><a href="/docs">docs</a><a href="/pricing">pricing</a><a href="/openapi.json">openapi.json</a><a href="/llms.txt">llms.txt</a><a href="/mcp">/mcp (MCP)</a></nav>`;

const ENDPOINT_ROWS = Object.entries(ENDPOINT_PRICES)
  .map(
    ([endpoint, price]) =>
      `<tr><td><code>${endpoint}</code></td><td class="num">${price === '0.00' ? '<span class="tag">free</span>' : `$${price}`}</td></tr>`,
  )
  .join('\n');

const PRICE_TABLE = `<table>
<thead><tr><th>Endpoint</th><th>Price (USD / call)</th></tr></thead>
<tbody>
${ENDPOINT_ROWS}
</tbody>
</table>`;

function homePage(config: AppConfig): string {
  return page(
    'licita-agent',
    `${NAV}
<h1>licita-agent</h1>
<p class="muted">Agent-native procurement intelligence for the Spanish public sector
(IT / software / cybersecurity vertical, CPV 72*/48*), built from TED award notices
plus PLACSP (licitaciones + contratos menores) when PLACSP ingestion is enabled.</p>

<h2>What questions it answers</h2>
<ul>
<li>Who bought what, who won, for how much, under which CPV codes.</li>
<li>Company track record: wins, total awarded value, top CPVs and buyers.</li>
<li>Buyer history: award history, supplier concentration, re-tender recurrence.</li>
<li>Upcoming renewals: contracts and frameworks likely to be re-tendered soon
(deterministic heuristic with per-signal evidence — not a probability model).</li>
</ul>

<h2>How to consume it</h2>
<ul>
<li><strong>REST</strong> — priced per call, x402-compatible payment flow. Start at
<a href="/llms.txt">/llms.txt</a> → <a href="/openapi.json">/openapi.json</a> →
<a href="/v1/pricing">/v1/pricing</a>.</li>
<li><strong>MCP</strong> — streamable-HTTP endpoint at <code>/mcp</code> with tools
<code>search_tenders</code>, <code>get_tender</code>, <code>get_company</code>,
<code>get_company_awards</code>, <code>get_company_opportunities</code>,
<code>get_buyer_history</code>, <code>get_renewals</code>, <code>get_pricing</code>.</li>
<li><strong>Humans</strong> — <a href="/docs">/docs</a> quickstart, <a href="/pricing">/pricing</a> ladder.</li>
</ul>

<h2>Payment</h2>
<p>Payments mode: <code>${config.paymentsMode}</code>. Priced endpoints return
<code>402</code> with a base64 <code>PAYMENT-REQUIRED</code> header describing the exact
USDC requirement (x402 v2): sign the EIP-3009 authorization and retry with
<code>PAYMENT-SIGNATURE</code>. In dev mode a token faucet is available at
<code>POST /v1/dev-faucet</code> (local development only — not in production).
See <a href="/docs">docs</a> for the full flow.</p>
${PRICE_TABLE}`,
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
    'docs',
    `${NAV}
<h1>Docs — licita-agent</h1>

<h2>Discovery order (for agents)</h2>
<ol>
<li><code>GET /llms.txt</code> — concise machine-readable service description.</li>
<li><code>GET /openapi.json</code> — full REST schema.</li>
<li><code>GET /v1/pricing</code> — machine-readable price ladder + payment flow.</li>
<li>Call paid endpoints, paying per call (below), or use MCP at <code>/mcp</code>.</li>
</ol>

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
${PRICE_TABLE}
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
    'pricing',
    `${NAV}
<h1>Pricing</h1>
<p class="muted">Per-call prices in USD. Machine-readable version:
<a href="/v1/pricing">/v1/pricing</a>. Payments mode: <code>${config.paymentsMode}</code>.</p>
${PRICE_TABLE}
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
  return `# licita-agent

## Overview
Agent-native procurement intelligence for the Spanish public sector (IT / software / cybersecurity
vertical, CPV 72*/48*). Answers: who bought, who won, for how much, under which CPV codes, contract
windows, similar active tenders, and likely re-tender signals. Every data row carries provenance
(source + source_ref + upstream url). Nulls are never fabricated.

## Data
- Sources: TED (Tenders Electronic Daily) Search API v3 award notices — live, default. PLACSP
  sindicación (licitaciones + contratos menores, CODICE 3.2 over ATOM) when PLACSP ingestion is
  enabled (PLACSP_ENABLED=true).
- Provenance: every row exposes meta.provenance as [{ source, source_ref, url }]. source is "ted" or
  "placsp"; source_ref is the upstream publication reference; url is the original notice where known.
- License/attribution: PLACSP data is "datos abiertos" (reuse per datos.gob.es/avisolegal); TED data
  is subject to the TED's reuse terms. Attribute the source when republishing.

## Discovery
- /llms.txt (this file), /openapi.json (OpenAPI 3.1), /v1/pricing (machine-readable price ladder +
  payment flow), /docs (human docs), /pricing (price table), /mcp (MCP endpoint)

## Endpoints (base /v1; USD per call; JSON envelope {data, meta})
${lines}
- Common params: q (full-text), cpv (prefix), buyer, company, region (NUTS), from/to (YYYY-MM-DD),
  type=award|tender|contract, page, size (<=100)
- GET /v1/stats additionally requires header x-operator-key (operator only)

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

## Response envelope
- Success: {"data": ..., "meta": {"request_id", "price_usd", "paid", "provenance": [...]}}.
  meta.provenance is an array of { source, source_ref, url }.
- Error: {"error": {"code", "message", "hint"}}. codes: invalid_query | not_found |
  payment_required | rate_limited | internal. The hint is agent-actionable.
- Nulls are never fabricated; framework agreement values are ceiling amounts, not actual spend.

## MCP
- Streamable-HTTP at POST /mcp (transport is free; tools priced like their REST equivalents).
  Tools: search_tenders, get_tender, get_company, get_company_awards, get_company_opportunities,
  get_buyer_history, get_renewals, get_pricing.
- Every tool accepts optional payment_token — the base64 payment payload (same value a REST client
  sends as PAYMENT-SIGNATURE). Unpaid calls return {"payment_required": true, "price_usd": ...,
  "how_to_pay": {...}} with isError=false (parse as data, then pay + retry with payment_token).

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

/**
 * Register web discovery surfaces: GET /, /docs, /pricing, /llms.txt,
 * /robots.txt — all free — plus the dev faucet (POST /v1/dev-faucet).
 */
export function registerWeb(app: FastifyInstance, config: AppConfig): void {
  app.get('/', async (_req, reply) => reply.type('text/html; charset=utf-8').send(homePage(config)));
  app.get('/docs', async (_req, reply) => reply.type('text/html; charset=utf-8').send(docsPage(config)));
  app.get('/pricing', async (_req, reply) => reply.type('text/html; charset=utf-8').send(pricingPage(config)));
  app.get('/llms.txt', async (_req, reply) => reply.type('text/plain; charset=utf-8').send(llmsTxt(config)));
  app.get('/robots.txt', async (_req, reply) =>
    reply.type('text/plain; charset=utf-8').send('User-agent: *\nAllow: /\n'),
  );
  registerDevFaucet(app, config);
}

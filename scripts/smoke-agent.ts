// scripts/smoke-agent.ts — autonomous-agent acceptance test (SPEC §10).
//
// Simulates an external AI agent pointed only at a BASE_URL. It must be able
// to autonomously: discover the service (/llms.txt, /openapi.json), read the
// price ladder (/v1/pricing), hit a 402, mint a dev payment token via the
// faucet, retry with X-PAYMENT, drill from search results into tender/company/
// buyer detail, pull the renewals forecast, verify replay protection, and use
// the MCP endpoint (tools/list + get_pricing).
//
// Dependency-free (global fetch only). Exit code 0 iff ALL steps pass.
//
// Usage:
//   npx tsx scripts/smoke-agent.ts [BASE_URL]
//   BASE_URL=http://127.0.0.1:3000 npx tsx scripts/smoke-agent.ts

const BASE_URL = (
  process.argv[2] ??
  process.env.BASE_URL ??
  'http://127.0.0.1:3000'
).replace(/\/+$/, '');

// --- tiny framework ------------------------------------------------------------

interface StepResult {
  name: string;
  ok: boolean;
  detail?: string;
}
const results: StepResult[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    record(name, true);
    return true;
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
    return false;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// --- http helpers ---------------------------------------------------------------

type Json = Record<string, unknown>;

async function getJson(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const body = (await res.json().catch(() => null)) as Json | null;
  return { status: res.status, body };
}

async function postJson(path: string, payload: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as Json | null;
  return { status: res.status, body };
}

/** Mint a dev payment token for an endpoint key via the faucet. */
async function faucet(endpoint: string): Promise<string> {
  const { status, body } = await postJson('/v1/dev-faucet', { endpoint });
  assert(status === 200, `faucet for "${endpoint}" returned HTTP ${status}: ${JSON.stringify(body)}`);
  const token = (body?.token ?? body?.proof) as string | undefined;
  assert(typeof token === 'string' && token.includes('.'), `faucet response missing token: ${JSON.stringify(body)}`);
  return token;
}

/** Pay-then-call: mint a fresh token for endpointKey, GET path with X-PAYMENT. */
async function paidGet(endpointKey: string, path: string) {
  const token = await faucet(endpointKey);
  return getJson(path, { 'X-PAYMENT': token });
}

function assertEnvelope(body: Json | null, what: string): { data: unknown; meta: Json } {
  assert(body && typeof body === 'object', `${what}: non-JSON body`);
  assert('data' in body, `${what}: envelope missing "data"`);
  const meta = body.meta as Json | undefined;
  assert(meta && typeof meta === 'object', `${what}: envelope missing "meta"`);
  for (const k of ['request_id', 'price_usd', 'paid', 'provenance']) {
    assert(k in meta, `${what}: meta missing "${k}"`);
  }
  assert(Array.isArray(meta.provenance), `${what}: meta.provenance not an array`);
  return { data: body.data, meta };
}

/** Parse the first SSE `data:` line of an MCP streamable-HTTP response. */
function parseSseData(raw: string): Json {
  const line = raw.split('\n').find((l) => l.startsWith('data: '));
  assert(line, `no SSE data line in MCP response: ${raw.slice(0, 200)}`);
  return JSON.parse(line.slice('data: '.length)) as Json;
}

async function mcpRpc(id: number, method: string, params: unknown): Promise<Json> {
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  assert(res.status === 200, `MCP ${method} returned HTTP ${res.status}`);
  const raw = await res.text();
  const msg = parseSseData(raw);
  assert(msg.jsonrpc === '2.0' && msg.id === id, `MCP ${method}: malformed JSON-RPC reply`);
  assert(!msg.error, `MCP ${method} error: ${JSON.stringify(msg.error)}`);
  return msg.result as Json;
}

// --- the agent ------------------------------------------------------------------

async function main(): Promise<number> {
  console.log(`smoke-agent: BASE_URL=${BASE_URL}`);
  console.log('---');

  // State shared across steps.
  let searchResults: Array<Json> = [];
  let tenderId: number | null = null;
  let companyId: number | null = null;
  let buyerId: number | null = null;
  let consumedSearchToken = '';

  // 1. Discovery: llms.txt ------------------------------------------------------
  await step('1. GET /llms.txt — discover service + payment instructions', async () => {
    const res = await fetch(`${BASE_URL}/llms.txt`);
    assert(res.status === 200, `HTTP ${res.status}`);
    const text = await res.text();
    for (const needle of [
      'licita',
      'GET /v1/search',
      '/v1/renewals',
      'dev-faucet',
      'X-PAYMENT',
      '/mcp',
      'openapi.json',
    ]) {
      assert(text.includes(needle), `llms.txt missing "${needle}"`);
    }
    console.log(`     discovered ${(text.match(/GET \/v1\//g) ?? []).length} priced/free endpoints listed`);
  });

  // 2. OpenAPI ------------------------------------------------------------------
  await step('2. GET /openapi.json — assert all v1 paths exist', async () => {
    const { status, body } = await getJson('/openapi.json');
    assert(status === 200, `HTTP ${status}`);
    const paths = Object.keys((body?.paths as Json) ?? {});
    for (const p of [
      '/v1/search',
      '/v1/tenders/{id}',
      '/v1/companies/{id}',
      '/v1/companies/{id}/awards',
      '/v1/companies/{id}/opportunities',
      '/v1/buyers/{id}/history',
      '/v1/renewals',
      '/v1/pricing',
    ]) {
      assert(paths.includes(p), `openapi paths missing "${p}" (have: ${paths.join(', ')})`);
    }
    console.log(`     openapi lists ${paths.length} paths`);
  });

  // 3. Price ladder ---------------------------------------------------------------
  await step('3. GET /v1/pricing — parse price ladder (free)', async () => {
    const { status, body } = await getJson('/v1/pricing');
    assert(status === 200, `HTTP ${status}`);
    const { data } = assertEnvelope(body, 'pricing');
    const d = data as Json;
    assert(Array.isArray(d.endpoints), 'pricing.data.endpoints not an array');
    const prices = new Map(
      (d.endpoints as Array<{ endpoint: string; price_usd: string }>).map((e) => [
        e.endpoint,
        e.price_usd,
      ]),
    );
    assert(prices.get('GET /v1/search') === '0.02', 'search price != 0.02');
    assert(prices.get('GET /v1/renewals') === '0.25', 'renewals price != 0.25');
    assert(prices.get('GET /v1/pricing') === '0.00', 'pricing should be free');
    assert(d.payment_flow && typeof d.payment_flow === 'object', 'missing payment_flow');
    console.log(`     ladder: ${[...prices.entries()].map(([k, v]) => `${k}=$${v}`).join(' ')}`);
  });

  // 4. Unpaid search → 402 --------------------------------------------------------
  await step('4. GET /v1/search without payment → HTTP 402 (x402 body)', async () => {
    const { status, body } = await getJson('/v1/search?cpv=72&region=ES&type=award');
    assert(status === 402, `expected 402, got HTTP ${status}`);
    assert(body?.x402Version === 1, '402 body missing x402Version=1');
    const accepts = body?.accepts as Array<Json> | undefined;
    assert(Array.isArray(accepts) && accepts.length > 0, '402 body missing accepts[]');
    const a0 = accepts[0];
    assert(a0.amount === '0.02', `accepts[0].amount=${a0.amount}, expected 0.02`);
    assert(a0.resource === 'GET /v1/search', `accepts[0].resource=${a0.resource}`);
    assert(typeof body?.hint === 'string' && (body.hint as string).includes('dev-faucet'), 'hint missing faucet instruction');
    const err = body?.error as Json | undefined;
    assert(err?.code === 'payment_required', `error.code=${err?.code}`);
    console.log(`     402: pay $${a0.amount} to ${a0.payTo} for "${a0.resource}"`);
  });

  // 5+6. Faucet → paid search ------------------------------------------------------
  await step('5-6. POST /v1/dev-faucet → retry search with X-PAYMENT → 200 envelope', async () => {
    const token = await faucet('GET /v1/search');
    consumedSearchToken = token;
    const { status, body } = await getJson('/v1/search?cpv=72&region=ES&type=award', {
      'X-PAYMENT': token,
    });
    assert(status === 200, `paid search returned HTTP ${status}: ${JSON.stringify(body)?.slice(0, 300)}`);
    const { data, meta } = assertEnvelope(body, 'paid search');
    assert(meta.paid === true, 'meta.paid !== true');
    assert(meta.price_usd === '0.02', `meta.price_usd=${meta.price_usd}`);
    assert(Array.isArray(data), 'search data not an array');
    searchResults = data as Array<Json>;
    assert(searchResults.length > 0, 'search returned 0 results (is the DB ingested? run scripts/ingest-once.ts)');
    for (const row of searchResults.slice(0, 3)) {
      console.log(
        `     hit: [${row.kind}] #${row.id} ${String(row.title ?? row.source_ref).slice(0, 90)}` +
          ` (buyer=${(row.buyer as Json | null)?.name ?? 'n/a'}, company=${(row.company as Json | null)?.name ?? 'n/a'})`,
      );
    }
    // pick ids for drill-down
    const withCompany = searchResults.find((r) => (r.company as Json | null)?.id != null);
    const withBuyer = searchResults.find((r) => (r.buyer as Json | null)?.id != null);
    companyId = withCompany ? Number((withCompany.company as Json).id) : null;
    buyerId = withBuyer ? Number((withBuyer.buyer as Json).id) : null;
  });

  // 7. Tender drill-down ------------------------------------------------------------
  await step('7. GET /v1/tenders/:id (paid) — full tender + provenance', async () => {
    assert(searchResults.length > 0, 'no search results to drill into');
    // tender drill-down: for award rows the tender id is not exposed; use the
    // tender-type search to get a tender id directly.
    const tRes = await paidGet('GET /v1/search', '/v1/search?cpv=72&type=tender&size=5');
    assert(tRes.status === 200, `tender search HTTP ${tRes.status}`);
    const tenders = tRes.body?.data as Array<Json>;
    assert(Array.isArray(tenders) && tenders.length > 0, 'no tender rows found');
    tenderId = Number(tenders[0].id);
    const { status, body } = await paidGet('GET /v1/tenders/:id', `/v1/tenders/${tenderId}`);
    assert(status === 200, `tender detail HTTP ${status}: ${JSON.stringify(body)?.slice(0, 300)}`);
    const { data, meta } = assertEnvelope(body, 'tender detail');
    const d = data as Json;
    assert(Number(d.id) === tenderId, 'tender id mismatch');
    assert(Array.isArray(d.awards), 'tender.awards not an array');
    const prov = meta.provenance as Array<Json>;
    assert(prov.length > 0 && prov[0].source === 'ted', 'tender provenance missing ted source');
    console.log(
      `     tender #${tenderId} "${String(d.title ?? '').slice(0, 80)}" awards=${(d.awards as unknown[]).length} ref=${d.source_ref}`,
    );
  });

  // 8a. Company profile + awards ------------------------------------------------------
  await step('8a. GET /v1/companies/:id + /awards (paid each)', async () => {
    assert(companyId !== null, 'no winner company id in search results — skipping drill-down is not allowed');
    const prof = await paidGet('GET /v1/companies/:id', `/v1/companies/${companyId}`);
    assert(prof.status === 200, `company profile HTTP ${prof.status}`);
    const { data: cd, meta: cm } = assertEnvelope(prof.body, 'company profile');
    const stats = (cd as Json).stats as Json;
    assert(stats && typeof stats.wins === 'number', 'company stats.wins missing');
    assert((cm.provenance as unknown[]).length > 0, 'company provenance empty');
    console.log(
      `     company #${companyId} "${(cd as Json).name}" wins=${stats.wins} total=${stats.total_awarded_value}`,
    );

    const aw = await paidGet('GET /v1/companies/:id/awards', `/v1/companies/${companyId}/awards?size=5`);
    assert(aw.status === 200, `company awards HTTP ${aw.status}`);
    const { data: ad, meta: am } = assertEnvelope(aw.body, 'company awards');
    assert(Array.isArray(ad), 'company awards data not an array');
    assert((ad as unknown[]).length > 0, 'company has 0 awards (unexpected — it won one)');
    console.log(`     awards returned=${(ad as unknown[]).length} total=${am.total}`);
  });

  // 8b. Buyer history ------------------------------------------------------------------
  await step('8b. GET /v1/buyers/:id/history (paid)', async () => {
    assert(buyerId !== null, 'no buyer id in search results');
    const { status, body } = await paidGet('GET /v1/buyers/:id/history', `/v1/buyers/${buyerId}/history`);
    assert(status === 200, `buyer history HTTP ${status}`);
    const { data, meta } = assertEnvelope(body, 'buyer history');
    const d = data as Json;
    assert(Array.isArray(d.awards), 'buyer.awards not an array');
    assert('supplier_concentration' in d, 'buyer.supplier_concentration missing');
    assert((meta.provenance as unknown[]).length > 0, 'buyer provenance empty');
    console.log(`     buyer #${buyerId} "${d.name}" awards_total=${d.awards_total}`);
  });

  // 9. Renewals forecast ---------------------------------------------------------------
  await step('9. GET /v1/renewals?window_months=12 (paid, $0.25) — forecast signals', async () => {
    const { status, body } = await paidGet('GET /v1/renewals', '/v1/renewals?window_months=12&cpv=72');
    assert(status === 200, `renewals HTTP ${status}`);
    const { data, meta } = assertEnvelope(body, 'renewals');
    assert(meta.price_usd === '0.25', `renewals price_usd=${meta.price_usd}`);
    assert(Array.isArray(data), 'renewals data not an array');
    const rows = data as Array<Json>;
    assert(rows.length > 0, 'no forecast signals — recompute should have produced some');
    for (const r of rows.slice(0, 3)) {
      assert(
        ['duration_expiry', 'framework_expiry', 'recurrence'].includes(String(r.signal_type)),
        `unexpected signal_type ${r.signal_type}`,
      );
      console.log(
        `     signal: ${r.signal_type} cpv=${r.cpv} buyer=${(r.buyer as Json | null)?.name ?? 'n/a'}` +
          ` window=${r.window_start}..${r.window_end} conf=${r.confidence}`,
      );
    }
    // provenance: renewals rows derive from ingested contracts; meta.provenance
    // is [] when no single source_ref applies, so assert the envelope field only.
  });

  // 10. Replay protection ----------------------------------------------------------------
  await step('10. Replay same X-PAYMENT token → 402 reason "replay"', async () => {
    assert(consumedSearchToken, 'no consumed token from step 6');
    const { status, body } = await getJson('/v1/search?cpv=72&type=award', {
      'X-PAYMENT': consumedSearchToken,
    });
    assert(status === 402, `replay returned HTTP ${status}, expected 402`);
    const msg = String((body?.error as Json | undefined)?.message ?? '');
    assert(/replay/i.test(msg), `expected replay reason, got: ${msg}`);
    console.log(`     replay rejected: ${msg.slice(0, 80)}`);
  });

  // 11. MCP ------------------------------------------------------------------------------
  await step('11. MCP POST /mcp — tools/list (8 tools) + tools/call get_pricing', async () => {
    const listed = await mcpRpc(1, 'tools/list', {});
    const tools = (listed.tools as Array<{ name: string }>).map((t) => t.name);
    const expected = [
      'search_tenders',
      'get_tender',
      'get_company',
      'get_company_awards',
      'get_company_opportunities',
      'get_buyer_history',
      'get_renewals',
      'get_pricing',
    ];
    for (const name of expected) {
      assert(tools.includes(name), `tools/list missing "${name}" (have: ${tools.join(', ')})`);
    }
    console.log(`     tools: ${tools.join(', ')}`);

    const called = await mcpRpc(2, 'tools/call', { name: 'get_pricing', arguments: {} });
    const content = called.content as Array<{ type: string; text: string }>;
    assert(Array.isArray(content) && content[0]?.type === 'text', 'get_pricing content missing');
    const parsed = JSON.parse(content[0].text) as Json;
    const data = parsed.data as Json;
    assert(Array.isArray(data.endpoints), 'get_pricing endpoints missing');
    console.log(`     get_pricing via MCP: ${(data.endpoints as unknown[]).length} endpoints, mode=${data.payments_mode}`);
  });

  // --- summary ---------------------------------------------------------------------------
  console.log('---');
  const failed = results.filter((r) => !r.ok);
  console.log(`smoke-agent: ${results.length - failed.length}/${results.length} steps passed against ${BASE_URL}`);
  if (failed.length > 0) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    return 1;
  }
  console.log('smoke-agent: ALL STEPS PASSED');
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`smoke-agent: fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

// scripts/smoke-agent.ts — autonomous-agent acceptance test (SPEC §10).
//
// Simulates an external AI agent pointed only at a BASE_URL. It must be able
// to autonomously: discover the service (/llms.txt, /openapi.json), read the
// price ladder (/v1/pricing), hit a 402, pay, retry, drill from search results
// into tender/company/buyer detail, pull the renewals forecast, verify replay
// protection, and use the MCP endpoint (tools/list + get_pricing).
//
// Payment modes (SMOKE_PAY_MODE):
//   dev  (default): mint HMAC tokens via POST /v1/dev-faucet and retry with
//        the X-PAYMENT header — the local-development flow. Needs no wallet.
//   x402: REAL x402 v2 payments. Reads the base64 PAYMENT-REQUIRED header from
//        the 402, signs an EIP-3009 transferWithAuthorization of USDC via the
//        official @x402 client (+ viem), and retries with PAYMENT-SIGNATURE.
//        Requires SMOKE_WALLET_PRIVATE_KEY (testnet throwaway wallet funded
//        with USDC on Base Sepolia); each paid step settles real testnet
//        payment through the server's facilitator.
//
// Usage:
//   npx tsx scripts/smoke-agent.ts [BASE_URL]
//   BASE_URL=http://127.0.0.1:3000 npm run smoke
//   SMOKE_PAY_MODE=x402 SMOKE_WALLET_PRIVATE_KEY=0x... BASE_URL=... npm run smoke
//
// Exit codes: 0 = all steps passed, 1 = a step failed, 2 = missing required
// x402 configuration (SMOKE_WALLET_PRIVATE_KEY).

import { x402Client } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { isPaymentPayloadV2, isPaymentRequired, type PaymentRequired } from '@x402/core/schemas';
import { getDefaultAsset } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http as viemHttp, parseAbi } from 'viem';
import { base, baseSepolia, type Chain } from 'viem/chains';

const BASE_URL = (
  process.argv[2] ??
  process.env.BASE_URL ??
  'http://127.0.0.1:3000'
).replace(/\/+$/, '');

const PAY_MODE = process.env.SMOKE_PAY_MODE === 'x402' ? 'x402' : 'dev';
const RAW_WALLET_KEY = (process.env.SMOKE_WALLET_PRIVATE_KEY ?? '').trim();
const WALLET_KEY: `0x${string}` | null = RAW_WALLET_KEY
  ? RAW_WALLET_KEY.startsWith('0x')
    ? (RAW_WALLET_KEY as `0x${string}`)
    : (`0x${RAW_WALLET_KEY}` as `0x${string}`)
  : null;

/** Public RPCs used only for the pre-flight USDC balance check (best-effort). */
const RPC_BY_NETWORK: Record<string, string> = {
  'eip155:84532': 'https://sepolia.base.org',
  'eip155:8453': 'https://mainnet.base.org',
};
const CHAIN_BY_NETWORK: Record<string, Chain> = {
  'eip155:84532': baseSepolia,
  'eip155:8453': base,
};
const USDC_BALANCE_ABI = parseAbi(['function balanceOf(address account) external view returns (uint256)']);

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

/** Mint a dev payment token for an endpoint key via the faucet (dev mode only). */
async function faucet(endpoint: string): Promise<string> {
  const { status, body } = await postJson('/v1/dev-faucet', { endpoint });
  assert(status === 200, `faucet for "${endpoint}" returned HTTP ${status}: ${JSON.stringify(body)}`);
  const token = (body?.token ?? body?.proof) as string | undefined;
  assert(typeof token === 'string' && token.includes('.'), `faucet response missing token: ${JSON.stringify(body)}`);
  return token;
}

// --- x402 v2 client helpers ------------------------------------------------------

interface X402PayClient {
  account: ReturnType<typeof privateKeyToAccount>;
  client: x402Client;
}

/** The x402 v2 payment client; initialized at startup in x402 mode only. */
let payClient: X402PayClient | null = null;

type PayloadRequired = Parameters<x402Client['createPaymentPayload']>[0];

/**
 * Validate an x402 v2 402 response: reads the base64 PAYMENT-REQUIRED header,
 * decodes it and confirms it is a valid x402 requirement.
 */
function assert402(res: Response, what: string): PayloadRequired {
  assert(res.status === 402, `${what}: expected HTTP 402 to get payment requirements, got ${res.status}`);
  const raw = res.headers.get('payment-required');
  assert(raw && raw.length > 0, `${what}: 402 missing the PAYMENT-REQUIRED header (x402 v2)`);
  let decoded: unknown;
  try {
    decoded = decodePaymentRequiredHeader(raw);
  } catch (err) {
    throw new Error(
      `${what}: PAYMENT-REQUIRED header did not decode: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  assert(isPaymentRequired(decoded), `${what}: PAYMENT-REQUIRED header is not a valid x402 requirement`);
  // The decoder emits a lenient merged V1/V2 shape; isPaymentRequired already
  // narrowed it at runtime. The client defines its own PaymentRequired shape
  // (top-level `resource`, `x402Version: number`), so cast to the exact type
  // createPaymentPayload accepts instead of the schemas union.
  return decoded as PayloadRequired;
}

/**
 * Pay-then-call in x402 mode: hit the endpoint unpaid → 402 → read the
 * PAYMENT-REQUIRED requirement → sign the EIP-3009 transferWithAuthorization
 * via the official x402 client → retry with PAYMENT-SIGNATURE. Each call pays
 * and settles a fresh (testnet) payment through the server's facilitator.
 */
async function x402PaidGet(
  endpointKey: string,
  path: string,
): Promise<{ status: number; body: Json | null; proof: string }> {
  assert(payClient, 'x402 payment client is not initialized');
  const first = await fetch(`${BASE_URL}${path}`);
  const paymentRequired = assert402(first, `pay ${endpointKey}`);
  const payload = await payClient.client.createPaymentPayload(paymentRequired);
  assert(isPaymentPayloadV2(payload), `${endpointKey}: built payment payload failed x402 v2 shape validation`);
  const proof = encodePaymentSignatureHeader(payload);
  const retry = await fetch(`${BASE_URL}${path}`, { headers: { 'PAYMENT-SIGNATURE': proof } });
  const body = (await retry.json().catch(() => null)) as Json | null;
  if (retry.status === 402) {
    const msg = String((body?.error as Json | undefined)?.message ?? '');
    if (/insufficient/i.test(msg)) {
      throw new Error(
        `${endpointKey}: the facilitator rejected the payment with insufficient_funds. ` +
          `Wallet ${payClient.account.address} has insufficient USDC on ` +
          `${paymentRequired.accepts[0].network} for "${endpointKey}". Fund it on the testnet ` +
          `(see README "Run the agent smoke test") and re-run.`,
      );
    }
  }
  return { status: retry.status, body, proof };
}

/** Pay-then-call wrapper: dev → faucet token + X-PAYMENT; x402 → real flow. */
async function paidGet(endpointKey: string, path: string) {
  if (PAY_MODE === 'x402') return x402PaidGet(endpointKey, path);
  const token = await faucet(endpointKey);
  const res = await getJson(path, { 'X-PAYMENT': token });
  return { status: res.status, body: res.body, proof: token };
}

/**
 * Best-effort pre-flight balance check (warns only, never fails the run): if a
 * public RPC is known for the network, read the USDC balance of the payer
 * wallet. A zero balance is a warning — the run still attempts and will surface
 * the facilitator's insufficient_funds rejection as a clear failure.
 */
async function checkUsdcBalance(network: string, asset: string, address: `0x${string}`): Promise<void> {
  const rpcUrl = process.env.SMOKE_RPC_URL?.trim() || RPC_BY_NETWORK[network];
  if (!rpcUrl) {
    console.log(`     (no public RPC mapped for ${network}; set SMOKE_RPC_URL to enable the pre-flight balance check)`);
    return;
  }
  const chain = CHAIN_BY_NETWORK[network] ?? baseSepolia;
  let decimals = 6;
  try {
    decimals = getDefaultAsset(network as `${string}:${string}`).decimals;
  } catch {
    // custom network: assume USDC 6 decimals
  }
  try {
    const publicClient = createPublicClient({ chain, transport: viemHttp(rpcUrl) });
    const bal = (await publicClient.readContract({
      address: asset as `0x${string}`,
      abi: USDC_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [address],
    })) as bigint;
    const usdc = Number(bal) / 10 ** decimals;
    if (bal === 0n) {
      console.log(
        `     WARNING: wallet ${address} holds 0 USDC on ${network} — the first paid step will be ` +
          `rejected with insufficient_funds. Fund it and re-run.`,
      );
    } else {
      console.log(`     pre-flight: wallet holds ${usdc.toFixed(decimals)} USDC on ${network}`);
    }
  } catch (err) {
    console.log(
      `     (pre-flight balance check failed — continuing: ${err instanceof Error ? err.message : String(err)})`,
    );
  }
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
  console.log(`smoke-agent: BASE_URL=${BASE_URL} SMOKE_PAY_MODE=${PAY_MODE}`);
  console.log('---');

  // x402 mode needs a funded testnet wallet; refuse to run without one.
  if (PAY_MODE === 'x402' && !WALLET_KEY) {
    console.error('smoke-agent: SMOKE_PAY_MODE=x402 requires SMOKE_WALLET_PRIVATE_KEY.');
    console.error('A real x402 smoke signs and settles testnet USDC payments, so the private key of a');
    console.error('funded Base Sepolia wallet is required (testnet throwaway only — never a production key).');
    console.error('Put it in your local .env only, e.g. SMOKE_WALLET_PRIVATE_KEY=0x<64 hex>. See README.');
    return 2;
  }

  if (PAY_MODE === 'x402' && WALLET_KEY) {
    const account = privateKeyToAccount(WALLET_KEY);
    const client = new x402Client();
    registerExactEvmScheme(client, { signer: account });
    payClient = { account, client };
    console.log(`     x402 payer wallet: ${account.address}`);
  }

  // State shared across steps.
  let searchResults: Array<Json> = [];
  let tenderId: number | null = null;
  let companyId: number | null = null;
  let buyerId: number | null = null;
  let consumedProof = '';

  // 1. Discovery: llms.txt ------------------------------------------------------
  await step('1. GET /llms.txt — discover service + payment instructions', async () => {
    const res = await fetch(`${BASE_URL}/llms.txt`);
    assert(res.status === 200, `HTTP ${res.status}`);
    const text = await res.text();
    for (const needle of [
      'licita',
      'GET /v1/search',
      '/v1/renewals',
      'PAYMENT-REQUIRED',
      'PAYMENT-SIGNATURE',
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
    const schemes = (body?.components as Json | undefined)?.securitySchemes as Json | undefined;
    assert(
      schemes && (schemes.paymentSignature as { name?: string } | undefined)?.name === 'PAYMENT-SIGNATURE',
      'openapi missing the PAYMENT-SIGNATURE security scheme',
    );
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
    const flow = d.payment_flow as Json | undefined;
    assert(flow && typeof flow === 'object', 'missing payment_flow');
    assert((flow.required_header as string) === 'PAYMENT-REQUIRED', 'payment_flow.required_header != PAYMENT-REQUIRED');
    assert((flow.signature_header as string) === 'PAYMENT-SIGNATURE', 'payment_flow.signature_header != PAYMENT-SIGNATURE');
    assert(
      (flow.steps as string[]).join(' ').includes('PAYMENT-SIGNATURE') &&
        (flow.steps as string[]).join(' ').includes('PAYMENT-REQUIRED'),
      'payment_flow.steps do not describe the v2 headers',
    );
    console.log(`     ladder: ${[...prices.entries()].map(([k, v]) => `${k}=$${v}`).join(' ')}`);
  });

  // 4. Unpaid search → 402 --------------------------------------------------------
  await step('4. GET /v1/search without payment → HTTP 402 (x402 body)', async () => {
    const res = await fetch(`${BASE_URL}/v1/search?cpv=72&region=ES&type=award`);
    assert(res.status === 402, `expected 402, got HTTP ${res.status}`);
    if (PAY_MODE === 'x402') {
      assert(payClient, 'x402 mode but payment client is not initialized');
      const pr = assert402(res, 'unpaid search');
      assert(pr.x402Version === 2, `402 x402Version=${pr.x402Version}, expected 2`);
      const a0 = pr.accepts[0];
      assert(a0.scheme === 'exact', `accepts[0].scheme=${a0.scheme}`);
      assert(/^eip155:/.test(a0.network), `accepts[0].network=${a0.network}, expected CAIP-2 eip155:*`);
      assert(/^0x[a-fA-F0-9]{40}$/.test(a0.asset), 'accepts[0].asset not a token contract address');
      assert(/^0x[a-fA-F0-9]{40}$/.test(a0.payTo), 'accepts[0].payTo not an address');
      assert(Number(a0.amount) > 0, `accepts[0].amount=${a0.amount}, expected base units > 0`);
      const body = (await res.json().catch(() => null)) as Json | null;
      const err = body?.error as Json | undefined;
      assert(err?.code === 'payment_required', `error.code=${err?.code}`);
      await checkUsdcBalance(a0.network, a0.asset, payClient.account.address);
      console.log(`     402 v2: pay ${a0.amount} base units of USDC on ${a0.network} to ${a0.payTo}`);
    } else {
      const body = (await res.json().catch(() => null)) as Json | null;
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
    }
  });

  // 5+6. Pay → paid search --------------------------------------------------------
  await step('5-6. pay search (faucet|x402) → retry → 200 envelope', async () => {
    const { status, body, proof } = await paidGet('GET /v1/search', '/v1/search?cpv=72&region=ES&type=award');
    consumedProof = proof;
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
    // Award rows expose their tender via tender_id (added in P0.5) — no second
    // tender-type search needed.
    const award = searchResults.find((r) => r.tender_id != null);
    assert(award, 'no search result exposes a tender_id (award rows must carry it)');
    tenderId = Number(award.tender_id);
    const { status, body } = await paidGet('GET /v1/tenders/:id', `/v1/tenders/${tenderId}`);
    assert(status === 200, `tender detail HTTP ${status}: ${JSON.stringify(body)?.slice(0, 300)}`);
    const { data, meta } = assertEnvelope(body, 'tender detail');
    const d = data as Json;
    assert(Number(d.id) === tenderId, 'tender id mismatch');
    assert(Array.isArray(d.awards), 'tender.awards not an array');
    const prov = meta.provenance as Array<Json>;
    const src = prov[0]?.source as string | undefined;
    assert(prov.length > 0, 'tender provenance empty');
    assert(src === 'ted' || src === 'placsp', `tender provenance source=${src}, expected ted or placsp`);
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
    // P0.5 honesty framing: meta.methodology + confidence_scale.
    assert(
      typeof meta.methodology === 'string' && /deterministic heuristic/i.test(String(meta.methodology)),
      'renewals meta.methodology missing the honest "deterministic heuristic" framing',
    );
    assert(
      JSON.stringify(meta.confidence_scale) === JSON.stringify(['low', 'medium', 'high']),
      `renewals meta.confidence_scale=${JSON.stringify(meta.confidence_scale)}, expected [low,medium,high]`,
    );
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
  await step('10. Replay same payment proof → 402 rejected', async () => {
    assert(consumedProof, 'no consumed proof from step 6');
    if (PAY_MODE === 'x402') {
      // The server's unique payload-hash replay check (or the on-chain nonce)
      // rejects the reused proof regardless of which layer fires first.
      const res = await fetch(`${BASE_URL}/v1/search?cpv=72&type=award`, {
        headers: { 'PAYMENT-SIGNATURE': consumedProof },
      });
      assert(res.status === 402, `replay returned HTTP ${res.status}, expected 402`);
      const body = (await res.json().catch(() => null)) as Json | null;
      const err = body?.error as Json | undefined;
      assert(err?.code === 'payment_required', `expected payment_required, got: ${JSON.stringify(err)}`);
      console.log(`     replay rejected (reason: ${String(err?.message ?? '').slice(0, 80)})`);
      return;
    }
    const { status, body } = await getJson('/v1/search?cpv=72&type=award', {
      'X-PAYMENT': consumedProof,
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
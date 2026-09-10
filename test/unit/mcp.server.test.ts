// MCP server: tool registration, unpaid → payment_required (isError=false),
// paid → data envelope, get_pricing free; plus an HTTP-level inject test of
// the streamable-HTTP mount at /mcp.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { newDb } from 'pg-mem';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Db } from '../../src/db/client.js';
import type { AppConfig } from '../../src/config.js';
import { buildMcpServer, mountMcp } from '../../src/mcp/server.js';
import { DevPaymentProvider } from '../../src/pay/devProvider.js';
import { X402PaymentProvider } from '../../src/pay/x402Provider.js';
import { initPayments, resetPayments } from '../../src/pay/middleware.js';
import { ENDPOINT_PRICES } from '../../src/domain/types.js';
import { makeTestConfig } from './testconfig.js';
import { TEST_SCHEMA_SQL } from './testdb.js';
import { generateKey, hashKey, hashKeyLog } from '../../src/pay/keys.js';

const SECRET = 'mcp-test-secret';

const config: AppConfig = makeTestConfig({ payHmacSecret: SECRET, operatorKey: 'op' });

const PAYMENTS_DDL = `
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint,
  endpoint text NOT NULL, amount_usd numeric NOT NULL, provider text NOT NULL,
  proof text UNIQUE NOT NULL, status text NOT NULL, created_at timestamptz DEFAULT now(),
  payer_address text, tx_hash text, network text
);
`;

const TENDER_ROW = {
  id: 7,
  source_ref: '123-2026',
  source_code: 'ted',
  notice_type: 'can-standard',
  publication_date: '2026-01-15',
  title: 'Suministro de software',
  description: null,
  cpv_main: '72000000',
  cpv_all: ['72000000'],
  procedure_type: 'open',
  deadline: null,
  estimated_value: '100000',
  currency: 'EUR',
  nuts: 'ES61',
  url: null,
  b_id: 3,
  b_name: 'Ministerio de Prueba',
  b_country: 'ES',
  b_nuts: 'ES61',
  b_org_type: null,
};

const COMPANY_ROW = {
  id: 7,
  source_ref: 'acme s.a.|ESP',
  source_code: 'ted',
  name: 'ACME S.A.',
  country: 'ESP',
  nif: 'A12345674',
};

/**
 * Fake db: real pg-mem only for the payments table (replay protection);
 * canned rows for the data queries the tools run.
 */
function makeDb(): { db: Db; payments: Db } {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const payments = new Pool() as unknown as Db;
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      const t = text.replace(/\s+/g, ' ');
      if (t.includes('INSERT INTO payments')) return payments.query(text, values);
      if (t.includes('FROM tenders t JOIN sources s')) return { rows: [TENDER_ROW] };
      if (t.includes('FROM companies c JOIN sources s'))
        return { rows: values[0] === 7 ? [COMPANY_ROW] : [] };
      if (t.includes('FROM awards a WHERE a.winner_company_id'))
        return { rows: [{ wins: 1, total_value: '1000' }] };
      if (t.includes('FROM awards a LEFT JOIN companies c ON c.id = a.winner_company_id WHERE a.tender_id'))
        return { rows: [] };
      return { rows: [] };
    },
  } as unknown as Db;
  return { db, payments };
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function parseText(result: ToolCallResult): Record<string, unknown> {
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('MCP tools (in-process client)', () => {
  let client: Client;
  let provider: DevPaymentProvider;

  beforeAll(async () => {
    const { db, payments } = makeDb();
    await payments.query(PAYMENTS_DDL);
    provider = new DevPaymentProvider({
      secret: SECRET,
      db,
      prices: { 'POST /v1/research': '0.50' },
    });
    const server = buildMcpServer(provider, db, config);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
  });

  it('lists exactly the 11 SPEC tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'billing_get_balance',
      'billing_purchase_credits',
      'get_buyer_history',
      'get_company',
      'get_company_awards',
      'get_company_opportunities',
      'get_pricing',
      'get_renewals',
      'get_tender',
      'research',
      'search_tenders',
    ]);
    for (const t of tools) {
      if (t.name === 'get_pricing') continue;
      expect(t.inputSchema.properties).toHaveProperty('payment_token');
    }
  });

  it('declares all four MCP tool annotations (readOnly/destructive/idempotent/openWorld) on every tool', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(11);
    for (const t of tools) {
      expect(t.annotations, `${t.name} missing readOnlyHint`).toHaveProperty('readOnlyHint', expect.any(Boolean));
      expect(t.annotations, `${t.name} missing destructiveHint`).toHaveProperty('destructiveHint', expect.any(Boolean));
      expect(t.annotations, `${t.name} missing idempotentHint`).toHaveProperty('idempotentHint', expect.any(Boolean));
      expect(t.annotations, `${t.name} missing openWorldHint`).toHaveProperty('openWorldHint', expect.any(Boolean));
    }
    // read-only data tool must be marked readOnly + non-destructive
    const search = tools.find((x) => x.name === 'search_tenders')!;
    expect(search.annotations!.readOnlyHint).toBe(true);
    expect(search.annotations!.destructiveHint).toBe(false);
    // the only mutating tool marks itself non-readOnly / non-idempotent
    const purchase = tools.find((x) => x.name === 'billing_purchase_credits')!;
    expect(purchase.annotations!.readOnlyHint).toBe(false);
    expect(purchase.annotations!.idempotentHint).toBe(false);
  });

  it('get_pricing is always free', async () => {
    const res = (await client.callTool({ name: 'get_pricing', arguments: {} })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.meta).toMatchObject({ price_usd: '0.00', paid: false });
    const data = body.data as { endpoints: Array<{ endpoint: string; price_usd: string }> };
    expect(data.endpoints.length).toBe(Object.keys(ENDPOINT_PRICES).length);
  });

  it('research tool declares the query/limit schema with the config-driven price', async () => {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === 'research');
    expect(t).toBeDefined();
    const props = t!.inputSchema.properties as Record<string, { type?: string }>;
    expect(props.query).toMatchObject({ type: 'string' });
    expect(props.limit).toMatchObject({ type: 'integer' });
    expect(props.payment_token).toBeDefined();
    expect(t!.description).toContain('$0.50');
  });

  it('research without token → payment_required at the config-driven price', async () => {
    const res = (await client.callTool({
      name: 'research',
      arguments: { query: 'cybersecurity' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    expect(body.price_usd).toBe('0.50');
  });

  it('research with a valid token → research brief envelope', async () => {
    const { token } = provider.createToken('POST /v1/research');
    const res = (await client.callTool({
      name: 'research',
      arguments: { query: 'software', payment_token: token },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.meta).toMatchObject({ price_usd: '0.50', paid: true });
    const data = body.data as {
      topic: string;
      confidence: string;
      summary: string;
      findings: unknown[];
      windows: { tenders_days: number; renewals_days: number };
    };
    expect(data.topic).toBe('software');
    expect(data.confidence).toBe('low');
    expect(data.findings).toEqual([]);
    expect(data.summary).toContain('No recent matches');
    expect(data.windows).toMatchObject({ tenders_days: 90, renewals_days: 365 });
  });

  it('paid tool without token → payment_required payload with isError=false', async () => {
    const res = (await client.callTool({
      name: 'search_tenders',
      arguments: { q: 'software' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    expect(body.price_usd).toBe('0.02');
    const how = body.how_to_pay as { faucet: string; mcp_arg: string };
    expect(how.faucet).toContain('/v1/dev-faucet');
    expect(how.mcp_arg).toBe('payment_token');
  });

  it('paid tool with invalid token → payment_required with reason', async () => {
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: 'bogus.token' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    expect(body.reason).toBe('invalid_signature');
  });

  it('paid tool with valid token → data; replay → payment_required(replay)', async () => {
    const { token } = provider.createToken('GET /v1/tenders/:id');
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: token },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.meta).toMatchObject({ price_usd: '0.02', paid: true });
    const data = body.data as { id: number; title: string; buyer: { name: string } };
    expect(data.id).toBe(7);
    expect(data.title).toBe('Suministro de software');
    expect(data.buyer.name).toBe('Ministerio de Prueba');

    const again = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: token },
    })) as ToolCallResult;
    expect(parseText(again).reason).toBe('replay');
  });

  it('token minted for a different endpoint is rejected', async () => {
    const { token } = provider.createToken('GET /v1/search');
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: token },
    })) as ToolCallResult;
    expect(parseText(res).reason).toBe('wrong_endpoint');
  });

  it('get_company returns the shared profile shape incl. aliases/identifiers', async () => {
    const { token } = provider.createToken('GET /v1/companies/:id');
    const res = (await client.callTool({
      name: 'get_company',
      arguments: { id: 7, payment_token: token },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    const data = body.data as Record<string, unknown> & {
      id: number;
      nif: string;
      aliases: string[];
      identifiers: Array<{ scheme: string; value: string }>;
      stats: { wins: number };
    };
    expect(data.id).toBe(7);
    expect(data.nif).toBe('A12345674');
    expect(data.aliases).toEqual([]);
    expect(data.identifiers).toEqual([]);
    expect(data.stats.wins).toBe(1);
    expect(data.caveats).toBeDefined();
    expect(data.provenance).toBeDefined();
  });

  it('get_company on an unknown id → not_found error result', async () => {
    const { token } = provider.createToken('GET /v1/companies/:id');
    const res = (await client.callTool({
      name: 'get_company',
      arguments: { id: 999, payment_token: token },
    })) as ToolCallResult;
    expect(res.isError).toBe(true);
    expect(parseText(res).error).toMatchObject({ code: 'not_found' });
  });

  it('invalid tool args are rejected by schema validation', async () => {
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 'not-a-number' },
    })) as ToolCallResult;
    expect(res.isError).toBe(true);
  });
});

/** Parse the single JSON-RPC message out of an SSE-framed MCP response body. */
function parseSse(body: string): Record<string, any> {
  const line = body.split('\n').find((l) => l.startsWith('data: '));
  expect(line, `SSE data line in: ${body.slice(0, 200)}`).toBeTruthy();
  return JSON.parse((line as string).slice('data: '.length));
}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

describe('mountMcp HTTP transport', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const { db, payments } = makeDb();
    await payments.query(PAYMENTS_DDL);
    initPayments(config, db); // mountMcp consumes the runtime owned by buildServer
    app = Fastify({ logger: false });
    mountMcp(app, config, db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('answers an initialize handshake at POST /mcp (SSE-framed)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'inject-test', version: '0.0.1' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = parseSse(res.body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.serverInfo).toEqual({ name: 'licita', version: '0.1.0' });
  });

  it('serves tools/call over HTTP (stateless: fresh transport per request)', async () => {
    const call = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_pricing', arguments: {} },
      },
    });
    expect(call.statusCode).toBe(200);
    const body = parseSse(call.body);
    const text = body.result.content[0].text as string;
    expect(JSON.parse(text).data.endpoints.length).toBe(Object.keys(ENDPOINT_PRICES).length);
  });

  it('unpaid paid-tool call over HTTP returns payment_required content', async () => {
    const call = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_renewals', arguments: {} },
      },
    });
    expect(call.statusCode).toBe(200);
    const body = parseSse(call.body);
    expect(body.result.isError).toBeFalsy();
    const payload = JSON.parse(body.result.content[0].text as string);
    expect(payload).toMatchObject({ payment_required: true, price_usd: '0.25' });
  });
});

describe('MCP tools in x402 mode', () => {
  const PAY_TO = '0x3bF0F00f4c8e46CA4bFEa5D77cCDdCFC95c5ac5E';
  const PAYER = '0x1111111111111111111111111111111111111111';

  function mockFacilitator(): import('@x402/core/server').FacilitatorClient {
    return {
      async verify() {
        return { isValid: true, payer: PAYER };
      },
      async settle() {
        return { success: true, transaction: '0xtxhash', network: 'eip155:84532', payer: PAYER };
      },
      async getSupported() {
        return { kinds: [], extensions: [], signers: {} };
      },
    };
  }

  async function makeX402Client(): Promise<{ client: Client; provider: X402PaymentProvider }> {
    const { db, payments } = makeDb();
    await payments.query(PAYMENTS_DDL);
    const provider = new X402PaymentProvider(
      { facilitatorUrl: 'https://facilitator.test', payTo: PAY_TO, network: 'eip155:84532' },
      db,
      { facilitator: mockFacilitator() },
    );
    const server = buildMcpServer(provider, db, config);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
    return { client, provider };
  }

  it('unpaid tool result documents the x402 payment_token semantics', async () => {
    const { client } = await makeX402Client();
    const res = (await client.callTool({
      name: 'search_tenders',
      arguments: { q: 'software' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    const how = body.how_to_pay as {
      protocol: string;
      mode: string;
      faucet: null;
      rest_header: string;
      steps: string[];
    };
    expect(how.protocol).toBe('x402');
    expect(how.mode).toBe('x402');
    expect(how.faucet).toBeNull();
    expect(how.rest_header).toBe('PAYMENT-SIGNATURE');
    expect(how.steps.join(' ')).toContain('PAYMENT-REQUIRED');
    expect(how.steps.join(' ')).toContain('payment_token');
  });

  it('paid call with a valid base64 payment payload → data; replay → payment_required(replay)', async () => {
    const { client, provider } = await makeX402Client();
    const proof = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: provider.requirementsFor('GET /v1/tenders/:id'),
        payload: { signature: '0xsig' },
      }),
    ).toString('base64');

    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: proof },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.meta).toMatchObject({ price_usd: '0.02', paid: true });
    expect((body.data as { id: number }).id).toBe(7);

    const again = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: proof },
    })) as ToolCallResult;
    expect(parseText(again).reason).toBe('replay');
  });

  it('malformed payment_token → payment_required with invalid_payload', async () => {
    const { client } = await makeX402Client();
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: 'not-a-payment' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    expect(body.reason).toBe('invalid_payload');
  });
});

// ─── B1.4: MCP trial api_clients seam (fiat-revenue-rails) ────────────────────
//
// Real pg-mem pool (TEST_SCHEMA_SQL) so tryCreditDebit's transaction on
// api_clients/payments and the request_logs writer both land. Contract:
//  - paid tool + client_key = lct_ trial key → quota debit, provider 'trial'
//    payment row, client_key logged as the hash-on-log label (Decision 6);
//  - exhausted/expired key → isError result { error: { code:'trial_exhausted',
//    message, hint } } and a 403 request log with error 'trial_exhausted';
//  - unknown lct_ key → unchanged payment_required fallback (402 log).
// request_logs is written fire-and-forget, so assertions poll briefly.
describe('MCP trial api_clients seam (B1.4)', () => {
  let client: Client;
  let db: Db;

  async function seedTrial(
    key: string,
    opts: { callsRemaining?: number; expiresInDays?: number | null } = {},
  ): Promise<number> {
    const { callsRemaining = 25, expiresInDays = 14 } = opts;
    const expires = expiresInDays === null ? 'NULL' : `now() + interval '${expiresInDays} days'`;
    const res = await db.query(
      `INSERT INTO api_clients (key_hash, kind, email, calls_remaining, expires_at)
       VALUES ($1, 'trial', $2, $3, ${expires})
       RETURNING id`,
      [hashKey(key), `${key.slice(0, 10)}@example.com`, callsRemaining],
    );
    return Number((res.rows[0] as { id: number }).id);
  }

  /** Seed tender id 7 so the paid get_tender call has pg-mem-safe data to run. */
  async function seedTender(): Promise<void> {
    const src = await db.query(`INSERT INTO sources (code, name) VALUES ('ted', 'TED') RETURNING id`);
    const sid = Number((src.rows[0] as { id: number }).id);
    await db.query(
      `INSERT INTO tenders (id, source_id, source_ref, notice_type, publication_date, title, cpv_main, procedure_type, estimated_value, currency, nuts)
       VALUES (7, $1, '123-2026', 'can-standard', '2026-01-15', 'Suministro de software', '72000000', 'open', 100000, 'EUR', 'ES61')`,
      [sid],
    );
  }

  async function waitForLogs(n = 1): Promise<void> {
    const deadline = Date.now() + 1500;
    for (;;) {
      const { rows } = await db.query('SELECT count(*)::int AS n FROM request_logs');
      if ((rows[0] as { n: number }).n >= n) return;
      if (Date.now() > deadline) throw new Error('request_logs insert did not land in time');
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  beforeEach(async () => {
    const mem = newDb({ noAstCoverageCheck: true });
    const { Pool } = mem.adapters.createPg();
    db = new Pool() as unknown as Db;
    await db.query(TEST_SCHEMA_SQL);
    await seedTender();
    const provider = new DevPaymentProvider({ secret: SECRET, db });
    const server = buildMcpServer(provider, db, config);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
  });

  it('trial client_key → paid call, quota decremented, trial payment row, hash-label logged', async () => {
    const key = generateKey();
    const id = await seedTrial(key);

    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, client_key: key },
    })) as ToolCallResult;
    expect(res.isError).toBeUndefined();
    const body = parseText(res);
    expect(body.meta).toEqual({ price_usd: '0.02', paid: true });
    expect((body.data as Record<string, unknown>).id).toBe(7);

    await waitForLogs(1);
    const quota = await db.query(`SELECT calls_remaining FROM api_clients WHERE id = $1`, [id]);
    expect(quota.rows).toEqual([{ calls_remaining: 24 }]);
    const payRows = await db.query(`SELECT client_id, provider, amount_usd, status FROM payments`);
    // pg-mem numeric → JS number (prod PostgreSQL: '0.00')
    expect(payRows.rows).toEqual([{ client_id: id, provider: 'trial', amount_usd: 0, status: 'success' }]);
    const logRows = await db.query(
      `SELECT client_key, endpoint, status, error, paid FROM request_logs ORDER BY id`,
    );
    expect(logRows.rows).toEqual([
      { client_key: hashKeyLog(key), endpoint: 'mcp:get_tender', status: 200, error: null, paid: true },
    ]);
  });

  it('exhausted trial client_key → trial_exhausted error result, log 403, quota untouched, no debit', async () => {
    const key = generateKey();
    await seedTrial(key, { callsRemaining: 1 }); // cost 2¢ > remaining 1 → shortfall

    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, client_key: key },
    })) as ToolCallResult;
    expect(res.isError).toBe(true);
    const body = parseText(res);
    expect(body.error).toMatchObject({
      code: 'trial_exhausted',
      message: expect.stringContaining('Trial quota exhausted'),
      hint: expect.stringContaining('/pricing'),
    });

    await waitForLogs(1);
    const quota = await db.query(`SELECT calls_remaining FROM api_clients WHERE key_hash = $1`, [hashKey(key)]);
    expect(quota.rows).toEqual([{ calls_remaining: 1 }]);
    const payCount = await db.query(`SELECT count(*)::int AS n FROM payments`);
    expect(payCount.rows).toEqual([{ n: 0 }]);
    const logRows = await db.query(
      `SELECT client_key, endpoint, status, error, paid FROM request_logs ORDER BY id`,
    );
    expect(logRows.rows).toEqual([
      {
        client_key: hashKeyLog(key),
        endpoint: 'mcp:get_tender',
        status: 403,
        error: 'trial_exhausted',
        paid: false,
      },
    ]);
  });

  it('expired trial client_key → trial_exhausted (key_expired), log 403, quota untouched', async () => {
    const key = generateKey();
    await seedTrial(key, { callsRemaining: 25, expiresInDays: -1 });

    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, client_key: key },
    })) as ToolCallResult;
    expect(res.isError).toBe(true);
    const body = parseText(res);
    expect(body.error).toMatchObject({
      code: 'trial_exhausted',
      message: expect.stringContaining('Trial key expired'),
    });

    await waitForLogs(1);
    const quota = await db.query(`SELECT calls_remaining FROM api_clients WHERE key_hash = $1`, [hashKey(key)]);
    expect(quota.rows).toEqual([{ calls_remaining: 25 }]);
    const logRows = await db.query(
      `SELECT client_key, status, error, paid FROM request_logs ORDER BY id`,
    );
    expect(logRows.rows).toEqual([
      { client_key: hashKeyLog(key), status: 403, error: 'trial_exhausted', paid: false },
    ]);
  });

  it('unknown lct_ client_key → payment_required fallback (unchanged), nothing mutated', async () => {
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, client_key: generateKey() },
    })) as ToolCallResult;
    expect(res.isError).toBeUndefined();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);

    await waitForLogs(1);
    const clients = await db.query(`SELECT count(*)::int AS n FROM api_clients`);
    expect(clients.rows).toEqual([{ n: 0 }]);
    const payCount = await db.query(`SELECT count(*)::int AS n FROM payments`);
    expect(payCount.rows).toEqual([{ n: 0 }]);
    const logRows = await db.query(`SELECT status, error, paid FROM request_logs ORDER BY id`);
    expect(logRows.rows).toEqual([{ status: 402, error: 'payment_required', paid: false }]);
  });
});

// P0.7 observability: MCP tool-call logging, REST hook capture (q/user_agent/
// zero_result), IP hashing, and the extended /v1/stats aggregation.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { newDb } from 'pg-mem';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Db } from '../../src/db/client.js';
import type { AppConfig } from '../../src/config.js';
import { buildMcpServer } from '../../src/mcp/server.js';
import { DevPaymentProvider } from '../../src/pay/devProvider.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { buildServer } from '../../src/api/server.js';
import { statsHandler } from '../../src/api/routes/stats.js';
import { createMetrics } from '../../src/obs/metrics.js';
import { createLogger } from '../../src/obs/log.js';
import { hashIp, strField } from '../../src/obs/requestlog.js';
import { makeTestConfig } from './testconfig.js';

const SECRET = 'obs-test-secret';
const config: AppConfig = makeTestConfig({ payHmacSecret: SECRET, operatorKey: 'obs-operator' });

const REQUEST_LOGS_DDL = `
CREATE TABLE request_logs (
  id bigserial PRIMARY KEY, ts timestamptz DEFAULT now(),
  client_key text, endpoint text, method text, status int, latency_ms int,
  cpv text, buyer text, company text, error text, paid boolean DEFAULT false,
  q text, zero_result boolean DEFAULT false, user_agent text,
  source text NOT NULL DEFAULT 'rest' CHECK (source IN ('rest', 'mcp'))
)`;

const PAYMENTS_DDL = `
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint,
  endpoint text NOT NULL, amount_usd numeric NOT NULL, provider text NOT NULL,
  proof text UNIQUE NOT NULL, status text NOT NULL, created_at timestamptz DEFAULT now(),
  payer_address text, tx_hash text, network text
)`;

/** pg-mem request_logs + payments, with every other query returning empty rows. */
async function makeObsDb(): Promise<{ db: Db; logs: Db }> {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const logs = new Pool() as unknown as Db;
  await logs.query(REQUEST_LOGS_DDL);
  await logs.query(PAYMENTS_DDL);
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      const t = text.replace(/\s+/g, ' ');
      if (t.includes('INSERT INTO request_logs')) return logs.query(text, values);
      if (t.includes('INSERT INTO payments')) return logs.query(text, values);
      return { rows: [] };
    },
  } as unknown as Db;
  return { db, logs };
}

async function waitForRows(db: Db, minRows: number, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM request_logs');
    if (Number((rows[0] as { n: number }).n) >= minRows) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`request_logs did not reach ${minRows} rows in time`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

describe('MCP tool-call logging (P0.7)', () => {
  let logs: Db;
  let client: Client;
  let provider: DevPaymentProvider;

  beforeEach(async () => {
    const made = await makeObsDb();
    logs = made.logs;
    provider = new DevPaymentProvider({ secret: SECRET, db: made.db });
    const server = buildMcpServer(provider, made.db, config, { clientIp: '203.0.113.42' });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'obs-test', version: '0.0.1' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('logs unpaid paid-tool calls with status 402, error and q extraction', async () => {
    await client.callTool({ name: 'search_tenders', arguments: { q: 'software' } });
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT * FROM request_logs ORDER BY id');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.source).toBe('mcp');
    expect(row.endpoint).toBe('mcp:search_tenders');
    expect(row.method).toBe('POST');
    expect(row.status).toBe(402);
    expect(row.error).toBe('payment_required');
    expect(row.q).toBe('software');
    expect(row.zero_result).toBe(false);
    expect(row.paid).toBe(false);
    expect(row.client_key).toBe(hashIp('203.0.113.42', config.operatorKey));
    expect(String(row.client_key)).not.toContain('203.0.113.42');
  });

  it('logs paid calls with 200 and zero_result when the result set is empty', async () => {
    const { token } = provider.createToken('GET /v1/search');
    await client.callTool({
      name: 'search_tenders',
      arguments: { q: 'cyber', cpv: '72', payment_token: token },
    });
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT * FROM request_logs ORDER BY id');
    const row = rows[0];
    expect(row.status).toBe(200);
    expect(row.zero_result).toBe(true);
    expect(row.q).toBe('cyber');
    expect(row.cpv).toBe('72');
    expect(row.paid).toBe(true);
    expect(String(row.client_key)).toMatch(/^dev_/);
  });

  it('extracts id args into company/buyer columns and maps not_found status', async () => {
    const { token } = provider.createToken('GET /v1/companies/:id');
    await client.callTool({ name: 'get_company', arguments: { id: 7, payment_token: token } });
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT * FROM request_logs ORDER BY id');
    const row = rows[0];
    expect(row.status).toBe(404);
    expect(row.error).toBe('not_found');
    expect(row.company).toBe('7');
  });

  it('extracts cpv/buyer from get_renewals args', async () => {
    const { token } = provider.createToken('GET /v1/renewals');
    await client.callTool({
      name: 'get_renewals',
      arguments: { cpv: '72', buyer: 'Madrid', payment_token: token },
    });
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT * FROM request_logs ORDER BY id');
    const row = rows[0];
    expect(row.status).toBe(200);
    expect(row.cpv).toBe('72');
    expect(row.buyer).toBe('Madrid');
  });

  it('logs free tools with 200, paid=false and an IP-hashed client_key', async () => {
    const res = (await client.callTool({ name: 'get_pricing', arguments: {} })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT * FROM request_logs ORDER BY id');
    const row = rows[0];
    expect(row.endpoint).toBe('mcp:get_pricing');
    expect(row.status).toBe(200);
    expect(row.paid).toBe(false);
    expect(row.client_key).toBe(hashIp('203.0.113.42', config.operatorKey));
  });
});

describe('REST request logging (P0.7)', () => {
  let app: ReturnType<typeof Fastify>;
  let logs: Db;

  beforeEach(async () => {
    const made = await makeObsDb();
    logs = made.logs;
    app = await buildServer(config, made.db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('captures q, user_agent and zero_result on a paid empty search', async () => {
    const signer = new DevPaymentProvider({ secret: SECRET });
    const { token } = signer.createToken('GET /v1/search');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search?q=doesnotexist',
      headers: { 'x-payment': token, 'user-agent': 'test-agent/1.0' },
    });
    expect(res.statusCode).toBe(200);
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT * FROM request_logs ORDER BY id');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.source).toBe('rest');
    expect(row.endpoint).toBe('GET /v1/search');
    expect(row.q).toBe('doesnotexist');
    expect(row.user_agent).toBe('test-agent/1.0');
    expect(row.zero_result).toBe(true);
    expect(row.paid).toBe(true);
  });

  it('hashes the client IP instead of storing it raw', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/search?q=test' });
    expect(res.statusCode).toBe(402);
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT * FROM request_logs ORDER BY id');
    const row = rows[0];
    expect(row.status).toBe(402);
    expect(row.error).toBe('payment_required');
    expect(row.client_key).toBe(hashIp('127.0.0.1', config.operatorKey));
    expect(String(row.client_key)).not.toContain('127.0.0.1');
  });
});

describe('IP hashing and field truncation (P0.7)', () => {
  it('hashIp is deterministic, secret-dependent and never reveals the raw IP', () => {
    const a = hashIp('203.0.113.42', 'secret-a');
    const b = hashIp('203.0.113.42', 'secret-a');
    const c = hashIp('203.0.113.42', 'secret-b');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^ip_[0-9a-f]{24}$/);
    expect(a).not.toContain('203.0.113.42');
  });

  it('strField truncates to 200 chars and coerces numbers', () => {
    expect(strField('x'.repeat(500))).toHaveLength(200);
    expect(strField(7)).toBe('7');
    expect(strField(undefined)).toBeNull();
    expect(strField(null)).toBeNull();
    expect(strField('')).toBeNull();
  });
});

describe('stats aggregation (P0.7)', () => {
  it('includes source, zero-result, payment-required, repeat-client, search and user-agent sections', async () => {
    const mem = newDb({ noAstCoverageCheck: true });
    const { Pool } = mem.adapters.createPg();
    const db = new Pool() as unknown as Db;
    await db.query(REQUEST_LOGS_DDL);
    await db.query(PAYMENTS_DDL);
    await db.query(
      'CREATE TABLE awards (id bigserial PRIMARY KEY, tender_id bigint NOT NULL, source_ref text, value numeric, winner_company_id bigint)',
    );

    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, latency_ms, q, zero_result, user_agent, source, paid, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ['dev_aaa', 'GET /v1/search', 'GET', 200, 10, 'software', true, 'curl/8.1', 'rest', true, null],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, latency_ms, q, zero_result, user_agent, source, paid, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ['dev_aaa', 'GET /v1/search', 'GET', 200, 8, 'software', false, 'curl/8.1', 'rest', true, null],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, latency_ms, q, zero_result, user_agent, source, paid, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ['ip_x', 'mcp:search_tenders', 'POST', 402, 5, 'cyber', false, null, 'mcp', false, 'payment_required'],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, latency_ms, q, zero_result, user_agent, source, paid, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ['ip_y', 'GET /v1/search', 'GET', 402, 3, 'tenders', false, 'curl/8.2', 'rest', false, 'payment_required'],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, latency_ms, q, zero_result, user_agent, source, paid, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      ['ip_y', 'GET /v1/search', 'GET', 500, 3, 'boom', false, 'curl/8.2', 'rest', false, 'internal'],
    );

    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, network)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['GET /v1/search', '0.02', 'dev', 'p1', 'success', null],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, network)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['GET /v1/tenders/:id', '0.02', 'x402', 'p2', 'settled', 'eip155:84532'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, network)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['GET /v1/search', '0.02', 'dev', 'p3', 'failed', null],
    );

    const ctx = {
      config,
      db,
      log: createLogger('error'),
      metrics: createMetrics(),
    };
    const reply = { send: (body: unknown) => body };
    const body = (await statsHandler(ctx)(
      { id: 's1', query: {}, payment: { paid: false, priceUsd: '0.00' } } as never,
      reply as never,
    )) as { data: Record<string, unknown> };

    const data = body.data;
    expect(data.unique_clients).toBe(3);
    expect(data.requests_by_source).toEqual([
      { source: 'rest', requests: 4 },
      { source: 'mcp', requests: 1 },
    ]);
    expect(data.zero_result_queries).toEqual({ count: 1, rate: 0.2 });
    expect(data.payment_required_responses).toBe(2);
    expect(data.failed_queries).toBe(3);
    expect(data.failed_requests_rate).toEqual({ count: 3, total: 5, rate: 0.6 });
    expect(data.top_searches).toEqual([
      { q: 'software', requests: 2 },
      { q: 'boom', requests: 1 },
      { q: 'cyber', requests: 1 },
      { q: 'tenders', requests: 1 },
    ]);
    expect(data.unique_user_agents).toMatchObject({
      count: 2,
      top: [
        { user_agent: 'curl/8.1', requests: 2 },
        { user_agent: 'curl/8.2', requests: 2 },
      ],
    });
    expect(data.repeat_clients).toEqual({
      count: 1,
      paid_requests_total: 2,
      top: [{ client_key: 'dev_aaa', paid_requests: 2 }],
    });
    expect(data.payments).toMatchObject({
      attempts: 3,
      successes: 1,
      revenue_usd: 0.02,
    });
    expect(data.payments.by_network_provider).toEqual([
      { provider: 'dev', network: 'dev', count: 2, amount_usd: 0.04 },
      { provider: 'x402', network: 'eip155:84532', count: 1, amount_usd: 0.02 },
    ]);
  });
});

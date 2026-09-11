// 011 web traffic analytics: onResponse hook page detection, referer capture,
// /v1/stats web_traffic block, and demo conversion rate.
//
// Tests the hook's kind='page' classification (status 200 + text/html on
// known public web routes) and the stats aggregation without modifying any
// existing needles or assertions.

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import { buildServer } from '../../src/api/server.js';
import { registerWeb } from '../../src/web/pages.js';
import { statsHandler } from '../../src/api/routes/stats.js';
import { createMetrics } from '../../src/obs/metrics.js';
import { createLogger } from '../../src/obs/log.js';
import { makeTestConfig } from './testconfig.js';

const config = makeTestConfig({ operatorKey: 'wt-test' });

const REQUEST_LOGS_DDL = `
CREATE TABLE request_logs (
  id bigserial PRIMARY KEY, ts timestamptz DEFAULT now(),
  client_key text, endpoint text, method text, status int, latency_ms int,
  cpv text, buyer text, company text, error text, paid boolean DEFAULT false,
  q text, zero_result boolean DEFAULT false, user_agent text,
  source text NOT NULL DEFAULT 'rest' CHECK (source IN ('rest', 'mcp')),
  kind text NOT NULL DEFAULT 'api' CHECK (kind IN ('api', 'page', 'mcp')),
  referer text
)`;

const DEMO_REQUESTS_DDL = `
CREATE TABLE demo_requests (
  id bigserial PRIMARY KEY, email text NOT NULL, channel text NOT NULL,
  source_url text, status text NOT NULL DEFAULT 'new', created_at timestamptz NOT NULL DEFAULT now()
)`;

const PAYMENTS_DDL = `
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint, endpoint text NOT NULL,
  amount_usd numeric NOT NULL, provider text NOT NULL, proof text UNIQUE NOT NULL,
  status text NOT NULL, created_at timestamptz DEFAULT now(), payer_address text,
  tx_hash text, network text
)`;

const AWARDS_DDL = `
CREATE TABLE awards (
  id bigserial PRIMARY KEY, tender_id bigint NOT NULL, source_ref text,
  value numeric, winner_company_id bigint
)`;

async function makeHookDb(): Promise<{ db: Db; logs: Db }> {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const logs = new Pool() as unknown as Db;
  await logs.query(REQUEST_LOGS_DDL);
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      if (text.includes('INSERT INTO request_logs') || text.includes('SELECT count(*)')) return logs.query(text, values);
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
    if (Date.now() - start > timeoutMs) throw new Error(`request_logs did not reach ${minRows} rows in time`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// --- hook classification tests ------------------------------------------------
describe('onResponse page classification (011)', () => {
  it('marks GET / as kind=page and captures the referer header', async () => {
    const { db, logs } = await makeHookDb();
    const app = await buildServer(config, db);
    registerWeb(app, config);
    await app.inject({
      method: 'GET',
      url: '/',
      headers: { referer: 'https://news.ycombinator.com/item?id=999' },
    });
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT kind, referer, endpoint FROM request_logs ORDER BY id');
    expect(rows[0]).toMatchObject({ kind: 'page', endpoint: 'GET /' });
    expect(rows[0].referer).toBe('https://news.ycombinator.com/item?id=999');
    await app.close();
  });

  it('marks GET /openapi.json as kind=api (JSON, not HTML)', async () => {
    const { db, logs } = await makeHookDb();
    const app = await buildServer(config, db);
    registerWeb(app, config);
    await app.inject({ method: 'GET', url: '/openapi.json' });
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT kind, endpoint FROM request_logs ORDER BY id');
    expect(rows[0]).toMatchObject({ kind: 'api', endpoint: 'GET /openapi.json' });
    await app.close();
  });

  it('marks GET /pricing as kind=page (public HTML route)', async () => {
    const { db, logs } = await makeHookDb();
    const app = await buildServer(config, db);
    registerWeb(app, config);
    await app.inject({ method: 'GET', url: '/pricing' });
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT kind, endpoint FROM request_logs ORDER BY id');
    expect(rows[0]).toMatchObject({ kind: 'page', endpoint: 'GET /pricing' });
    await app.close();
  });

  it('marks GET /docs as kind=page and GET /v1/demo as kind=api', async () => {
    const { db, logs } = await makeHookDb();
    const app = await buildServer(config, db);
    registerWeb(app, config);
    await app.inject({ method: 'GET', url: '/docs' });
    await app.inject({ method: 'GET', url: '/v1/demo' });
    await waitForRows(logs, 2);
    const { rows } = await logs.query('SELECT kind, endpoint FROM request_logs ORDER BY id');
    expect(rows[0]).toMatchObject({ kind: 'page', endpoint: 'GET /docs' });
    expect(rows[1]).toMatchObject({ kind: 'api', endpoint: 'GET /v1/demo' });
    await app.close();
  });

  it('uses referer=(direct) equivalent when referer header is absent', async () => {
    const { db, logs } = await makeHookDb();
    const app = await buildServer(config, db);
    registerWeb(app, config);
    await app.inject({ method: 'GET', url: '/' }); // no referer
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT kind, referer FROM request_logs ORDER BY id');
    expect(rows[0]).toMatchObject({ kind: 'page', referer: null });
    await app.close();
  });

  it('marks 404 on unknown route as kind=api (not a page)', async () => {
    const { db, logs } = await makeHookDb();
    const app = await buildServer(config, db);
    registerWeb(app, config);
    await app.inject({ method: 'GET', url: '/nonexistent' });
    await waitForRows(logs, 1);
    const { rows } = await logs.query('SELECT kind, endpoint FROM request_logs ORDER BY id');
    expect(rows[0]).toMatchObject({ kind: 'api', endpoint: 'GET /nonexistent' });
    await app.close();
  });
});

// --- stats web_traffic block tests -------------------------------------------
async function makeStatsDb(): Promise<Db> {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const db = new Pool() as unknown as Db;
  await db.query(REQUEST_LOGS_DDL);
  await db.query(DEMO_REQUESTS_DDL);
  await db.query(PAYMENTS_DDL);
  await db.query(AWARDS_DDL);
  return db;
}

async function runStats(db: Db, query: Record<string, string> = {}) {
  const ctx = { config, db, log: createLogger('error'), metrics: createMetrics() };
  const reply = { send: (body: unknown) => body };
  return ((await statsHandler(ctx)({ id: 'wt', query } as never, reply as never)) as { data: Record<string, unknown> }).data;
}

describe('GET /v1/stats web_traffic block', () => {
  it('returns zeroed web_traffic on an empty database', async () => {
    const db = await makeStatsDb();
    const data = await runStats(db);
    expect(data.web_traffic).toBeDefined();
    expect(data.web_traffic).toMatchObject({
      page_views: 0,
      page_views_by_path: [],
      api_requests: 0,
      mcp_requests: 0,
      referrers: [],
      demo_conversion: { page_views: 0, demo_requests: 0, conversion_rate: 0 },
    });
    await db.end();
  });

  it('counts page views, API requests, and MCP requests correctly', async () => {
    const db = await makeStatsDb();
    const now = new Date('2026-09-10T12:00:00Z');
    // 3 page views, 2 api, 1 mcp
    const rows: Array<[string, string, string, number, string, string, string | null]> = [
      ['GET /', 'GET', 'rest', 200, 'page', null, now.toISOString()],
      ['GET /pricing', 'GET', 'rest', 200, 'page', 'https://example.com', now.toISOString()],
      ['GET /docs', 'GET', 'rest', 200, 'page', null, now.toISOString()],
      ['GET /v1/search', 'GET', 'rest', 200, 'api', null, now.toISOString()],
      ['GET /v1/tenders/:id', 'GET', 'rest', 402, 'api', null, now.toISOString()],
      ['mcp:search_tenders', 'POST', 'mcp', 200, 'api', null, now.toISOString()],
    ];
    for (const [endpoint, method, source, status, kind, referer, ts] of rows) {
      await db.query(
        `INSERT INTO request_logs (endpoint, method, source, status, kind, referer, ts, client_key, paid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'test', false)`,
        [endpoint, method, source, status, kind, referer, ts],
      );
    }
    const data = await runStats(db);
    expect(data.web_traffic).toMatchObject({
      page_views: 3,
      api_requests: 3,  // 2 api source='rest' + 1 source='mcp' (kind='api')
      mcp_requests: 1,
    });
    expect(data.web_traffic.page_views_by_path).toEqual([
      { path: '/', requests: 1 },
      { path: '/docs', requests: 1 },
      { path: '/pricing', requests: 1 },
    ]);
    await db.end();
  });

  it('aggregates referrers by host with (direct) for null referers', async () => {
    const db = await makeStatsDb();
    await db.query(
      `INSERT INTO request_logs (endpoint, method, source, status, kind, referer, client_key, paid)
       VALUES
         ('GET /', 'GET', 'rest', 200, 'page', 'https://news.ycombinator.com/item?id=1', 'c1', false),
         ('GET /', 'GET', 'rest', 200, 'page', 'https://news.ycombinator.com/item?id=2', 'c2', false),
         ('GET /', 'GET', 'rest', 200, 'page', 'https://google.com/search?q=licita', 'c3', false),
         ('GET /', 'GET', 'rest', 200, 'page', null, 'c4', false),
         ('GET /', 'GET', 'rest', 200, 'page', null, 'c5', false)`,
    );
    const data = await runStats(db);
    expect(data.web_traffic.referrers).toEqual([
      { referrer: '(direct)', requests: 2 },
      { referrer: 'news.ycombinator.com', requests: 2 },
      { referrer: 'google.com', requests: 1 },
    ]);
    await db.end();
  });

  it('computes demo_conversion with correct rate and handles division by zero', async () => {
    const db = await makeStatsDb();
    // 50 page views, 2 homepage demo requests → rate 0.04
    for (let i = 0; i < 50; i++) {
      await db.query(
        `INSERT INTO request_logs (endpoint, method, source, status, kind, referer, client_key, paid)
         VALUES ('GET /', 'GET', 'rest', 200, 'page', null, 'c${i}', false)`,
      );
    }
    await db.query(
      `INSERT INTO demo_requests (email, channel, status) VALUES ('a@test.com', 'homepage', 'new'), ('b@test.com', 'web', 'new')`,
    );
    const data = await runStats(db);
    expect(data.web_traffic.demo_conversion).toMatchObject({
      page_views: 50,
      demo_requests: 2,
      conversion_rate: 0.04,
    });
    await db.end();
  });

  it('returns conversion_rate 0 when page_views is 0 (division by zero)', async () => {
    const db = await makeStatsDb();
    await db.query(
      `INSERT INTO demo_requests (email, channel, status) VALUES ('x@test.com', 'homepage', 'new')`,
    );
    const data = await runStats(db);
    expect(data.web_traffic.demo_conversion).toMatchObject({
      page_views: 0,
      demo_requests: 1,
      conversion_rate: 0,
    });
    await db.end();
  });

  it('respects from/to range filters', async () => {
    const db = await makeStatsDb();
    const inside = '2026-09-10T12:00:00Z';
    const outside = '2026-08-01T12:00:00Z';
    // Inside range: 2 page views
    await db.query(
      `INSERT INTO request_logs (endpoint, method, source, status, kind, referer, client_key, paid, ts)
       VALUES ('GET /', 'GET', 'rest', 200, 'page', 'https://example.com', 'c1', false, $1),
              ('GET /docs', 'GET', 'rest', 200, 'page', null, 'c2', false, $1)`,
      [inside],
    );
    // Outside range: 1 page view
    await db.query(
      `INSERT INTO request_logs (endpoint, method, source, status, kind, referer, client_key, paid, ts)
       VALUES ('GET /', 'GET', 'rest', 200, 'page', null, 'c3', false, $1)`,
      [outside],
    );
    // Demo inside range
    await db.query(
      `INSERT INTO demo_requests (email, channel, status, created_at) VALUES ('r@test.com', 'homepage', 'new', $1)`,
      [inside],
    );
    const data = await runStats(db, { from: '2026-09-01', to: '2026-09-30' });
    expect(data.web_traffic).toMatchObject({
      page_views: 2,
      page_views_by_path: [
        { path: '/', requests: 1 },
        { path: '/docs', requests: 1 },
      ],
      demo_conversion: { page_views: 2, demo_requests: 1, conversion_rate: 0.5 },
    });
    await db.end();
  });

  it('existing stats keys are not broken', async () => {
    const db = await makeStatsDb();
    const data = await runStats(db);
    // Verify existing key structure is preserved
    expect(data.unique_clients).toBeDefined();
    expect(data.total_requests).toBeDefined();
    expect(data.requests_by_source).toBeDefined();
    expect(data.growth).toBeDefined();
    expect(data.growth.funnel).toBeDefined();
    expect(data.caq_by_channel).toBeDefined();
    expect(data.demo_pipeline).toBeDefined();
    await db.end();
  });
});

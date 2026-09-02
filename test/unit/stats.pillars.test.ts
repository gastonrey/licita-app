import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import { isValidCalendarDate, statsHandler } from '../../src/api/routes/stats.js';
import { createMetrics } from '../../src/obs/metrics.js';
import { createLogger } from '../../src/obs/log.js';
import { makeTestConfig } from './testconfig.js';
import { buildServer } from '../../src/api/server.js';

const config = makeTestConfig({ operatorKey: 'pillars' });
const REQUESTS = `CREATE TABLE request_logs (
 id bigserial PRIMARY KEY, ts timestamptz DEFAULT now(), client_key text,
 endpoint text, method text, status int, latency_ms int, cpv text, buyer text,
 company text, error text, paid boolean DEFAULT false, q text,
 zero_result boolean DEFAULT false, user_agent text,
 source text NOT NULL DEFAULT 'rest' CHECK (source IN ('rest', 'mcp')))`;
const PAYMENTS = `CREATE TABLE payments (
 id bigserial PRIMARY KEY, client_id bigint, endpoint text NOT NULL,
 amount_usd numeric NOT NULL, provider text NOT NULL, proof text UNIQUE NOT NULL,
 status text NOT NULL, created_at timestamptz DEFAULT now(), payer_address text,
 tx_hash text, network text)`;
const DEMOS = `CREATE TABLE demo_requests (
 id bigserial PRIMARY KEY, email text NOT NULL, channel text NOT NULL,
 source_url text, status text NOT NULL, created_at timestamptz NOT NULL)`;

async function dbWithTables(): Promise<Db> {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const db = new Pool() as unknown as Db;
  await db.query(REQUESTS); await db.query(PAYMENTS); await db.query(DEMOS);
  await db.query('CREATE TABLE awards (id bigserial PRIMARY KEY, tender_id bigint NOT NULL, value numeric, winner_company_id bigint)');
  return db;
}

async function stats(db: Db, query: Record<string, string> = {}) {
  const ctx = { config, db, log: createLogger('error'), metrics: createMetrics() };
  const reply = { send: (body: unknown) => body };
  return ((await statsHandler(ctx)({ id: 'pillars', query } as never, reply as never)) as { data: Record<string, any> }).data;
}

describe('product-quality stats pillars', () => {
  it.each(['2026-02-29', '2026-99-99'])('returns 400 invalid_query for impossible date %s at the route boundary', async (date) => {
    const db = await dbWithTables();
    const app = await buildServer(config, db);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/stats?from=${date}`,
      headers: { 'x-operator-key': 'pillars' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'invalid_query' } });
    await app.close();
    await db.end();
  });

  it('rejects impossible calendar dates while accepting real leap days', () => {
    expect(isValidCalendarDate('2026-02-29')).toBe(false);
    expect(isValidCalendarDate('2024-02-29')).toBe(true);
    expect(isValidCalendarDate('2026-99-99')).toBe(false);
  });

  it('rejects a date range whose end precedes its start', async () => {
    const db = await dbWithTables();
    const app = await buildServer(config, db);
    const res = await app.inject({ method: 'GET', url: '/v1/stats?from=2026-08-31&to=2026-08-01', headers: { 'x-operator-key': 'pillars' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'invalid_query' } });
    await app.close();
  });

  it('returns all six pillars zeroed on an empty database', async () => {
    const data = await stats(await dbWithTables());
    expect(data.caq_by_channel).toEqual([]);
    expect(data.growth.funnel.conversions.every((c: any) => c.rate === null)).toBe(true);
    expect(data.revenue_new_vs_repeat).toEqual({ new_revenue_usd: 0, repeat_revenue_usd: 0, new_payments: 0, repeat_payments: 0 });
    expect(data.demo_pipeline).toEqual({ by_status: { new: 0, contacted: 0, used: 0, paid: 0 }, requests: [] });
    expect(data.daily_traffic).toEqual([]);
    expect(data.endpoint_economics).toEqual([]);
    expect(data.zero_result_by_endpoint).toEqual([]);
  });

  it('triangulates filtered usage, payments, demo conversion, and payment-only endpoints', async () => {
    const db = await dbWithTables();
    const inside = new Date('2026-08-15T12:00:00Z');
    const old = new Date('2026-07-15T12:00:00Z');
    for (const row of [
      ['a', 'POST /v1/research', true, false, inside], ['b', 'POST /v1/research', true, true, inside],
      ['c', 'POST /v1/research', false, true, inside], ['old', 'POST /v1/research', true, true, old],
    ]) await db.query('INSERT INTO request_logs (client_key,endpoint,paid,zero_result,ts,status) VALUES ($1,$2,$3,$4,$5,200)', row);
    await db.query("INSERT INTO request_logs (client_key,endpoint,source,ts,status) VALUES ('a','mcp:initialize','mcp',$1,200)", [inside]);
    for (const row of [
      ['POST /v1/research', '.50', 'p1', 'a', inside], ['POST /v1/research', '.50', 'p2', 'a', inside],
      ['GET /v1/hidden-paid', '1.00', 'p3', 'b', inside], ['POST /v1/research', '9.00', 'p4', 'old', old],
    ]) await db.query('INSERT INTO payments (endpoint,amount_usd,provider,proof,status,payer_address,created_at) VALUES ($1,$2,\'x402\',$3,\'settled\',$4,$5)', row);
    await db.query('INSERT INTO demo_requests (email,channel,status,created_at) VALUES (\'a@b.com\',\'homepage\',\'paid\',$1),(\'new@b.com\',\'homepage\',\'new\',$2)', [inside, old]);
    const data = await stats(db, { from: '2026-08-01', to: '2026-08-31' });
    expect(data.caq_by_channel).toEqual(expect.arrayContaining([{ channel: 'rest', requests: 3, paid_requests: 2, unique_clients: 3 }]));
    expect(data.revenue_new_vs_repeat).toMatchObject({ new_revenue_usd: 1.5, repeat_revenue_usd: 0.5, new_payments: 2, repeat_payments: 1 });
    expect(data.demo_pipeline.by_status).toEqual({ new: 0, contacted: 0, used: 0, paid: 1 });
    expect(data.demo_pipeline.requests[0].converted).toBe(true);
    expect(data.endpoint_economics).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpoint: 'GET /v1/hidden-paid', requests: 0, revenue_usd: 1, revenue_per_call: 0 }),
      expect.objectContaining({ endpoint: 'POST /v1/research', requests: 3, revenue_usd: 1, revenue_per_call: 0.3333 }),
    ]));
    expect(data.daily_traffic).toEqual([{ date: '2026-08-15', requests: 4, paid_requests: 2, rest_requests: 3, mcp_requests: 1 }]);
    expect(data.growth.funnel.conversions).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'initialized', to: 'queried', rate: 3 }),
    ]));
  });

  it('filters legacy request and payment aggregates with the selected range', async () => {
    const db = await dbWithTables();
    await db.query("INSERT INTO request_logs (client_key,endpoint,source,paid,status,ts) VALUES ('old','GET /old','rest',true,200,'2026-07-01'),('inside','GET /inside','rest',false,500,'2026-08-15')");
    await db.query("INSERT INTO payments (endpoint,amount_usd,provider,proof,status,payer_address,created_at) VALUES ('GET /old','9','x402','old-proof','success','old','2026-07-01'),('GET /inside','1','x402','inside-proof','success','inside','2026-08-15')");
    const data = await stats(db, { from: '2026-08-01', to: '2026-08-31' });
    expect(data.total_requests).toBe(1);
    expect(data.unique_clients).toBe(1);
    expect(data.payments.revenue_usd).toBe(1);
    expect(data.failed_queries).toBe(1);
    expect(data.requests_by_endpoint).toEqual([{ endpoint: 'GET /inside', requests: 1, paid_requests: 1 }]);
    expect(data.daily_traffic).toEqual([{ date: '2026-08-15', requests: 1, paid_requests: 0, rest_requests: 1, mcp_requests: 0 }]);
  });
});

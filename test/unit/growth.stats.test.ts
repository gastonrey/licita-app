// /v1/stats `growth` block (P0.8): North Star metric, paid-agent cohort,
// repeat detection, 1st->2nd payment timing, calls/revenue per agent,
// demo/research counts and the funnel stages. All SQL is pg-mem-portable:
// CASE WHEN instead of FILTER, now() - interval '7 days' for the rolling week,
// EXISTS instead of an inner join for the x402 call counts, LIKE without
// backslash escapes.

import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import { statsHandler } from '../../src/api/routes/stats.js';
import { createMetrics } from '../../src/obs/metrics.js';
import { createLogger } from '../../src/obs/log.js';
import { makeTestConfig } from './testconfig.js';

const config = makeTestConfig({ operatorKey: 'growth-operator' });
const DAY = 86400000;

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

async function makeGrowthDb(): Promise<Db> {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const db = new Pool() as unknown as Db;
  await db.query(REQUEST_LOGS_DDL);
  await db.query(PAYMENTS_DDL);
  await db.query(
    'CREATE TABLE awards (id bigserial PRIMARY KEY, tender_id bigint NOT NULL, source_ref text, value numeric, winner_company_id bigint)',
  );
  return db;
}

async function runStats(db: Db): Promise<Record<string, unknown>> {
  const ctx = { config, db, log: createLogger('error'), metrics: createMetrics() };
  const reply = { send: (body: unknown) => body };
  const body = (await statsHandler(ctx)(
    { id: 's1', query: {}, payment: { paid: false, priceUsd: '0.00' } } as never,
    reply as never,
  )) as { data: Record<string, unknown> };
  return body.data;
}

describe('GET /v1/stats growth block', () => {
  it('is present with zeroed/null defaults on an empty database', async () => {
    const db = await makeGrowthDb();
    const data = await runStats(db);
    expect(data.growth).toBeDefined();
    expect(data.growth).toMatchObject({
      weekly_active_paying_agents: 0,
      paid_agents: 0,
      repeat_paid_agents: 0,
      first_payment: null,
      second_payment: null,
      time_to_second_purchase_days: 0,
      revenue_per_agent: 0,
      calls_per_agent: 0,
      free_demo_calls: 0,
      research_calls: 0,
      research_paid_calls: 0,
      research_conversion: 0,
      funnel: {
        discovered: 0,
        initialized: 0,
        queried: 0,
        demo: 0,
        paid: 0,
        repeated: 0,
        revenue: 0,
      },
    });
    expect((data.growth as { source_labels: string[] }).source_labels).toEqual([
      'discovered',
      'initialized',
      'queried',
      'demo',
      'paid',
      'repeated',
      'revenue',
    ]);
  });

  it('counts only recent x402 payers weekly, detects repeats and derives first/second payment timing', async () => {
    const db = await makeGrowthDb();
    const now = Date.now();
    // payer 0x1111: two recent payments (both inside the 7-day window)
    const a1First = new Date(now - 1 * DAY);
    const a1Second = new Date(now - 6 * DAY);
    // payer 0x2222: two old payments (outside the window) — repeat, not weekly
    const a2Second = new Date(now - 30 * DAY);
    const a2First = new Date(now - 40 * DAY);
    // payer 0x3333: single recent payment — weekly, not repeat
    const a3First = new Date(now - 2 * DAY);
    // payer 0x4444: single old payment — neither weekly nor repeat
    const a4First = new Date(now - 50 * DAY);
    // dev payment: status 'success', no payer_address — excluded from payer metrics
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'p1', 'settled', a1First, '0x1111'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'p2', 'settled', a1Second, '0x1111'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'p3', 'settled', a2Second, '0x2222'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'p4', 'settled', a2First, '0x2222'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'p5', 'settled', a3First, '0x3333'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'p6', 'settled', a4First, '0x4444'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['GET /v1/search', '0.02', 'dev', 'p7', 'success', new Date(now), null],
    );

    const data = await runStats(db);
    const g = data.growth as {
      weekly_active_paying_agents: number;
      paid_agents: number;
      repeat_paid_agents: number;
      first_payment: string | null;
      second_payment: string | null;
      time_to_second_purchase_days: number;
      revenue_per_agent: number;
      funnel: Record<string, number>;
    };

    // 4 x402 payers; dev payment (no payer_address) is excluded
    expect(g.paid_agents).toBe(4);
    // only 0x1111 and 0x3333 paid inside the rolling 7-day window
    expect(g.weekly_active_paying_agents).toBe(2);
    // 0x1111 and 0x2222 have >=2 payments; 0x3333/0x4444 have one
    expect(g.repeat_paid_agents).toBe(2);

    // cohort milestones: earliest overall and earliest second purchase
    expect(g.first_payment).toBe(a4First.toISOString());
    expect(g.second_payment).toBe(a2Second.toISOString());
    // average 1st->2nd gap: (5 days + 10 days) / 2 = 7.5
    expect(g.time_to_second_purchase_days).toBe(7.5);

    // settled revenue = 6 x402 rows x $0.50 = $3.00 (dev 'success' excluded)
    expect(g.funnel.revenue).toBe(3.0);
    expect(g.revenue_per_agent).toBe(0.75);
  });

  it('derives calls_per_agent from x402 client keys without multiplying by payment count', async () => {
    const db = await makeGrowthDb();
    const now = Date.now();
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'q1', 'settled', new Date(now - 1 * DAY), '0x1111'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'q2', 'settled', new Date(now - 2 * DAY), '0x1111'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'q3', 'settled', new Date(now - 3 * DAY), '0x2222'],
    );
    // payer 0x1111 has TWO payments but only its request rows count once
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['x402_0x1111', 'POST /v1/research', 'POST', 200, true, 'rest'],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['x402_0x1111', 'POST /v1/research', 'POST', 200, true, 'rest'],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['x402_0x2222', 'GET /v1/demo', 'GET', 200, false, 'rest'],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['ip_a', 'GET /v1/demo', 'GET', 200, false, 'rest'],
    );

    const data = await runStats(db);
    const g = data.growth as {
      paid_agents: number;
      calls_per_agent: number;
      free_demo_calls: number;
    };
    expect(g.paid_agents).toBe(2);
    // 3 x402 call rows across 2 payers -> 3 / 2 = 1.5 (the inner-join
    // multiplicity would have said 5 rows instead of 3)
    expect(g.calls_per_agent).toBe(1.5);
    expect(g.free_demo_calls).toBe(2);
  });

  it('computes research counts and conversion from paid/unpaid research rows', async () => {
    const db = await makeGrowthDb();
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['x402_0x1111', 'POST /v1/research', 'POST', 200, true, 'rest', null],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['x402_0x1111', 'POST /v1/research', 'POST', 200, true, 'rest', null],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['ip_a', 'POST /v1/research', 'POST', 402, false, 'rest', 'payment_required'],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['ip_b', 'GET /v1/demo', 'GET', 200, false, 'rest', null],
    );

    const data = await runStats(db);
    const g = data.growth as {
      research_calls: number;
      research_paid_calls: number;
      research_conversion: number;
      free_demo_calls: number;
    };
    expect(g.research_calls).toBe(3);
    expect(g.research_paid_calls).toBe(2);
    expect(g.research_conversion).toBe(0.6667); // 2/3 rounded to 4 decimals, like the other rates
    expect(g.free_demo_calls).toBe(1);
  });

  it('orders the funnel stages (discovered >= queried >= demo, paid >= repeated) and reuses initialize_count', async () => {
    const db = await makeGrowthDb();
    const now = Date.now();
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'r1', 'settled', new Date(now - 1 * DAY), '0x1111'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'r2', 'settled', new Date(now - 6 * DAY), '0x1111'],
    );
    await db.query(
      `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, created_at, payer_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['POST /v1/research', '0.50', 'x402', 'r3', 'settled', new Date(now - 2 * DAY), '0x2222'],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['x402_0x1111', 'POST /v1/research', 'POST', 200, true, 'rest', 'agent/1'],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['x402_0x2222', 'GET /v1/demo', 'GET', 200, false, 'rest', 'agent/2'],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['ip_a', 'mcp:initialize', 'POST', 200, false, 'mcp', 'agent/2'],
    );
    await db.query(
      `INSERT INTO request_logs (client_key, endpoint, method, status, paid, source, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ['ip_a', 'mcp:tools/list', 'POST', 200, false, 'mcp', 'agent/2'],
    );

    const data = await runStats(db);
    const g = data.growth as {
      funnel: Record<string, number>;
      free_demo_calls: number;
    };
    const f = g.funnel;
    // distinct client keys: x402_0x1111, x402_0x2222, ip_a
    expect(f.discovered).toBe(3);
    expect(f.queried).toBe(3);
    expect(f.initialized).toBe(1); // one mcp:initialize, reused from mcp_discovery
    expect(f.demo).toBe(g.free_demo_calls); // demo funnel stage mirrors free_demo_calls
    expect(f.paid).toBe(2);
    expect(f.repeated).toBe(1);
    expect(f.revenue).toBe(1.5); // 3 x402 rows x $0.50
    expect(f.discovered).toBeGreaterThanOrEqual(f.queried);
    expect(f.queried).toBeGreaterThanOrEqual(f.paid);
    expect(f.paid).toBeGreaterThanOrEqual(f.repeated);
    for (const k of Object.keys(f)) {
      expect(typeof f[k]).toBe('number');
      expect(f[k]).toBeGreaterThanOrEqual(0);
    }
  });
});
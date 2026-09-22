// /v1/stats `payments` block (payments-dashboard-visibility): the aggregate
// must expose settled count/revenue and distinct payers explicitly, so the
// dashboard can render real payment activity instead of $0. by_status alone
// hid settled revenue behind an operator-hostile shape (fixtures 2026-09-22:
// 38 settled / $2.81 while successes=0 and revenue_usd=0).

import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import { statsHandler } from '../../src/api/routes/stats.js';
import { createMetrics } from '../../src/obs/metrics.js';
import { createLogger } from '../../src/obs/log.js';
import { makeTestConfig } from './testconfig.js';

const config = makeTestConfig({ operatorKey: 'payments-agg-operator' });

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

async function makeStatsDb(): Promise<Db> {
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

describe('GET /v1/stats payments aggregate (dashboard visibility)', () => {
  it('exposes settled_count, settled_revenue_usd and payers on an empty database', async () => {
    const db = await makeStatsDb();
    const data = await runStats(db);
    expect(data.payments).toMatchObject({
      settled_count: 0,
      settled_revenue_usd: 0,
      payers: 0,
    });
  });

  it('counts settled rows, sums settled revenue and counts distinct payers (dev success rows excluded)', async () => {
    const db = await makeStatsDb();
    const insert = (proof: string, amount: string, status: string, payer: string | null, endpoint = 'GET /v1/search') =>
      db.query(
        `INSERT INTO payments (endpoint, amount_usd, provider, proof, status, payer_address, network)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [endpoint, amount, 'x402', proof, status, payer, payer ? 'eip155:8453' : null],
      );
    await insert('p1', '0.50', 'settled', '0x1111');
    await insert('p2', '0.75', 'settled', '0x1111');
    await insert('p3', '0.25', 'settled', '0x2222');
    // dev-mode payment: status 'success', no payer_address — NOT settled revenue/dollars
    await insert('p4', '9.99', 'success', null);
    const data = (await runStats(db)) as {
      payments: Record<string, unknown>;
      payment_health: { settled: { count: number; amount_usd: number } };
    };
    expect(data.payments).toMatchObject({
      settled_count: 3,
      settled_revenue_usd: 1.5,
      payers: 2,
    });
    // Legacy keys stay intact for existing consumers/tests.
    expect((data.payments as Record<string, unknown>).successes).toBeDefined();
    // payment_health.settled and payments.settled_count must agree (same source).
    expect(data.payment_health.settled).toMatchObject({ count: 3, amount_usd: 1.5 });
  });
});

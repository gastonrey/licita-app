// GET /v1/stats/payments: operator-only payment-attempt feed. 401 without/with
// wrong key, 200 + envelope with the right key and a fake db, limit clamping,
// date-window args on both tables, and the unified newest-first attempt shape
// (successes from `payments`, failures from `request_logs`).

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { Db } from '../../src/db/client.js';
import { makeTestConfig } from './testconfig.js';
import { paymentsStatsHandler, statsAuth } from '../../src/api/routes/stats.js';
import { createMetrics } from '../../src/obs/metrics.js';
import { createLogger } from '../../src/obs/log.js';

const OPERATOR_KEY = 'payments-operator-key';

const PAYMENT_ROW = {
  ts: new Date('2026-09-06T12:00:00.000Z'),
  endpoint: 'GET /v1/research',
  amount_usd: 1.25,
  provider: 'x402',
  status: 'settled',
  payer_address: '0xabc123',
  tx_hash: '0xtx123456789',
  network: 'base',
};

const FAILURE_ROW = {
  ts: new Date('2026-09-07T09:00:00.000Z'),
  endpoint: 'GET /v1/search',
  method: 'GET',
  status: 402,
  error: 'verify_failed',
  paid: false,
  client_key: 'x402_0xabc123',
  source: 'rest',
};

function fakeDb(rowsByQuery: { payments?: unknown[]; failures?: unknown[] }) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      const rows = text.includes('FROM payments')
        ? (rowsByQuery.payments ?? [])
        : text.includes('request_logs')
          ? (rowsByQuery.failures ?? [])
          : [];
      return { rows };
    },
    on: () => undefined,
    end: async () => undefined,
  } as unknown as Db;
  return { db, calls };
}

function buildApp(rowsByQuery: { payments?: unknown[]; failures?: unknown[] }) {
  const { db, calls } = fakeDb(rowsByQuery);
  const config = makeTestConfig({ operatorKey: OPERATOR_KEY });
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    void reply.code(status).send({ error: { code: 'invalid_query', message: err.message } });
  });
  const ctx = { config, db, log: createLogger('error'), metrics: createMetrics() };
  app.get('/v1/stats/payments', { preHandler: [statsAuth(OPERATOR_KEY)] }, paymentsStatsHandler(ctx));
  return { app, calls };
}

describe('GET /v1/stats/payments', () => {
  it('401 without the operator key', async () => {
    const { app } = buildApp({});
    const res = await app.inject({ method: 'GET', url: '/v1/stats/payments' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'invalid_query' } });
    await app.close();
  });

  it('401 on a wrong operator key', async () => {
    const { app } = buildApp({});
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats/payments',
      headers: { 'x-operator-key': 'not-the-key' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('200 with the right key returns the unified newest-first attempts envelope', async () => {
    const { app } = buildApp({ payments: [PAYMENT_ROW], failures: [FAILURE_ROW] });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats/payments',
      headers: { 'x-operator-key': OPERATOR_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toMatchObject({ price_usd: '0.00', paid: false });
    // Newest first: the failure (Sep 7) sorts above the payment (Sep 6).
    expect(body.data.attempts).toEqual([
      {
        ts: '2026-09-07T09:00:00.000Z',
        kind: 'failure',
        endpoint: 'GET /v1/search',
        method: 'GET',
        status: 402,
        error: 'verify_failed',
        paid: false,
        client_key: 'x402_0xabc123',
        source: 'rest',
      },
      {
        ts: '2026-09-06T12:00:00.000Z',
        kind: 'payment',
        endpoint: 'GET /v1/research',
        provider: 'x402',
        status: 'settled',
        amount_usd: 1.25,
        payer_address: '0xabc123',
        tx_hash: '0xtx123456789',
        network: 'base',
      },
    ]);
    await app.close();
  });

  it('defaults limit to 50 and clamps > 200 to 200 on both table queries', async () => {
    const cases: Array<[string, number]> = [
      ['/v1/stats/payments', 50],
      ['/v1/stats/payments?limit=abc', 50],
      ['/v1/stats/payments?limit=0', 50],
      ['/v1/stats/payments?limit=200', 200],
      ['/v1/stats/payments?limit=9999', 200],
      ['/v1/stats/payments?limit=10', 10],
    ];
    for (const [url, expected] of cases) {
      const { app, calls } = buildApp({});
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-operator-key': OPERATOR_KEY },
      });
      expect(res.statusCode).toBe(200);
      expect(calls).toHaveLength(2);
      expect(calls[0].values[0]).toBe(expected);
      expect(calls[1].values[0]).toBe(expected);
      await app.close();
    }
  });

  it('passes the selected date window to both the payments and request_logs queries', async () => {
    const { app, calls } = buildApp({});
    const res = await app.inject({ method: 'GET', url: '/v1/stats/payments?from=2026-08-01&to=2026-08-17', headers: { 'x-operator-key': OPERATOR_KEY } });
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('created_at >= $2 AND created_at < $3');
    expect(calls[1].text).toContain('ts >= $2 AND ts < $3');
    expect(calls[0].values).toEqual([50, new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-18T00:00:00.000Z')]);
    expect(calls[1].values).toEqual(calls[0].values);
    await app.close();
  });
});
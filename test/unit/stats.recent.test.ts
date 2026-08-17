// GET /v1/stats/recent: operator-only raw request-log feed. 401 without/with
// wrong key, 200 + envelope with the right key and a fake db, limit clamping.

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { Db } from '../../src/db/client.js';
import { makeTestConfig } from './testconfig.js';
import { recentStatsHandler, statsAuth } from '../../src/api/routes/stats.js';
import { createMetrics } from '../../src/obs/metrics.js';
import { createLogger } from '../../src/obs/log.js';

const OPERATOR_KEY = 'dashboard-operator-key';

const FAKE_ROW = {
  ts: '2026-08-17T10:00:00.000Z',
  client_key: 'ip_abc123',
  endpoint: 'GET /v1/search',
  method: 'GET',
  status: 200,
  latency_ms: 12,
  paid: true,
  source: 'rest',
  user_agent: 'curl/8.1',
  q: 'software',
  cpv: null,
  buyer: null,
  company: null,
  error: null,
};

function fakeDb(rows: unknown[]): { db: Db; calls: Array<{ text: string; values: unknown[] }> } {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows };
    },
    on: () => undefined,
    end: async () => undefined,
  } as unknown as Db;
  return { db, calls };
}

function buildApp(rows: unknown[]) {
  const { db, calls } = fakeDb(rows);
  const config = makeTestConfig({ operatorKey: OPERATOR_KEY });
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, _req, reply) => {
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    void reply.code(status).send({ error: { code: 'invalid_query', message: err.message } });
  });
  const ctx = { config, db, log: createLogger('error'), metrics: createMetrics() };
  app.get('/v1/stats/recent', { preHandler: [statsAuth(OPERATOR_KEY)] }, recentStatsHandler(ctx));
  return { app, calls };
}

describe('GET /v1/stats/recent', () => {
  it('401 without the operator key', async () => {
    const { app } = buildApp([FAKE_ROW]);
    const res = await app.inject({ method: 'GET', url: '/v1/stats/recent' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'invalid_query' } });
    await app.close();
  });

  it('401 on a wrong operator key', async () => {
    const { app } = buildApp([FAKE_ROW]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats/recent',
      headers: { 'x-operator-key': 'not-the-key' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('200 with the right key returns the envelope with the injected rows', async () => {
    const { app } = buildApp([FAKE_ROW]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats/recent',
      headers: { 'x-operator-key': OPERATOR_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([FAKE_ROW]);
    expect(body.meta).toMatchObject({
      price_usd: '0.00',
      paid: false,
      provenance: [],
    });
    expect(typeof body.meta.request_id).toBe('string');
    await app.close();
  });

  it('defaults limit to 50 when absent or invalid, clamps > 200 to 200', async () => {
    const cases: Array<[string, number]> = [
      ['/v1/stats/recent', 50],
      ['/v1/stats/recent?limit=abc', 50],
      ['/v1/stats/recent?limit=-5', 50],
      ['/v1/stats/recent?limit=0', 50],
      ['/v1/stats/recent?limit=200', 200],
      ['/v1/stats/recent?limit=9999', 200],
      ['/v1/stats/recent?limit=10', 10],
    ];
    for (const [url, expected] of cases) {
      const { app, calls } = buildApp([]);
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-operator-key': OPERATOR_KEY },
      });
      expect(res.statusCode).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0].values[0]).toBe(expected);
      await app.close();
    }
  });
});
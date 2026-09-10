// C2.2 Rate-limit parity (fiat-revenue-rails, spec creem-subscriptions SS8 +
// shared MUST-NOT S1). The public capture endpoint (POST /v1/demo/request)
// MUST share the same ip-keyed bucket and 429 envelope as every other route,
// and the Creem webhook MUST stay exempt from that limiter — even when the
// shared bucket is exhausted — because signature verification is its own
// throttle. Regression: webhook exemption works under an exhausted bucket.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../src/config.js';
import type { Db } from '../../src/db/client.js';
import { buildServer } from '../../src/api/server.js';
import { makeTestConfig } from './testconfig.js';

// Creem enabled so the webhook route is live for the exemption probe.
const CONFIG: AppConfig = makeTestConfig({
  creem: {
    enabled: true,
    apiKey: 'creem_test_placeholder',
    webhookSecret: 'whsec_test_placeholder',
    productId: 'prod_creem_placeholder',
    priceCents: 2900,
  },
});

// Minimal fake db for the capture route + request logging (same idiom as the
// api-smoke suite). The shared pg-mem TEST_SCHEMA intentionally has no
// demo_requests table (demo.funnel.test.ts pins the 500-on-missing-table
// path), so the rate-limit probes use a local stub instead.
function fakeDb(): Db {
  const db = {
    query: async (text: string) => {
      const t = text.replace(/\s+/g, ' ');
      if (t.includes('INSERT INTO request_logs')) return { rows: [] };
      if (t.includes('INSERT INTO demo_requests')) {
        return { rows: [{ id: 1, email: 'x@example.com', channel: 'direct', source_url: null, status: 'new', created_at: new Date().toISOString() }] };
      }
      if (t.includes('DELETE FROM demo_requests')) return { rows: [] };
      return { rows: [] };
    },
    end: async () => undefined,
  };
  return db as unknown as Db;
}

interface ErrorEnvelope {
  error: { code: string; message: string; hint?: string };
}

describe('rate-limit parity (C2.2)', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = fakeDb();
    app = await buildServer(CONFIG, db);
  });

  afterEach(async () => {
    await app.close();
  });

  it('captures 429 on the public lead-capture endpoint after the shared bucket is drained', async () => {
    let last: number | null = null;
    for (let i = 0; i < 61; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/demo/request',
        payload: { email: `lead${i}@example.com` },
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
    // The 61st request is above the 60/min capacity: the capture endpoint is
    // inside the same global bucket as every other route.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/demo/request',
      payload: { email: 'one-more@example.com' },
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    const body = res.json() as ErrorEnvelope;
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.message).toContain('per minute');
  });

  it('returns the identical 429 envelope shape on a normal route from the drained bucket', async () => {
    for (let i = 0; i < 61; i++) {
      await app.inject({ method: 'POST', url: '/v1/demo/request', payload: { email: `a${i}@example.com` } });
    }
    const capture = await app.inject({ method: 'POST', url: '/v1/demo/request', payload: { email: 'x@example.com' } });
    // The shared bucket is still empty → a normal route trips the same 429.
    const normal = await app.inject({ method: 'GET', url: '/v1/pricing' });
    expect(normal.statusCode).toBe(429);
    const capBody = capture.json() as ErrorEnvelope;
    const normBody = normal.json() as ErrorEnvelope;
    expect(capBody.error).toEqual(normBody.error);
    expect(String(normal.headers['retry-after'])).toBe(String(capture.headers['retry-after']));
  });

  it('webhook stays exempt from the ip-keyed limiter even with an exhausted bucket', async () => {
    // Drain the shared ip bucket via the public capture endpoint.
    for (let i = 0; i < 61; i++) {
      await app.inject({ method: 'POST', url: '/v1/demo/request', payload: { email: `b${i}@example.com` } });
    }
    // 25 unsigned webhook POSTs from the same IP while the bucket is empty.
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/creem/webhook',
        payload: '{}',
        headers: { 'content-type': 'application/json' },
      });
      // Fail-closed signature check answers 401 — the request REACHED the
      // handler, proving the limiter never intercepted it (no 429 anywhere).
      expect(res.statusCode).toBe(401);
      const body = res.json() as ErrorEnvelope;
      expect(body.error.code).toBe('invalid_signature');
    }
  });
});
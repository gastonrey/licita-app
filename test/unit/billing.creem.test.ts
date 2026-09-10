// B2.3 + B2.5 Creem MoR REST routes: POST /v1/creem/webhook (signature-verified
// checkout completion) and POST /v1/creem/checkout (session creation).
// Both flag-gated by CREEM_ENABLED (off → 404).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../src/config.js';
import type { Db } from '../../src/db/client.js';
import { buildServer } from '../../src/api/server.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { makeTestConfig } from './testconfig.js';
import { makeTestDb, countRows } from './testdb.js';

// ── fetch mock (Creem uses native fetch) ─────────────────────────────────
const mocks = {
  fetch: vi.fn(),
};
vi.stubGlobal('fetch', mocks.fetch);

const OFF = makeTestConfig({
  creem: { enabled: false, apiKey: '', webhookSecret: '', productId: '', priceCents: 2900 },
});
const ON = makeTestConfig({
  creem: {
    enabled: true,
    apiKey: 'creem_test_placeholder',
    webhookSecret: 'whsec_creem_placeholder',
    productId: 'prod_creem_placeholder',
    priceCents: 2900,
  },
});

/** Valid Creem HMAC-SHA256 signature over the raw payload. */
function creemSignature(payload: string, secret = 'whsec_creem_placeholder'): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('POST /v1/creem/webhook', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    mocks.fetch.mockReset();
    db = await makeTestDb();
    app = await buildServer(ON, db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('verifies signature and completes checkout for a checkout.completed event', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_1',
      eventType: 'checkout.completed',
      object: { customer: { email: 'alice@example.com' }, amount_total: 2900, id: 'cs_test_1' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/webhook',
      headers: { 'content-type': 'application/json', 'creem-signature': creemSignature(payload) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const rows = await db.query(`SELECT kind, email FROM api_clients WHERE lower(email) = lower($1)`, [
      'alice@example.com',
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ kind: 'creem', email: 'alice@example.com' });
    expect(await countRows(db, 'credit_accounts')).toBe(0);
  });

  it('rejects a bad signature with 401 and applies no state change', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_2',
      eventType: 'checkout.completed',
      object: { customer: { email: 'bob@example.com' }, amount_total: 2900, id: 'cs_test_2' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/webhook',
      headers: { 'content-type': 'application/json', 'creem-signature': 'deadbeef0000000000000000000000000000000000000000000000000000dead' },
      payload,
    });
    expect(res.statusCode).toBe(401);
    expect(await countRows(db, 'api_clients')).toBe(0);
    expect(await countRows(db, 'credit_accounts')).toBe(0);
  });

  it('rejects an unparseable completed event (missing email) with 400', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_3',
      eventType: 'checkout.completed',
      object: { amount_total: 2900, id: 'cs_test_3' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/webhook',
      headers: { 'content-type': 'application/json', 'creem-signature': creemSignature(payload) },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(await countRows(db, 'api_clients')).toBe(0);
  });

  it('acks non-completed events with 200 without side effects', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_4',
      eventType: 'invoice.paid',
      object: { id: 'in_1' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/webhook',
      headers: { 'content-type': 'application/json', 'creem-signature': creemSignature(payload) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await countRows(db, 'api_clients')).toBe(0);
  });

  it('404s when CREEM_ENABLED=false', async () => {
    const disabledApp = await buildServer(OFF, db);
    const payload = JSON.stringify({ eventType: 'checkout.completed', object: {} });
    const res = await disabledApp.inject({
      method: 'POST',
      url: '/v1/creem/webhook',
      headers: { 'content-type': 'application/json', 'creem-signature': creemSignature(payload) },
      payload,
    });
    expect(res.statusCode).toBe(404);
    await disabledApp.close();
  });
});

describe('POST /v1/creem/checkout', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ checkout_url: 'https://checkout.creem.io/c/pay/cs_test_new' }),
    });
    db = await makeTestDb();
    app = await buildServer(ON, db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('creates a checkout session with the email and returns the URL as 303', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/checkout',
      payload: {
        email: 'carol@example.com',
        successUrl: 'https://licita.example/?checkout=success',
        cancelUrl: 'https://licita.example/pricing',
      },
    });
    expect(res.statusCode).toBe(303);
    const body = res.json();
    expect(body.data.url).toBe('https://checkout.creem.io/c/pay/cs_test_new');
    const [, options] = mocks.fetch.mock.calls[0];
    const reqBody = JSON.parse(options.body);
    expect(reqBody.customer.email).toBe('carol@example.com');
    expect(reqBody.product_id).toBe('prod_creem_placeholder');
  });

  it('404s with payment_disabled failure kind when CREEM_ENABLED=false', async () => {
    const disabledApp = await buildServer(OFF, db);
    const res = await disabledApp.inject({
      method: 'POST',
      url: '/v1/creem/checkout',
      payload: { email: 'carol@example.com', successUrl: 'https://licita.example/s', cancelUrl: 'https://licita.example/c' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    // paymentFailureKind surfaces in request_logs.error for the operator view
    const logs = await db.query(`SELECT error FROM request_logs WHERE endpoint = 'POST /v1/creem/checkout'`);
    expect(logs.rows.length).toBeGreaterThan(0);
    expect(logs.rows[logs.rows.length - 1]).toMatchObject({ error: 'payment_disabled' });
    await disabledApp.close();
  });

  it('rejects an invalid email with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/checkout',
      payload: { email: 'not-an-email', successUrl: 'https://licita.example/s', cancelUrl: 'https://licita.example/c' },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

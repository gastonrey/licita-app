// B2.3 + B2.5 Stripe REST routes: POST /v1/stripe/webhook (signature-verified
// checkout completion) and POST /v1/stripe/checkout (session creation).
// Both flag-gated by STRIPE_ENABLED (off → 404).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../src/config.js';
import type { Db } from '../../src/db/client.js';
import { buildServer } from '../../src/api/server.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { makeTestConfig } from './testconfig.js';
import { makeTestDb, countRows } from './testdb.js';

// ── Stripe SDK mock (for the checkout route) ─────────────────────────────
const mocks = {
  create: vi.fn(),
};
vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    checkout: { sessions: { create: mocks.create } },
  })),
}));

const OFF = makeTestConfig({
  stripe: { enabled: false, secretKey: '', webhookSecret: '', priceCents: 2900 },
});
const ON = makeTestConfig({
  stripe: {
    enabled: true,
    secretKey: 'sk_test_placeholder',
    webhookSecret: 'whsec_test_placeholder',
    priceCents: 2900,
  },
});

/** Valid Stripe v1 signature header over the given payload (test secret). */
function stripeSignature(payload: string, secret = 'whsec_test_placeholder', timestampSec?: number): string {
  const ts = (timestampSec ?? Math.floor(Date.now() / 1000)).toString();
  const sig = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

describe('POST /v1/stripe/webhook', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    mocks.create.mockReset();
    db = await makeTestDb();
    app = await buildServer(ON, db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('verifies signature and completes checkout for a checkout.session.completed event', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_1',
      type: 'checkout.session.completed',
      data: { object: { customer_email: 'alice@example.com', amount_total: 2900, id: 'cs_test_1' } },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(payload) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const rows = await db.query(`SELECT kind, email FROM api_clients WHERE lower(email) = lower($1)`, [
      'alice@example.com',
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ kind: 'stripe', email: 'alice@example.com' });
    expect(await countRows(db, 'credit_accounts')).toBe(0);
  });

  it('rejects a bad signature with 401 and applies no state change', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_2',
      type: 'checkout.session.completed',
      data: { object: { customer_email: 'bob@example.com', amount_total: 2900, id: 'cs_test_2' } },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
      payload,
    });
    expect(res.statusCode).toBe(401);
    expect(await countRows(db, 'api_clients')).toBe(0);
    expect(await countRows(db, 'credit_accounts')).toBe(0);
  });

  it('rejects an unparseable completed event (missing email) with 400', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_3',
      type: 'checkout.session.completed',
      data: { object: { amount_total: 2900, id: 'cs_test_3' } },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(payload) },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(await countRows(db, 'api_clients')).toBe(0);
  });

  it('acks non-completed events with 200 without side effects', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_4',
      type: 'invoice.paid',
      data: { object: { id: 'in_1' } },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(payload) },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await countRows(db, 'api_clients')).toBe(0);
  });

  it('404s when STRIPE_ENABLED=false', async () => {
    const disabledApp = await buildServer(OFF, db);
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
    const res = await disabledApp.inject({
      method: 'POST',
      url: '/v1/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(payload) },
      payload,
    });
    expect(res.statusCode).toBe(404);
    await disabledApp.close();
  });
});

describe('POST /v1/stripe/checkout', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    mocks.create.mockReset();
    db = await makeTestDb();
    app = await buildServer(ON, db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('creates a checkout session with the email and returns the URL as 303', async () => {
    mocks.create.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_new' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/checkout',
      payload: {
        email: 'carol@example.com',
        successUrl: 'https://licita.example/?checkout=success',
        cancelUrl: 'https://licita.example/pricing',
      },
    });
    expect(res.statusCode).toBe(303);
    const body = res.json();
    expect(body.data.url).toBe('https://checkout.stripe.com/c/pay/cs_test_new');
    const args = mocks.create.mock.calls[0][0];
    expect(args.customer_email).toBe('carol@example.com');
    expect(args.mode).toBe('subscription');
    expect(args.line_items[0].price_data.unit_amount).toBe(2900);
    expect(args.line_items[0].price_data.currency).toBe('eur');
  });

  it('404s with payment_disabled failure kind when STRIPE_ENABLED=false', async () => {
    const disabledApp = await buildServer(OFF, db);
    const res = await disabledApp.inject({
      method: 'POST',
      url: '/v1/stripe/checkout',
      payload: { email: 'carol@example.com', successUrl: 'https://licita.example/s', cancelUrl: 'https://licita.example/c' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    // paymentFailureKind surfaces in request_logs.error for the operator view
    const logs = await db.query(`SELECT error FROM request_logs WHERE endpoint = 'POST /v1/stripe/checkout'`);
    expect(logs.rows.length).toBeGreaterThan(0);
    expect(logs.rows[logs.rows.length - 1]).toMatchObject({ error: 'payment_disabled' });
    await disabledApp.close();
  });

  it('rejects an invalid email with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/checkout',
      payload: { email: 'not-an-email', successUrl: 'https://licita.example/s', cancelUrl: 'https://licita.example/c' },
    });
    expect(res.statusCode).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
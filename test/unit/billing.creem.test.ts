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

  // C1.1 webhook idempotency: INSERT ON CONFLICT (event_id) DO NOTHING.
  it('treats a replayed event id as an idempotent 200 replay:true and never re-applies effects', async () => {
    const payload = JSON.stringify({
      id: 'evt_replay_1',
      eventType: 'checkout.completed',
      object: { customer: { email: 'replay@example.com' }, amount_total: 2900, id: 'cs_replay_1' },
    });
    const headers = { 'content-type': 'application/json', 'creem-signature': creemSignature(payload) };
    const first = await app.inject({ method: 'POST', url: '/v1/creem/webhook', headers, payload });
    expect(first.statusCode).toBe(200);

    // First delivery: exactly one client row and one webhook_events row.
    let rows = await db.query(`SELECT kind, email FROM api_clients WHERE lower(email) = lower($1)`, [
      'replay@example.com',
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(await countRows(db, 'webhook_events')).toBe(1);

    // Second delivery of the SAME event id: 200 replay:true, no double-grant,
    // no second webhook_events row, no extra api_clients row.
    const second = await app.inject({ method: 'POST', url: '/v1/creem/webhook', headers, payload });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ ok: true, replay: true });

    rows = await db.query(`SELECT kind, email FROM api_clients WHERE lower(email) = lower($1)`, [
      'replay@example.com',
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(await countRows(db, 'webhook_events')).toBe(1);
  });

  it('records the event type and status in webhook_events', async () => {
    const payload = JSON.stringify({
      id: 'evt_record_1',
      eventType: 'checkout.completed',
      object: { customer: { email: 'record@example.com' }, amount_total: 2900, id: 'cs_record_1' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/webhook',
      headers: { 'content-type': 'application/json', 'creem-signature': creemSignature(payload) },
      payload,
    });
    expect(res.statusCode).toBe(200);

    const evRows = await db.query(
      `SELECT event_id, type, status FROM webhook_events WHERE event_id = $1`,
      ['evt_record_1'],
    );
    expect(evRows.rows).toHaveLength(1);
    expect(evRows.rows[0]).toMatchObject({
      event_id: 'evt_record_1',
      type: 'checkout.completed',
      status: 'completed',
    });
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

const TEST_PLAN_IDS = {
  radarMonthly: 'prod_DQLeAZkGLgSWSBe79doNr',
  radarAnnual: 'prod_39q3c29aWwXvkE4pqU4YUT',
  proMonthly: 'prod_4Iyrui9hjVwSeftMImc9Yg',
  proAnnual: 'prod_3vkS91sGzp4aueHBuRCNEH',
  teamMonthly: 'prod_5z4JBpuINvsVJNU0avrcy0',
};

function planConfig(plans: Partial<typeof TEST_PLAN_IDS> = TEST_PLAN_IDS) {
  return makeTestConfig({
    creem: {
      enabled: true,
      apiKey: 'creem_test_placeholder',
      webhookSecret: 'whsec_creem_placeholder',
      productId: 'prod_creem_placeholder',
      priceCents: 2900,
      plans: { ...TEST_PLAN_IDS, ...plans },
    },
  });
}

describe('POST /v1/creem/checkout plan products', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ checkout_url: 'https://checkout.creem.io/c/pay/cs_plan' }),
    });
    db = await makeTestDb();
    app = await buildServer(planConfig(), db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('keeps a checkout without plan on the legacy CREEM_PRODUCT_ID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/checkout',
      payload: { email: 'legacy@example.com', successUrl: 'https://licita.example/s', cancelUrl: 'https://licita.example/c' },
    });
    expect(res.statusCode).toBe(303);
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.product_id).toBe('prod_creem_placeholder');
  });

  it('charges the annual Radar test product and not the legacy id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/checkout',
      payload: {
        email: 'radar@example.com',
        plan: 'radar',
        interval: 'annual',
        successUrl: 'https://licita.example/s',
        cancelUrl: 'https://licita.example/c',
      },
    });
    expect(res.statusCode).toBe(303);
    expect(res.json().data.url).toBe('https://checkout.creem.io/c/pay/cs_plan');
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.product_id).toBe(TEST_PLAN_IDS.radarAnnual);
    expect(body.product_id).not.toBe('prod_creem_placeholder');
  });

  it('defaults a plan with no interval to the monthly product', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/checkout',
      payload: { email: 'pro@example.com', plan: 'pro', successUrl: 'https://licita.example/s', cancelUrl: 'https://licita.example/c' },
    });
    expect(res.statusCode).toBe(303);
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body.product_id).toBe(TEST_PLAN_IDS.proMonthly);
  });

  it('returns 409 and does not call Creem when the chosen plan product is unset', async () => {
    await app.close();
    app = await buildServer(planConfig({ radarMonthly: '' }), db);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/checkout',
      payload: { email: 'radar@example.com', plan: 'radar', interval: 'monthly', successUrl: 'https://licita.example/s', cancelUrl: 'https://licita.example/c' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('invalid_query');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects Team annual because that price does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/checkout',
      payload: { email: 'team@example.com', plan: 'team', interval: 'annual', successUrl: 'https://licita.example/s', cancelUrl: 'https://licita.example/c' },
    });
    expect(res.statusCode).toBe(422);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('POST /v1/creem/webhook plan products', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    mocks.fetch.mockReset();
    db = await makeTestDb();
    app = await buildServer(planConfig(), db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  async function post(event: Record<string, unknown>) {
    const payload = JSON.stringify(event);
    return app.inject({
      method: 'POST',
      url: '/v1/creem/webhook',
      headers: { 'content-type': 'application/json', 'creem-signature': creemSignature(payload) },
      payload,
    });
  }

  it('activates a subscription when the product is a plan id, not CREEM_PRODUCT_ID', async () => {
    const res = await post({
      id: 'evt_radar_annual',
      eventType: 'checkout.completed',
      object: {
        id: 'cs_radar',
        customer: { email: 'annual@example.com' },
        product: { id: TEST_PLAN_IDS.radarAnnual },
      },
    });
    expect(res.statusCode).toBe(200);
    const rows = await db.query(`SELECT kind FROM api_clients WHERE lower(email) = lower($1)`, ['annual@example.com']);
    expect(rows.rows).toEqual([{ kind: 'creem' }]);
  });

  it('still activates the legacy product id', async () => {
    const res = await post({
      id: 'evt_legacy',
      eventType: 'checkout.completed',
      object: {
        id: 'cs_legacy',
        customer: { email: 'legacy@example.com' },
        product_id: 'prod_creem_placeholder',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(await countRows(db, 'api_clients')).toBe(1);
  });

  it('still activates an event that carries no product id', async () => {
    const res = await post({
      id: 'evt_noproduct',
      eventType: 'checkout.completed',
      object: { id: 'cs_none', customer: { email: 'none@example.com' } },
    });
    expect(res.statusCode).toBe(200);
    expect(await countRows(db, 'api_clients')).toBe(1);
  });

  it('acknowledges an unknown product id without granting a subscription', async () => {
    const res = await post({
      id: 'evt_unknown',
      eventType: 'checkout.completed',
      object: {
        id: 'cs_unknown',
        customer: { email: 'stranger@example.com' },
        product: { id: 'prod_not_configured' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(await countRows(db, 'api_clients')).toBe(0);
  });
});

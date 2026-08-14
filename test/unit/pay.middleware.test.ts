// paymentPreHandler 402/paid/free paths + dev faucet endpoint.
// Uses a real DevPaymentProvider against pg-mem, and a stub provider for the
// generic middleware contract.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import type { AppConfig } from '../../src/config.js';
import type { PaymentProvider, PaymentVerification } from '../../src/domain/types.js';
import { initPayments, getPaymentProvider, paymentPreHandler, resetPayments } from '../../src/pay/middleware.js';
import { DevPaymentProvider, registerDevFaucet } from '../../src/pay/devProvider.js';
import { X402PaymentProvider } from '../../src/pay/provider.js';
import { makeTestConfig } from './testconfig.js';

const SECRET = 'mw-test-secret';

const config: AppConfig = makeTestConfig({ payHmacSecret: SECRET, operatorKey: 'op' });

function makeDb(): Db {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  return new Pool() as unknown as Db;
}

const PAYMENTS_DDL = `
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint,
  endpoint text NOT NULL, amount_usd numeric NOT NULL, provider text NOT NULL,
  proof text UNIQUE NOT NULL, status text NOT NULL, created_at timestamptz DEFAULT now()
);
`;

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/v1/search', { preHandler: [paymentPreHandler('GET /v1/search')] }, async (req) => ({
    ok: true,
    payment: req.payment ?? null,
  }));
  app.get('/v1/pricing', { preHandler: [paymentPreHandler('GET /v1/pricing')] }, async (req) => ({
    ok: true,
    payment: req.payment ?? null,
  }));
  return app;
}

describe('paymentPreHandler', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    resetPayments();
    db = makeDb();
    await db.query(PAYMENTS_DDL);
    initPayments(config, db);
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('free endpoint: marks payment {paid:true, priceUsd:"0.00"} and continues', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/pricing' });
    expect(res.statusCode).toBe(200);
    expect(res.json().payment).toEqual({ paid: true, priceUsd: '0.00' });
  });

  it('missing X-PAYMENT → 402 x402-shaped body + error envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/search' });
    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.x402Version).toBe(1);
    expect(body.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'dev',
      asset: 'USD',
      amount: '0.02',
      payTo: 'dev-faucet',
      resource: 'GET /v1/search',
    });
    expect(body.hint).toContain('POST /v1/dev-faucet');
    expect(body.error.code).toBe('payment_required');
    expect(body.error.hint).toBe(body.hint);
  });

  it('invalid proof → 402 with reason in the message', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search',
      headers: { 'x-payment': 'garbage.token' },
    });
    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.error.code).toBe('payment_required');
    expect(body.error.message).toContain('invalid_signature');
  });

  it('valid proof → handler runs with payment set; payment row recorded', async () => {
    const signer = new DevPaymentProvider({ secret: SECRET });
    const { token } = signer.createToken('GET /v1/search');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search',
      headers: { 'x-payment': token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.payment.paid).toBe(true);
    expect(body.payment.priceUsd).toBe('0.02');
    expect(body.payment.clientKey).toMatch(/^dev_[0-9a-f]{16}$/);
    const rows = await db.query(`SELECT status FROM payments`);
    expect(rows.rows).toEqual([{ status: 'success' }]);
  });

  it('replay of a consumed proof → 402 (reason replay)', async () => {
    const signer = new DevPaymentProvider({ secret: SECRET });
    const { token } = signer.createToken('GET /v1/search');
    const first = await app.inject({ method: 'GET', url: '/v1/search', headers: { 'x-payment': token } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'GET', url: '/v1/search', headers: { 'x-payment': token } });
    expect(second.statusCode).toBe(402);
    expect(second.json().error.message).toContain('replay');
  });
});

describe('paymentPreHandler with a stub provider', () => {
  afterEach(() => resetPayments());

  it('uses provider.requiredResponse and accepts any provider via initPayments seam', async () => {
    // x402-mode provider: verify never succeeds, 402 reflects facilitator config.
    resetPayments();
    const x402config: AppConfig = {
      ...config,
      paymentsMode: 'x402',
      x402: { facilitatorUrl: 'https://facilitator.example', payTo: '0xabc', network: 'base' },
    };
    initPayments(x402config, makeDb());
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/search' });
    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.accepts[0]).toMatchObject({ network: 'base', asset: 'USDC', payTo: '0xabc' });
    const paid = await app.inject({
      method: 'GET',
      url: '/v1/search',
      headers: { 'x-payment': 'any-proof' },
    });
    expect(paid.statusCode).toBe(402);
    expect(paid.json().error.message).toContain('x402_not_configured');
    await app.close();
  });

  it('generic PaymentProvider stub: middleware drives requiredResponse + verify', async () => {
    const stub: PaymentProvider = {
      name: 'stub',
      price: () => '9.99',
      requiredResponse: (endpoint) => ({
        x402Version: 1,
        accepts: [{ scheme: 'exact', network: 'stub', asset: 'USD', amount: '9.99', payTo: 'stub', resource: endpoint }],
        hint: 'stub hint',
      }),
      verify: async (proof): Promise<PaymentVerification> =>
        proof === 'good' ? { ok: true, amount: '9.99', clientKey: 'stub-client' } : { ok: false, reason: 'bad_proof' },
    };
    initPayments(config, makeDb(), stub);
    const app = buildApp();

    const unpaid = await app.inject({ method: 'GET', url: '/v1/search' });
    expect(unpaid.statusCode).toBe(402);
    expect(unpaid.json().accepts[0]).toMatchObject({ network: 'stub', amount: '9.99' });

    const bad = await app.inject({ method: 'GET', url: '/v1/search', headers: { 'x-payment': 'nope' } });
    expect(bad.statusCode).toBe(402);
    expect(bad.json().error.message).toContain('bad_proof');

    const good = await app.inject({ method: 'GET', url: '/v1/search', headers: { 'x-payment': 'good' } });
    expect(good.statusCode).toBe(200);
    expect(good.json().payment).toEqual({ paid: true, priceUsd: '9.99', clientKey: 'stub-client' });
    await app.close();
  });
});

describe('payment runtime initialization', () => {
  afterEach(() => resetPayments());

  it('getPaymentProvider throws a clear error before initPayments', () => {
    resetPayments();
    expect(() => getPaymentProvider()).toThrow(/not initialized/);
  });

  it('a paid request before initPayments fails loudly instead of building a shadow pool', async () => {
    resetPayments();
    const app = buildApp();
    app.setErrorHandler((err, _req, reply) => void reply.code(500).send({ error: String(err) }));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search',
      headers: { 'x-payment': 'any-proof' },
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain('not initialized');
    await app.close();
  });
});

describe('registerDevFaucet', () => {
  it('mints tokens for known priced endpoints (dev mode)', async () => {
    const app = Fastify({ logger: false });
    registerDevFaucet(app, config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev-faucet',
      payload: { endpoint: 'GET /v1/renewals' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.endpoint).toBe('GET /v1/renewals');
    expect(body.amount).toBe('0.25');
    expect(typeof body.token).toBe('string');
    expect(body.proof).toBe(body.token);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());

    // token actually verifies
    const db = makeDb();
    await db.query(PAYMENTS_DDL);
    const provider = new DevPaymentProvider({ secret: SECRET, db });
    expect((await provider.verify(body.token, 'GET /v1/renewals')).ok).toBe(true);
    await app.close();
  });

  it('rejects unknown endpoints, free endpoints and bad bodies', async () => {
    const app = Fastify({ logger: false });
    registerDevFaucet(app, config);
    const unknown = await app.inject({ method: 'POST', url: '/v1/dev-faucet', payload: { endpoint: 'GET /nope' } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe('invalid_query');
    const free = await app.inject({ method: 'POST', url: '/v1/dev-faucet', payload: { endpoint: 'GET /v1/pricing' } });
    expect(free.statusCode).toBe(400);
    expect(free.json().error.message).toContain('free');
    const bad = await app.inject({ method: 'POST', url: '/v1/dev-faucet', payload: {} });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('registers no route (404) when PAYMENTS_MODE is not dev', async () => {
    const app = Fastify({ logger: false });
    registerDevFaucet(app, { ...config, paymentsMode: 'x402' });
    const res = await app.inject({ method: 'POST', url: '/v1/dev-faucet', payload: { endpoint: 'GET /v1/search' } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('registers no route (404) in production even when PAYMENTS_MODE is dev', async () => {
    const app = Fastify({ logger: false });
    registerDevFaucet(app, { ...config, nodeEnv: 'production' });
    const res = await app.inject({ method: 'POST', url: '/v1/dev-faucet', payload: { endpoint: 'GET /v1/search' } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('registerWeb discovery surfaces', () => {
  it('serves /, /docs, /pricing, /llms.txt, /robots.txt and the faucet', async () => {
    const { registerWeb } = await import('../../src/web/pages.js');
    const app = Fastify({ logger: false });
    registerWeb(app, config);

    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.headers['content-type']).toContain('text/html');
    for (const marker of ['/docs', '/openapi.json', '/llms.txt', '/v1/pricing', '/mcp']) {
      expect(home.body).toContain(marker);
    }

    const docs = await app.inject({ method: 'GET', url: '/docs' });
    expect(docs.statusCode).toBe(200);
    expect(docs.body).toContain('curl');
    expect(docs.body).toContain('/v1/dev-faucet');
    expect(docs.body).toContain('X-PAYMENT');

    const pricing = await app.inject({ method: 'GET', url: '/pricing' });
    expect(pricing.statusCode).toBe(200);
    expect(pricing.body).toContain('GET /v1/renewals');
    expect(pricing.body).toContain('$0.25');

    const llms = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(llms.statusCode).toBe(200);
    expect(llms.headers['content-type']).toContain('text/plain');
    expect(llms.body).toContain('# licita-agent');
    expect(llms.body).toContain('payment_required');
    expect(llms.body).toContain('GET /v1/search');
    expect(llms.body).toContain('search_tenders');

    const robots = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(robots.statusCode).toBe(200);
    expect(robots.body).toContain('Allow: /');

    const faucet = await app.inject({
      method: 'POST',
      url: '/v1/dev-faucet',
      payload: { endpoint: 'GET /v1/search' },
    });
    expect(faucet.statusCode).toBe(200);
    expect(typeof faucet.json().token).toBe('string');
    await app.close();
  });
});

describe('X402PaymentProvider stub', () => {
  it('reports not-configured reasons and shapes 402 by config', async () => {
    const unconfigured = new X402PaymentProvider({});
    expect(await unconfigured.verify('proof', 'GET /v1/search')).toEqual({ ok: false, reason: 'x402_not_configured' });
    expect(unconfigured.requiredResponse('GET /v1/search').hint).toContain('not fully configured');

    const configured = new X402PaymentProvider({
      facilitatorUrl: 'https://fac.example',
      payTo: '0xdef',
      network: 'base',
    });
    expect(configured.requiredResponse('GET /v1/search').accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'base',
      asset: 'USDC',
      amount: '0.02',
      payTo: '0xdef',
      resource: 'GET /v1/search',
    });
    // still a seam, never a fake success:
    expect(await configured.verify('proof', 'GET /v1/search')).toEqual({ ok: false, reason: 'x402_not_configured' });
  });
});

// Discovery surfaces must teach an external agent the x402 v2 flow end to end
// (SPEC §10 P0.6): the 402 PAYMENT-REQUIRED header, the PAYMENT-SIGNATURE
// retry, the local-only dev faucet caveat, and the renewals honesty framing.
// These are content assertions on /llms.txt, /docs, /v1/pricing and the
// machine-readable payment_flow — the artifacts an autonomous agent reads.

import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from '../../src/config.js';
import { registerWeb } from '../../src/web/pages.js';
import { buildPricing } from '../../src/api/routes/pricing.js';
import { makeTestConfig } from './testconfig.js';

const config: AppConfig = makeTestConfig();

async function webApp(mode: AppConfig['paymentsMode'] = 'dev'): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerWeb(app, { ...config, paymentsMode: mode });
  return app;
}

describe('discovery surfaces teach the x402 v2 flow', () => {
  it('/llms.txt documents PAYMENT-REQUIRED + PAYMENT-SIGNATURE and the paid-then-retry contract', async () => {
    const app = await webApp();
    const res = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(res.statusCode).toBe(200);
    for (const needle of [
      '# Licita',
      'payment_required',
      'GET /v1/search',
      'search_tenders',
      'PAYMENT-REQUIRED',
      'PAYMENT-SIGNATURE',
      '/v1/dev-faucet',
      'X-PAYMENT',
      'NOT available in production',
      'billing_purchase_credits',
      'billing_get_balance',
      'POST /v1/billing/credits/5',
      'x-client-key',
    ]) {
      expect(res.body, `llms.txt missing "${needle}"`).toContain(needle);
    }
    await app.close();
  });

  it('/llms.txt frames renewals as honest deterministic heuristics, not probabilities', async () => {
    const app = await webApp();
    const res = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(res.body).toMatch(/methodology/);
    expect(res.body).toMatch(/deterministic\s+heuristic/i);
    expect(res.body).toMatch(/confidence_scale/);
    expect(res.body).toMatch(/low/);
    expect(res.body).toMatch(/high/);
    expect(res.body).not.toMatch(/probability model/i);
    await app.close();
  });

  it('/docs shows the v2 curl flow with the dev faucet caveat', async () => {
    const app = await webApp();
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    for (const needle of ['curl', 'PAYMENT-REQUIRED', 'PAYMENT-SIGNATURE', '/v1/dev-faucet', 'not available in production', 'X-PAYMENT']) {
      expect(res.body, `/docs missing "${needle}"`).toContain(needle);
    }
    await app.close();
  });

  it('/pricing page advertises the v2 payment flow', async () => {
    const app = await webApp();
    const res = await app.inject({ method: 'GET', url: '/pricing' });
    expect(res.statusCode).toBe(200);
    for (const needle of ['PAYMENT-REQUIRED', 'PAYMENT-SIGNATURE', 'GET /v1/renewals', '$0.25']) {
      expect(res.body, `/pricing missing "${needle}"`).toContain(needle);
    }
    await app.close();
  });

  it('/pricing page advertises prepaid credit bundles and x-client-key usage', async () => {
    const app = await webApp();
    const res = await app.inject({ method: 'GET', url: '/pricing' });
    expect(res.statusCode).toBe(200);
    for (const needle of [
      'Credits',
      'POST /v1/billing/credits/5',
      'POST /v1/billing/credits/10',
      'POST /v1/billing/credits/25',
      '$5.00',
      '$10.00',
      '$25.00',
      'x-client-key',
      'no subscription',
    ]) {
      expect(res.body, `/pricing missing "${needle}"`).toContain(needle);
    }
    await app.close();
  });

  it('buildPricing payment_flow is machine-readable x402 v2 with a dev-only faucet', () => {
    const p = buildPricing('dev');
    expect(p.payment_flow).toMatchObject({
      protocol: 'x402',
      version: 2,
      required_header: 'PAYMENT-REQUIRED',
      signature_header: 'PAYMENT-SIGNATURE',
      header: 'X-PAYMENT',
    });
    const steps = (p.payment_flow.steps as string[]).join(' ');
    expect(steps).toContain('PAYMENT-REQUIRED');
    expect(steps).toContain('PAYMENT-SIGNATURE');
    expect(p.payment_flow.faucet).toContain('/v1/dev-faucet');
  });

  it('buildPricing in x402 mode drops the faucet instead of advertising it', () => {
    const p = buildPricing('x402');
    expect(p.payment_flow.faucet).toBeNull();
    expect(p.payment_flow.protocol).toBe('x402');
    expect(p.payment_flow.signature_header).toBe('PAYMENT-SIGNATURE');
  });

  it('buildPricing advertises prepaid credit bundles (P2)', () => {
    const p = buildPricing('dev');
    expect(p.billing).toMatchObject({
      mechanism: 'prepaid_credits',
      balance_endpoint: 'GET /v1/billing',
    });
    const bundles = p.billing.bundles as Array<{ amount_usd: string; endpoint: string }>;
    expect(bundles).toEqual([
      { amount_usd: '5.00', endpoint: 'POST /v1/billing/credits/5' },
      { amount_usd: '10.00', endpoint: 'POST /v1/billing/credits/10' },
      { amount_usd: '25.00', endpoint: 'POST /v1/billing/credits/25' },
    ]);
    expect(String(p.billing.usage)).toContain('x-client-key');
  });
});

describe('P1 use-case and data pages (agent-first discovery)', () => {
  it('indexes the four use cases with their endpoints and costs', async () => {
    const app = await webApp();
    const res = await app.inject({ method: 'GET', url: '/use-cases' });
    expect(res.statusCode).toBe(200);
    for (const needle of [
      '/use-cases/tender-intelligence',
      '/use-cases/company-research',
      '/use-cases/buyer-intelligence',
      '/use-cases/renewals-forecasting',
      'GET /v1/demo',
    ]) {
      expect(res.body, `/use-cases missing "${needle}"`).toContain(needle);
    }
    await app.close();
  });

  it('each use case teaches the mission, tools, cost and an honest labeled example', async () => {
    const app = await webApp();
    const cases: Array<[string, string]> = [
      ['tender-intelligence', 'GET /v1/search'],
      ['company-research', 'GET /v1/companies/:id'],
      ['buyer-intelligence', 'GET /v1/buyers/:id/history'],
      ['renewals-forecasting', 'GET /v1/renewals'],
    ];
    for (const [slug, endpoint] of cases) {
      const res = await app.inject({ method: 'GET', url: `/use-cases/${slug}` });
      expect(res.statusCode, `use-case ${slug} status`).toBe(200);
      for (const needle of [endpoint, 'labeled sample', 'Honesty note', 'provenance']) {
        expect(res.body, `${slug} missing "${needle}"`).toContain(needle);
      }
    }
    const missing = await app.inject({ method: 'GET', url: '/use-cases/nope' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('data pages describe sources, coverage and provenance honestly', async () => {
    const app = await webApp();
    const data: Array<[string, string[]]> = [
      ['/data', ['12,718', 'TED', 'PLACSP', '/data/spain', '/data/eu']],
      ['/data/spain', ['PLACSP', '2026/CONTRAT/000064', 'Oleiros', 'GET /v1/search']],
      ['/data/eu', ['TED', 'ted.europa.eu', 'GET /v1/tenders/:id']],
    ];
    for (const [url, needles] of data) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `${url} status`).toBe(200);
      for (const needle of needles) {
        expect(res.body, `${url} missing "${needle}"`).toContain(needle);
      }
    }
    await app.close();
  });

  it('homepage and llms.txt link the new discovery surfaces', async () => {
    const app = await webApp();
    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.body).toContain('/use-cases/tender-intelligence');
    expect(home.body).toContain('/data/spain');
    const llms = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(llms.body).toContain('/use-cases/renewals-forecasting');
    expect(llms.body).toContain('/data/eu');
    await app.close();
  });
});
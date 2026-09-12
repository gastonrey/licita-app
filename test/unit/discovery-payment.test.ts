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

async function webApp(mode: AppConfig['paymentsMode'] = 'dev', overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerWeb(app, { ...config, paymentsMode: mode, ...overrides });
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

  it('/docs is pricing-honest when creem is DISABLED: not enabled, 404s, credits available (B2.6)', async () => {
    const app = await webApp('dev', { creem: { enabled: false, apiKey: '', webhookSecret: '', productId: '', priceCents: 2900 } });
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    for (const needle of [
      'Creem billing is <strong>not enabled</strong>',
      'CREEM_ENABLED=false',
      'answers <code>404</code>',
      'credit bundles',
      'Trial/pro keys are <strong>not enabled</strong>',
      'TRIAL_ENABLED=false',
      'inert',
    ]) {
      expect(res.body, `/docs missing "${needle}"`).toContain(needle);
    }
    expect(res.body).not.toContain('€29.00/month'); // never advertise a subscription that is not deployed
    expect(res.body).not.toContain('Known trade-off for trial keys (B1)'); // trial quota branch does not exist off
    await app.close();
  });

  it('/docs documents the B1 trial trade-off ONLY when TRIAL_ENABLED=true (D5 honesty)', async () => {
    const app = await webApp('dev', { creem: { enabled: false, apiKey: '', webhookSecret: '', productId: '', priceCents: 2900 }, trialEnabled: true });
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    for (const needle of ['Known trade-off for trial keys (B1)', '24 of the 25 calls are usable', '403 trial_exhausted']) {
      expect(res.body, `/docs missing "${needle}"`).toContain(needle);
    }
    expect(res.body).not.toContain('not enabled on this deployment');
    await app.close();
  });

  it('/docs advertises the creem arm with a config-derived price and honest credit mechanics (B2.6)', async () => {
    const app = await webApp('dev', { creem: { enabled: true, apiKey: 'creem_test_x', webhookSecret: 'whsec_x', productId: 'prod_x', priceCents: 4950 } });
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    for (const needle of [
      'POST /v1/creem/checkout',
      '€49.50/month', // derived from CREEM_PRICE_CENTS=4950, never a hardcoded 29.00
      'CREEM_PRICE_CENTS',
      'POST /v1/creem/webhook',
      'one-time credits',
      '402',
      'preserved 25 trial calls',
      'never sees a card number',
    ]) {
      expect(res.body, `/docs missing "${needle}"`).toContain(needle);
    }
    expect(res.body).not.toContain('not enabled on this deployment');
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
    // Contract tokens assert on both locales; text needles assert ES at /, EN at /en
    // (content flip S2.2, needle migration matrix S2.3).
    for (const url of ['/pricing', '/en/pricing']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `${url} status`).toBe(200);
      for (const needle of [
        'POST /v1/billing/credits/5',
        'POST /v1/billing/credits/10',
        'POST /v1/billing/credits/25',
        '$5.00',
        '$10.00',
        '$25.00',
        'x-client-key',
      ]) {
        expect(res.body, `${url} missing "${needle}"`).toContain(needle);
      }
    }
    const es = await app.inject({ method: 'GET', url: '/pricing' });
    expect(es.body).toContain('Créditos');
    expect(es.body).toContain('sin suscripción');
    const en = await app.inject({ method: 'GET', url: '/en/pricing' });
    expect(en.body).toContain('Credits');
    expect(en.body).toContain('no subscription');
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

  it('buildPricing is pricing-honest about the creem subscription arm (B2.6): disabled → available=false', () => {
    const p = buildPricing('dev'); // default: creem disabled
    expect(p.subscription).toMatchObject({
      available: false,
      provider: 'creem',
    });
    expect(String(p.subscription.reason)).toContain('not enabled');
    expect(p.subscription.price_monthly_cents).toBeUndefined();
  });

  it('buildPricing creem arm derives the monthly price from config, never hardcodes it (B2.6)', () => {
    const p = buildPricing('dev', { enabled: true, priceCents: 4950 });
    expect(p.subscription).toMatchObject({
      available: true,
      provider: 'creem',
      currency: 'EUR',
      price_monthly_cents: 4950,
      price_monthly: '49.50',
      checkout_endpoint: 'POST /v1/creem/checkout',
    });
    // honesty contract: the displayed price is ALWAYS the configured cents / 100
    expect(p.subscription.price_monthly).toBe((4950 / 100).toFixed(2));
    expect(String(p.subscription.mechanics)).toContain('one-time credits');
  });

  it('/pricing advertises the creem monthly subscription arm when enabled (B2.6)', async () => {
    const app = await webApp('dev', { creem: { enabled: true, apiKey: 'creem_test_x', webhookSecret: 'whsec_x', productId: 'prod_x', priceCents: 4950 } });
    // Contract tokens assert on both locales; text needles assert ES at /, EN at /en
    // (content flip S2.2, needle migration matrix S2.3). Prices derive from config, never hardcoded.
    for (const url of ['/pricing', '/en/pricing']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `${url} status`).toBe(200);
      for (const needle of ['POST /v1/creem/checkout', 'POST /v1/creem/webhook', 'kind=creem', '402']) {
        expect(res.body, `${url} missing "${needle}"`).toContain(needle);
      }
    }
    const es = await app.inject({ method: 'GET', url: '/pricing' });
    expect(es.body).toContain('Suscripción mensual');
    expect(es.body).toContain('€49.50/mes'); // derived from CREEM_PRICE_CENTS=4950
    const en = await app.inject({ method: 'GET', url: '/en/pricing' });
    expect(en.body).toContain('Monthly subscription');
    expect(en.body).toContain('€49.50/month'); // derived from CREEM_PRICE_CENTS=4950
    await app.close();
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
    // Root pages are Spanish after the content flip (S2.2): text needles assert ES.
    for (const [slug, endpoint] of cases) {
      const res = await app.inject({ method: 'GET', url: `/use-cases/${slug}` });
      expect(res.statusCode, `use-case ${slug} status`).toBe(200);
      for (const needle of [endpoint, 'muestra etiquetada', 'Nota de honestidad', 'provenance']) {
        expect(res.body, `${slug} missing "${needle}"`).toContain(needle);
      }
    }
    // English variants live at /en/use-cases/<slug> (needle migration matrix S2.3).
    for (const [slug, endpoint] of cases) {
      const res = await app.inject({ method: 'GET', url: `/en/use-cases/${slug}` });
      expect(res.statusCode, `use-case ${slug} en status`).toBe(200);
      for (const needle of [endpoint, 'labeled sample', 'Honesty note', 'provenance']) {
        expect(res.body, `${slug} en missing "${needle}"`).toContain(needle);
      }
    }
    const missing = await app.inject({ method: 'GET', url: '/use-cases/nope' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('data pages describe sources, coverage and provenance honestly', async () => {
    const app = await webApp();
    // Root pages are Spanish after the content flip (S2.2): /data needles assert ES,
    // /en/data asserts the EN variants (needle migration matrix S2.3).
    const data: Array<[string, string[]]> = [
      ['/data', ['Registros actuales y rangos indexados', 'TED', 'PLACSP', '/data/spain', '/data/eu']],
      ['/en/data', ['Current records and indexed ranges', 'TED', 'PLACSP', '/en/data/spain', '/en/data/eu']],
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

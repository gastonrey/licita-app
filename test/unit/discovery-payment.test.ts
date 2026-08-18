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
});
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerWeb } from '../../src/web/pages.js';
import { makeTestConfig } from './testconfig.js';

describe('human homepage', () => {
  it('presents a functional email-only demo CTA and coherent product navigation', async () => {
    const app = Fastify({ logger: false });
    registerWeb(app, makeTestConfig({ paymentsMode: 'dev' }));
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Know which public contracts deserve your next conversation');
    expect(res.body).toContain('evidence-rail');
    expect(res.body).toContain('TED');
    expect(res.body).toContain('PLACSP');
    expect(res.body).toContain('last successful ingestion');
    expect(res.body).toContain('Not reported');
    expect(res.body).toContain('skip-link');
    expect(res.body).toContain('action="/v1/demo/request"');
    expect(res.body).toContain("fetch('/v1/demo/request?source=homepage'");
    expect(res.body).toContain('type="email"');
    expect(res.body).toContain('autocomplete="email"');
    expect(res.body).toContain('inputmode="email"');
    expect(res.body).toContain('spellcheck="false"');
    expect(res.body).toContain('aria-live="polite"');
    // Retention copy (approved fix): the old "30 days unless the lead advances"
    // claim was false (nothing advanced). The funnel now keeps 'new' leads and
    // purges terminal statuses (contacted/used/paid/lost) after 180 days.
    expect(res.body).toContain('180 days');
    expect(res.body).not.toContain('for 30 days');
    expect(res.body).not.toContain('each paid call returns a client id');
    expect(res.body).toContain('x-client-key');
    expect(res.body).toContain('site-footer');
    expect(res.body).toContain('<link rel="stylesheet" href="/styles.css">');
    expect(res.body).toContain('POST /v1/research');
    expect(res.body).toContain('Methodology');
    expect(res.body).toContain('Security');
    expect(res.body).toContain('Terms');
    expect(res.body).toContain('Status');
    expect(res.body).toContain('source_metadata');
    expect(res.body).toContain('evidence-lines');
    expect(res.body).toContain('upstream');
    const styles = await app.inject({ method: 'GET', url: '/styles.css' });
    expect(styles.statusCode).toBe(200);
    expect(styles.headers['content-type']).toMatch(/text\/css/);
    expect(styles.body).toContain('--color-ink');
    expect(styles.body).toContain('.evidence-rail');
    expect(styles.body).toContain('@media (prefers-reduced-motion: reduce)');
    await app.close();
  });

  it('renders a truthful no-JS success state from the redirect query', async () => {
    const app = Fastify({ logger: false });
    registerWeb(app, makeTestConfig());
    const res = await app.inject({ method: 'GET', url: '/?demo=success' });
    expect(res.body).toContain('Demo request received');
    expect(res.body).toContain('no meeting was booked');
    await app.close();
  });

  it('states the real demo-retention rule on the privacy page', async () => {
    const app = Fastify({ logger: false });
    registerWeb(app, makeTestConfig());
    const res = await app.inject({ method: 'GET', url: '/privacy' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('180 days');
    expect(res.body).not.toContain('for 30 days');
    expect(res.body).toContain('contacted, used, paid or lost');
    await app.close();
  });

  it('homepage advertises the creem monthly plan with a config-derived price when enabled (B2.6)', async () => {
    const app = Fastify({ logger: false });
    registerWeb(app, makeTestConfig({ paymentsMode: 'dev', creem: { enabled: true, apiKey: 'creem_test_x', webhookSecret: 'whsec_x', productId: 'prod_x', priceCents: 4950 } }));
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    for (const needle of ['Monthly plan', '€49.50', 'POST /v1/creem/checkout', 'kind=creem', '30 days', 'pay-per-call']) {
      expect(res.body, `homepage missing "${needle}"`).toContain(needle);
    }
    expect(res.body).not.toContain('no subscriptions, no signup');
    await app.close();
  });

  it('homepage keeps the no-subscription framing when creem is disabled', async () => {
    const app = Fastify({ logger: false });
    registerWeb(app, makeTestConfig({ paymentsMode: 'dev' }));
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('no subscriptions, no signup');
    expect(res.body).toContain('Research brief');
    expect(res.body).not.toContain('Monthly plan');
    await app.close();
  });
});

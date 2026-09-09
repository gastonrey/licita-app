// GET /health: 200 ok when the db answers SELECT 1, 503 degraded when it fails.
// D2 (activation readiness): the response gains a `features` map reporting the
// fiat switches as tri-state (disabled / enabled-dry / enabled) derived from
// env config only — never secret values — so a smoke probe answers "is creem
// actually on, and is it fully wired?".

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import type { Db } from '../../src/db/client.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { makeTestConfig } from './testconfig.js';

function fakeDb(query: Db['query']): Db {
  return { query, on: () => undefined, end: async () => undefined } as unknown as Db;
}

const ALL_OFF_FEATURES = {
  features: {
    creem: 'disabled',
    digest: 'disabled',
    trial: 'disabled',
    scheduled_generation_events: true,
    base_url_set: false,
  },
} as const;

describe('GET /health', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    resetPayments();
  });

  it('200 { status: "ok", db: "up" } with all-off feature probes when the db is reachable', async () => {
    app = await buildServer(makeTestConfig(), fakeDb((async () => ({ rows: [] })) as Db['query']));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'up', ...ALL_OFF_FEATURES });
  });

  it('503 { status: "degraded", db: "down" } still reports the config-derived feature probes', async () => {
    app = await buildServer(
      makeTestConfig(),
      fakeDb((async () => {
        throw new Error('connection refused');
      }) as Db['query']),
    );
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down', ...ALL_OFF_FEATURES });
  });

  it('is free (no payment hook) and not operator-gated', async () => {
    app = await buildServer(makeTestConfig(), fakeDb((async () => ({ rows: [] })) as Db['query']));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200); // no X-PAYMENT, no x-operator-key
  });

it('creem tri-state: disabled → enabled-dry (flag on, secrets missing) → enabled (fully wired)', async () => {
    const disabled = await buildServer(makeTestConfig(), fakeDb((async () => ({ rows: [] })) as Db['query']));
    expect((await disabled.inject({ method: 'GET', url: '/health' })).json().features.creem).toBe('disabled');
    await disabled.close();
    resetPayments();

    const dry = await buildServer(
      makeTestConfig({ creem: { enabled: true, apiKey: '', webhookSecret: 'whsec_x', productId: 'prod_creem_placeholder', priceCents: 2900 } }),
      fakeDb((async () => ({ rows: [] })) as Db['query']),
    );
    expect((await dry.inject({ method: 'GET', url: '/health' })).json().features.creem).toBe('enabled-dry');
    await dry.close();
    resetPayments();

    const on = await buildServer(
      makeTestConfig({ creem: { enabled: true, apiKey: 'creem_test_placeholder', webhookSecret: 'whsec_x', productId: 'prod_creem_placeholder', priceCents: 2900 } }),
      fakeDb((async () => ({ rows: [] })) as Db['query']),
    );
    expect((await on.inject({ method: 'GET', url: '/health' })).json().features.creem).toBe('enabled');
    await on.close();
  });

  it('digest tri-state: disabled → enabled-dry (missing recipients/sender) → enabled (fully wired)', async () => {
    const dry = await buildServer(
      makeTestConfig({ digestEnabled: true, digestFromEmail: '', digestBcc: '', resendApiKey: 're_123', scheduledGenerationEvents: true }),
      fakeDb((async () => ({ rows: [] })) as Db['query']),
    );
    expect((await dry.inject({ method: 'GET', url: '/health' })).json().features.digest).toBe('enabled-dry');
    await dry.close();
    resetPayments();

    const on = await buildServer(
      makeTestConfig({ digestEnabled: true, digestFromEmail: 'digest@licita.example', digestBcc: 'ops@licita.example', resendApiKey: 're_123', scheduledGenerationEvents: true }),
      fakeDb((async () => ({ rows: [] })) as Db['query']),
    );
    expect((await on.inject({ method: 'GET', url: '/health' })).json().features.digest).toBe('enabled');
    await on.close();
  });

  it('trial tri-state: disabled → enabled-dry (missing resend/baseUrl) → enabled', async () => {
    const dry = await buildServer(
      makeTestConfig({ trialEnabled: true, resendApiKey: '', baseUrl: '' }),
      fakeDb((async () => ({ rows: [] })) as Db['query']),
    );
    expect((await dry.inject({ method: 'GET', url: '/health' })).json().features.trial).toBe('enabled-dry');
    await dry.close();
    resetPayments();

    const on = await buildServer(
      makeTestConfig({ trialEnabled: true, resendApiKey: 're_123', baseUrl: 'https://licita.example' }),
      fakeDb((async () => ({ rows: [] })) as Db['query']),
    );
    const body = (await on.inject({ method: 'GET', url: '/health' })).json();
    expect(body.features.trial).toBe('enabled');
    expect(body.features.base_url_set).toBe(true);
    await on.close();
  });

  it('full fiat-on deployment answers enabled/enabled/enabled and NEVER leaks secrets', async () => {
    app = await buildServer(
      makeTestConfig({
        scheduledGenerationEvents: true,
        baseUrl: 'https://licita.example',
        resendApiKey: 're_placeholder',
        digestEnabled: true,
        digestFromEmail: 'digest@licita.example',
        digestBcc: 'ops@licita.example',
        trialEnabled: true,
        creem: { enabled: true, apiKey: 'creem_live_placeholder', webhookSecret: 'whsec_live_placeholder', productId: 'prod_creem_placeholder', priceCents: 2900 },
      }),
      fakeDb((async () => ({ rows: [] })) as Db['query']),
    );
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.body;
    expect((res.json()).features).toEqual({
      creem: 'enabled',
      digest: 'enabled',
      trial: 'enabled',
      scheduled_generation_events: true,
      base_url_set: true,
    });
    for (const secret of ['creem_test_', 'creem_live_', 'whsec_live', 're_placeholder', 'digest@licita.example']) {
      expect(body, `health leaked "${secret}"`).not.toContain(secret);
    }
  });
});
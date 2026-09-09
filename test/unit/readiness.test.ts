// D1 (activation readiness): GET /v1/stats/readiness — operator-only,
// read-only fiat-revenue activation grant. One endpoint with the actual
// switch states + migration status, so the operator sees exactly what blocks
// fiat revenue before/after deploy. Auth reuses statsAuth (x-operator-key) —
// no new secret surface. The dashboard Overview tab renders it read-only.

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import type { Db } from '../../src/db/client.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { buildReadinessReport, REQUIRED_MIGRATIONS } from '../../src/api/routes/readiness.js';
import { makeTestConfig } from './testconfig.js';

const ALL_MIGRATIONS = [...REQUIRED_MIGRATIONS];

function fakeDb(query: Db['query']): Db {
  return { query, on: () => undefined, end: async () => undefined } as unknown as Db;
}

const allOff: Parameters<typeof buildReadinessReport>[0] = makeTestConfig();
const allOn: Parameters<typeof buildReadinessReport>[0] = makeTestConfig({
  baseUrl: 'https://licita.example',
  resendApiKey: 're_placeholder',
  digestEnabled: true,
  digestFromEmail: 'digest@licita.example',
  digestBcc: 'ops@licita.example',
  scheduledGenerationEvents: true,
  trialEnabled: true,
  creem: { enabled: true, apiKey: 'creem_test_placeholder', webhookSecret: 'whsec_x', productId: 'prod_creem_placeholder', priceCents: 2900 },
});

describe('buildReadinessReport (pure)', () => {
  it('all-off config + no migrations applied → every switch disabled, nothing base-URLed, migrations pending', () => {
    expect(buildReadinessReport(allOff, [])).toEqual({
      features: { creem: 'disabled', digest: 'disabled', trial: 'disabled' },
      scheduled_generation_events: true,
      base_url: { set: false, https: false },
      migrations: {
        all_applied: false,
        applied: [],
        pending: ALL_MIGRATIONS,
        trial_api_keys: false,
        webhook_events: false,
      },
    });
  });

  it('all-on config + all migrations applied → every switch enabled, full grant', () => {
    const report = buildReadinessReport(allOn, ALL_MIGRATIONS);
    expect(report.features).toEqual({ creem: 'enabled', digest: 'enabled', trial: 'enabled' });
    expect(report.scheduled_generation_events).toBe(true);
    expect(report.base_url).toEqual({ set: true, https: true });
    expect(report.migrations).toEqual({
      all_applied: true,
      applied: ALL_MIGRATIONS,
      pending: [],
      trial_api_keys: true,
      webhook_events: true,
    });
  });

  it('partial migrations → pending names the fiat-critical pair 009/010 and all_applied=false', () => {
    const applied = ALL_MIGRATIONS.slice(0, 8); // 001..008
    const report = buildReadinessReport(allOff, applied);
    expect(report.migrations.all_applied).toBe(false);
    expect(report.migrations.applied).toEqual(applied);
    expect(report.migrations.pending).toEqual(['009_trial_api_keys.sql', '010_webhook_events.sql']);
    expect(report.migrations.trial_api_keys).toBe(false);
    expect(report.migrations.webhook_events).toBe(false);
  });

  it('http base URL is reported honestly as not-https', () => {
    const report = buildReadinessReport(makeTestConfig({ baseUrl: 'http://licita.example' }), []);
    expect(report.base_url).toEqual({ set: true, https: false });
  });

  it('digest on but generation events off → enabled-dry (schedule master gate is off)', () => {
    const report = buildReadinessReport(
      makeTestConfig({ digestEnabled: true, digestFromEmail: 'd@e.x', digestBcc: 'o@e.x', resendApiKey: 're_1', scheduledGenerationEvents: false }),
      [],
    );
    expect(report.features.digest).toBe('enabled-dry');
  });
});

describe('GET /v1/stats/readiness (operator-only)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    resetPayments();
  });

  const OPERATOR_KEY = 'readiness-operator';
  const migrationsDb = fakeDb((async () => ({
    rows: ALL_MIGRATIONS.map((name) => ({ name })),
  })) as Db['query']);

  it('401 without x-operator-key (same gate as every /v1/stats route)', async () => {
    app = await buildServer(makeTestConfig({ operatorKey: OPERATOR_KEY }), migrationsDb);
    const res = await app.inject({ method: 'GET', url: '/v1/stats/readiness' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('401 with a wrong x-operator-key', async () => {
    app = await buildServer(makeTestConfig({ operatorKey: OPERATOR_KEY }), migrationsDb);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats/readiness',
      headers: { 'x-operator-key': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('200 envelope with the switch states and migration status for the operator', async () => {
    app = await buildServer(makeTestConfig({ operatorKey: OPERATOR_KEY }), migrationsDb);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats/readiness',
      headers: { 'x-operator-key': OPERATOR_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.features).toEqual({ creem: 'disabled', digest: 'disabled', trial: 'disabled' });
    expect(body.data.migrations).toMatchObject({
      all_applied: true,
      trial_api_keys: true,
      webhook_events: true,
    });
    expect(body.meta).toMatchObject({ paid: false });
  });

  it('is NOT gated by payment (no PAYMENT-SIGNATURE needed) — read-only operator surface', async () => {
    app = await buildServer(makeTestConfig({ operatorKey: OPERATOR_KEY }), migrationsDb);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats/readiness',
      headers: { 'x-operator-key': OPERATOR_KEY },
    });
    expect(res.statusCode).toBe(200);
  });
});
// D3 flags audit (fiat-revenue-rails, activation readiness): TRIAL_ENABLED.
//
// The B1 trial api_clients seam shipped UNCONDITIONAL: there was no flag. D3
// adds TRIAL_ENABLED (default false, like every other fiat switch) so the
// operator chooses when the trial/pro key seam is live:
//   - config surface: loadConfig defaults falsy, reads TRIAL_ENABLED;
//   - validateConfig: production TRIAL_ENABLED=true requires RESEND_API_KEY
//     and BASE_URL (design #1119 — a live trial needs the signup email path);
//   - middleware: trialEnabled=false makes trial/pro api_clients rows inert
//     (keys revert to the legacy credit/402 path) while kind='creem' rows
//     KEEP working (purchased subscriptions are independent of trial grants).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import type { AppConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { validateConfig } from '../../src/config.validate.js';
import { initPayments, paymentPreHandler, resetPayments } from '../../src/pay/middleware.js';
import { generateKey, hashKey, hashKeyLog } from '../../src/pay/keys.js';
import { makeTestConfig } from './testconfig.js';

const TRIAL_ENV_KEYS = ['TRIAL_ENABLED', 'RESEND_API_KEY', 'BASE_URL'] as const;

function makeDb(): Db {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  return new Pool() as unknown as Db;
}

const DDL = `
CREATE TABLE api_clients (
  id bigserial PRIMARY KEY, key_hash text UNIQUE NOT NULL,
  kind text NOT NULL DEFAULT 'agent', created_at timestamptz DEFAULT now(),
  email text, calls_remaining integer, expires_at timestamptz, current_period_end timestamptz
);
CREATE TABLE credit_accounts (
  client_key text PRIMARY KEY, balance_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint REFERENCES api_clients(id),
  endpoint text NOT NULL, amount_usd numeric NOT NULL, provider text NOT NULL,
  proof text UNIQUE NOT NULL, status text NOT NULL, created_at timestamptz DEFAULT now(),
  payer_address text, tx_hash text, network text
);
`;

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/v1/search', { preHandler: [paymentPreHandler('GET /v1/search')] }, async (req) => ({
    ok: true,
    payment: req.payment ?? null,
  }));
  return app;
}

async function seedTrial(db: Db, key: string): Promise<number> {
  const res = await db.query(
    `INSERT INTO api_clients (key_hash, kind, email, calls_remaining, expires_at)
     VALUES ($1, 'trial', $2, 25, now() + interval '14 days')
     RETURNING id`,
    [hashKey(key), `${key.slice(0, 10)}@example.com`],
  );
  return Number((res.rows[0] as { id: number }).id);
}

async function seedCreem(db: Db, key: string, balanceCents: number): Promise<void> {
  await db.query(
    `INSERT INTO api_clients (key_hash, kind, email, calls_remaining, expires_at, current_period_end)
     VALUES ($1, 'creem', $2, 25, now() + interval '30 days', now() + interval '30 days')`,
    [hashKey(key), `${key.slice(0, 10)}@example.com`],
  );
  await db.query(`INSERT INTO credit_accounts (client_key, balance_cents) VALUES ($1, $2)`, [
    key,
    balanceCents,
  ]);
}

describe('loadConfig (TRIAL_ENABLED)', () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const key of TRIAL_ENV_KEYS) saved.set(key, process.env[key]);
  });
  afterEach(() => {
    for (const key of TRIAL_ENV_KEYS) {
      const orig = saved.get(key);
      if (orig === undefined) delete process.env[key];
      else process.env[key] = orig;
    }
  });

  it('defaults trialEnabled to false (all fiat switches default off)', () => {
    for (const key of TRIAL_ENV_KEYS) delete process.env[key];
    expect(loadConfig().trialEnabled).toBe(false);
  });

  it('reads TRIAL_ENABLED=true → trialEnabled true', () => {
    for (const key of TRIAL_ENV_KEYS) delete process.env[key];
    process.env.TRIAL_ENABLED = 'true';
    expect(loadConfig().trialEnabled).toBe(true);
  });
});

describe('validateConfig (TRIAL_ENABLED fail-closed)', () => {
  const prodTrialOn = (overrides = {}) =>
    makeTestConfig({
      nodeEnv: 'production',
      paymentsMode: 'x402',
      baseUrl: 'https://licita.example',
      x402: { facilitatorUrl: 'https://facilitator.example.com', payTo: '0x1234567890abcdef1234567890abcdef12345678', network: 'eip155:84532' },
      payHmacSecret: '',
      operatorKey: 'real-operator-secret',
      trialEnabled: true,
      resendApiKey: 're_placeholder',
      ...overrides,
    });

  it('passes in production when TRIAL_ENABLED=true with RESEND_API_KEY and BASE_URL set', () => {
    expect(() => validateConfig(prodTrialOn())).not.toThrow();
  });

  it('fails in production when TRIAL_ENABLED=true but RESEND_API_KEY is missing, naming it', () => {
    expect(() => validateConfig(prodTrialOn({ resendApiKey: '' }))).toThrow(/RESEND_API_KEY/);
  });

  it('fails in production when TRIAL_ENABLED=true but BASE_URL is missing, naming it', () => {
    expect(() => validateConfig(prodTrialOn({ baseUrl: '' }))).toThrow(/BASE_URL/);
  });

  it('does not require trial vars in production when TRIAL_ENABLED=false', () => {
    expect(() =>
      validateConfig(prodTrialOn({ trialEnabled: false, resendApiKey: '', baseUrl: '' })),
    ).toThrow(/BASE_URL/); // BASE_URL is a general prod rule, but not a trial one
  });
});

describe('paymentPreHandler trialEnabled gate (D3)', () => {
  let db: Db;
  let app: FastifyInstance;

  async function build(enabled: boolean): Promise<void> {
    resetPayments();
    db = makeDb();
    await db.query(DDL);
    initPayments(makeTestConfig({ payHmacSecret: 's', operatorKey: 'op', trialEnabled: enabled, baseUrl: 'https://licita.test' }), db);
    app = buildApp();
  }

  beforeEach(async () => { await build(false); });
  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('trialEnabled=false: an active lct_ trial key via x-client-key is INERT — reverts to the legacy credit path (402), quota untouched, no trial payment row', async () => {
    const key = generateKey();
    const id = await seedTrial(db, key);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search',
      headers: { 'x-client-key': key },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('payment_required');
    const quota = await db.query(`SELECT calls_remaining FROM api_clients WHERE id = $1`, [id]);
    expect(Number(quota.rows[0].calls_remaining)).toBe(25); // never decremented
    const payments = await db.query(`SELECT count(*)::int AS n FROM payments`);
    expect(Number(payments.rows[0].n)).toBe(0);
  });

  it('trialEnabled=false: an lct_ key in X-PAYMENT is treated as an unknown proof (402), not 403 trial_exhausted', async () => {
    const key = generateKey();
    await seedTrial(db, key);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search',
      headers: { 'X-PAYMENT': key },
    });
    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.error.code).toBe('payment_required');
    expect(body.error.message).not.toMatch(/Trial/i);
  });

  it('trialEnabled=false: kind=creem rows still debit one-time credits (purchased subscriptions are independent of trial grants)', async () => {
    const key = generateKey();
    await seedCreem(db, key, 500);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search',
      headers: { 'X-PAYMENT': key },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().payment).toMatchObject({ paid: true, priceUsd: '0.02' });
    const bal = await db.query(`SELECT balance_cents FROM credit_accounts WHERE client_key = $1`, [key]);
    expect(Number(bal.rows[0].balance_cents)).toBe(498);
  });

  it('trialEnabled=true: an active lct_ trial key still debits quota (B1 contract preserved when the flag is on)', async () => {
    await app.close();
    resetPayments();
    await build(true);
    const key = generateKey();
    const id = await seedTrial(db, key);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search',
      headers: { 'X-PAYMENT': key },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().payment).toMatchObject({ paid: true, priceUsd: '0.02' });
    const quota = await db.query(`SELECT calls_remaining FROM api_clients WHERE id = $1`, [id]);
    expect(Number(quota.rows[0].calls_remaining)).toBe(24);
    const row = await db.query(`SELECT provider FROM payments WHERE client_id = $1`, [id]);
    expect(String(row.rows[0].provider)).toBe('trial');
  });
});
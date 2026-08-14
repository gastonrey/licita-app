// DevPaymentProvider: token sign/verify — happy path, tamper, expiry,
// wrong endpoint, replay (unique payments.proof insert).

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import { DevPaymentProvider, DEV_TOKEN_TTL_SEC } from '../../src/pay/devProvider.js';

const SECRET = 'test-secret';
const ENDPOINT = 'GET /v1/search'; // priced at 0.02

const PAYMENTS_DDL = `
CREATE TABLE api_clients (
  id bigserial PRIMARY KEY, key_hash text UNIQUE NOT NULL,
  kind text NOT NULL DEFAULT 'agent', created_at timestamptz DEFAULT now()
);
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint REFERENCES api_clients(id),
  endpoint text NOT NULL, amount_usd numeric NOT NULL, provider text NOT NULL,
  proof text UNIQUE NOT NULL, status text NOT NULL, created_at timestamptz DEFAULT now()
);
`;

function makeDb(): Db {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  return pool as unknown as Db;
}

describe('DevPaymentProvider', () => {
  let db: Db;
  let provider: DevPaymentProvider;

  beforeAll(async () => {
    db = makeDb();
    await db.query(PAYMENTS_DDL);
  });

  beforeEach(async () => {
    await db.query('DELETE FROM payments');
    provider = new DevPaymentProvider({ secret: SECRET, db });
  });

  it('prices endpoints from ENDPOINT_PRICES', () => {
    expect(provider.price('GET /v1/search')).toBe('0.02');
    expect(provider.price('GET /v1/renewals')).toBe('0.25');
    expect(provider.price('GET /v1/pricing')).toBe('0.00');
    expect(provider.price('GET /nope')).toBe('0.00');
  });

  it('requiredResponse is x402-shaped with a faucet hint', () => {
    const r = provider.requiredResponse(ENDPOINT);
    expect(r.x402Version).toBe(1);
    expect(r.accepts).toHaveLength(1);
    expect(r.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'dev',
      asset: 'USD',
      amount: '0.02',
      payTo: 'dev-faucet',
      resource: ENDPOINT,
    });
    expect(r.hint).toContain('POST /v1/dev-faucet');
    expect(r.hint).toContain(ENDPOINT);
  });

  it('signs and verifies a token; records a success payment row', async () => {
    const { token, expires_at } = provider.createToken(ENDPOINT);
    expect(new Date(expires_at).getTime()).toBeGreaterThan(Date.now());
    const v = await provider.verify(token, ENDPOINT);
    expect(v).toMatchObject({ ok: true, amount: '0.02' });
    expect(v.clientKey).toMatch(/^dev_[0-9a-f]{16}$/);
    const rows = await db.query(`SELECT endpoint, amount_usd::text AS amount, provider, status FROM payments`);
    expect(rows.rows).toEqual([
      { endpoint: ENDPOINT, amount: '0.02', provider: 'dev', status: 'success' },
    ]);
  });

  it('rejects a tampered token (invalid_signature)', async () => {
    const { token } = provider.createToken(ENDPOINT);
    const dot = token.lastIndexOf('.');
    const tampered = `${token.slice(0, dot)}.${token.slice(dot + 1).split('').reverse().join('')}`;
    expect(await provider.verify(tampered, ENDPOINT)).toEqual({ ok: false, reason: 'invalid_signature' });
    // tampering with the payload instead of the signature
    const payload = Buffer.from('{"endpoint":"GET /v1/search","amount":"0.02","exp":9999999999,"nonce":"x"}').toString('base64url');
    expect(await provider.verify(`${payload}.AAAA`, ENDPOINT)).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects malformed tokens', async () => {
    expect(await provider.verify('', ENDPOINT)).toEqual({ ok: false, reason: 'malformed' });
    expect(await provider.verify('nodots', ENDPOINT)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects expired tokens', async () => {
    const now = 1_800_000_000;
    const signer = new DevPaymentProvider({ secret: SECRET, db, now: () => now });
    const { token, expires_at } = signer.createToken(ENDPOINT);
    expect(new Date(expires_at).getTime()).toBe((now + DEV_TOKEN_TTL_SEC) * 1000);
    const later = new DevPaymentProvider({ secret: SECRET, db, now: () => now + DEV_TOKEN_TTL_SEC + 1 });
    expect(await later.verify(token, ENDPOINT)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token minted for a different endpoint (wrong_endpoint)', async () => {
    const { token } = provider.createToken('GET /v1/renewals');
    expect(await provider.verify(token, ENDPOINT)).toEqual({ ok: false, reason: 'wrong_endpoint' });
    // and it must NOT have consumed anything
    const rows = await db.query('SELECT count(*)::int AS n FROM payments');
    expect(rows.rows[0].n).toBe(0);
  });

  it('rejects replay of a consumed token (replay)', async () => {
    const { token } = provider.createToken(ENDPOINT);
    expect((await provider.verify(token, ENDPOINT)).ok).toBe(true);
    expect(await provider.verify(token, ENDPOINT)).toEqual({ ok: false, reason: 'replay' });
    const rows = await db.query(`SELECT count(*)::int AS n FROM payments WHERE status = 'success'`);
    expect(rows.rows[0].n).toBe(1);
  });

  it('verify fails without a replay store (no db)', async () => {
    const noDb = new DevPaymentProvider({ secret: SECRET });
    const { token } = noDb.createToken(ENDPOINT);
    expect(await noDb.verify(token, ENDPOINT)).toEqual({ ok: false, reason: 'replay_store_unavailable' });
  });
});

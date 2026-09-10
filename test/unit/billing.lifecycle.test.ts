// B2.2 Billing lifecycle: completeCheckout creates/upgrades the api_clients
// row to kind='creem' with current_period_end = now + 30d. NO credits are
// granted at checkout (S1: credit_accounts facade is not redesigned).
// Replay-safe: the lower(email) UNIQUE index + SELECT-first upsert mean a
// replayed event never creates a second row or a second credit row.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { Db } from '../../src/db/client.js';
import { makeTestDb, countRows } from './testdb.js';
import { makeTestConfig } from './testconfig.js';
import { completeCheckout } from '../../src/pay/billing.js';
import { generateKey, hashKey } from '../../src/pay/keys.js';

const config = makeTestConfig({
  creem: { enabled: true, apiKey: 'creem_test_placeholder', webhookSecret: 'whsec_creem_placeholder', productId: 'prod_creem_placeholder', priceCents: 2900 },
});

const DISABLED = makeTestConfig({
  creem: { enabled: false, apiKey: '', webhookSecret: '', productId: '', priceCents: 2900 },
});

describe('completeCheckout', () => {
  let db: Db;

  beforeEach(async () => {
    db = await makeTestDb();
  });

  afterEach(async () => {
    await (db as unknown as { end(): Promise<void> }).end();
  });

  async function creemRows(email: string) {
    const res = await db.query(
      `SELECT id, kind, email, calls_remaining, expires_at, current_period_end
       FROM api_clients WHERE lower(email) = lower($1)`,
      [email],
    );
    return res.rows;
  }

  it('creates a kind=creem api_client with +30d period when email is unknown; NO credit row', async () => {
    const before = Date.now();
    const result = await completeCheckout(db, config, { email: 'alice@example.com', eventId: 'evt_1' });
    const after = Date.now();
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);

    const rows = await creemRows('ALICE@example.com'); // case-insensitive lookup
    expect(rows).toHaveLength(1);
    const row = rows[0] as { kind: string; email: string; calls_remaining: number | null; current_period_end: Date };
    expect(row.kind).toBe('creem');
    expect(row.email).toBe('alice@example.com');
    expect(row.calls_remaining).toBeNull();
    // period end ≈ now + 30d (tolerance for test execution time)
    const periodMs = new Date(row.current_period_end).getTime();
    expect(periodMs).toBeGreaterThanOrEqual(before + 29 * 24 * 3600 * 1000);
    expect(periodMs).toBeLessThanOrEqual(after + 31 * 24 * 3600 * 1000);

    // NO credits granted by checkout
    expect(await countRows(db, 'credit_accounts')).toBe(0);
  });

  it('upgrades an existing trial row to kind=creem and renews the period; no second row', async () => {
    const key = generateKey();
    await db.query(
      `INSERT INTO api_clients (key_hash, kind, email, calls_remaining, expires_at)
       VALUES ($1, 'trial', $2, 25, now() + interval '14 days')`,
      [hashKey(key), 'bob@example.com'],
    );
    const result = await completeCheckout(db, config, { email: 'BOB@example.com', eventId: 'evt_2' });
    expect(result.created).toBe(false);
    expect(result.kindBefore).toBe('trial');

    const rows = await creemRows('bob@example.com');
    expect(rows).toHaveLength(1);
    const row = rows[0] as { kind: string; calls_remaining: number | null; current_period_end: Date };
    expect(row.kind).toBe('creem');
    // trial's quota is PRESERVED but inert: creem mode never decrements
    // calls_remaining (one-time credits govern going forward — B2.4 doc)
    expect(row.calls_remaining).toBe(25);
    expect(Number(new Date(row.current_period_end).getTime())).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
    expect(await countRows(db, 'credit_accounts')).toBe(0);
  });

  it('upgrades a legacy agent row to kind=creem preserving the row id', async () => {
    await db.query(
      `INSERT INTO api_clients (key_hash, kind, email) VALUES ($1, 'agent', $2)`,
      [hashKey(generateKey()), 'carol@example.com'],
    );
    const before = await creemRows('carol@example.com');
    const result = await completeCheckout(db, config, { email: 'carol@example.com', eventId: 'evt_3' });
    expect(result.created).toBe(false);
    const after = await creemRows('carol@example.com');
    expect(after).toHaveLength(1);
    expect((after[0] as { id: number }).id).toBe((before[0] as { id: number }).id);
    expect((after[0] as { kind: string }).kind).toBe('creem');
  });

  it('rolls back the whole transaction when a query fails mid-flight', async () => {
    // 3 queries happen: BEGIN, SELECT, INSERT/UPDATE. Throw on the INSERT.
    let calls = 0;
    const origQuery = db.query.bind(db);
    const failingDb = db as unknown as Db;
    failingDb.query = (async (...args: unknown[]) => {
      calls += 1;
      if (calls === 3) throw new Error('simulated mid-transaction failure');
      return (origQuery as unknown as (...a: unknown[]) => Promise<unknown>)(...(args as [string, unknown[]]));
    }) as unknown as Db['query'];

    await expect(completeCheckout(failingDb, config, { email: 'dave@example.com', eventId: 'evt_4' })).rejects.toThrow(
      /mid-transaction/,
    );
    expect(await creemRows('dave@example.com')).toHaveLength(0);
    expect(await countRows(db, 'credit_accounts')).toBe(0);
  });

  it('replayed event id is idempotent: one row, still creem, no duplicate credit row', async () => {
    await completeCheckout(db, config, { email: 'erin@example.com', eventId: 'evt_replay' });
    await completeCheckout(db, config, { email: 'erin@example.com', eventId: 'evt_replay' });
    expect(await creemRows('erin@example.com')).toHaveLength(1);
    expect((await creemRows('erin@example.com'))[0] as { kind: string }).toMatchObject({ kind: 'creem' });
    expect(await countRows(db, 'credit_accounts')).toBe(0);
  });

  it('fails closed when CREEM_ENABLED=false (kill switch)', async () => {
    await expect(completeCheckout(db, DISABLED, { email: 'frank@example.com', eventId: 'evt_5' })).rejects.toThrow(
      /CREEM_ENABLED/,
    );
    expect(await creemRows('frank@example.com')).toHaveLength(0);
  });
});
// C1.3 Weekly Renewal Radar digest (fiat-revenue-rails RD): buildWeeklyDigest
// SQL correctness over varied api_clients states + sendWeeklyDigest transport
// rate-guard (only DIGEST_FROM_EMAIL + DIGEST_BCC, never external addresses).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/client.js';
import { createLogger, type Logger } from '../../src/obs/log.js';
import type { ResendEmailPayload } from '../../src/obs/notify.js';
import { buildWeeklyDigest, sendWeeklyDigest } from '../../src/obs/digest.js';
import { makeTestDb } from './testdb.js';

const WINDOW_FROM = new Date('2026-09-07T00:00:00.000Z'); // Monday
const WINDOW_TO = new Date('2026-09-14T00:00:00.000Z'); // next Monday

async function seedClient(
  db: Db,
  row: {
    keyHash: string;
    kind: string;
    email: string | null;
    callsRemaining?: number | null;
    currentPeriodEnd?: Date | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO api_clients (key_hash, kind, email, calls_remaining, current_period_end)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.keyHash, row.kind, row.email, row.callsRemaining ?? null, row.currentPeriodEnd ?? null],
  );
}

async function seedPayment(
  db: Db,
  row: {
    clientKeyHash: string;
    endpoint: string;
    amountUsd: string;
    provider: string;
    proof: string;
    status: string;
    createdAt: string;
  },
): Promise<void> {
  const client = await db.query('SELECT id FROM api_clients WHERE key_hash = $1', [row.clientKeyHash]);
  const clientId = (client.rows[0] as { id: number }).id;
  await db.query(
    `INSERT INTO payments (client_id, endpoint, amount_usd, provider, proof, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [clientId, row.endpoint, row.amountUsd, row.provider, row.proof, row.status, row.createdAt],
  );
}

function silentLogger(): Logger {
  return createLogger('error');
}

describe('buildWeeklyDigest', () => {
  let db: Db;
  let log: Logger;

  beforeEach(async () => {
    db = await makeTestDb();
    log = silentLogger();
  });

  afterEach(async () => {
    await db.end();
  });

  it('groups varied client states into renewed / watchlist / churnRisk', async () => {
    // A: renewed — active creem subscription covering the window end.
    await seedClient(db, {
      keyHash: 'kh-renew',
      kind: 'creem',
      email: 'renew@example.com',
      callsRemaining: 50,
      currentPeriodEnd: new Date(WINDOW_TO.getTime() + 10 * 24 * 3600 * 1000),
    });
    // B: watchlist — trial running low on calls (< 10).
    await seedClient(db, {
      keyHash: 'kh-low',
      kind: 'trial',
      email: 'low@example.com',
      callsRemaining: 4,
      currentPeriodEnd: null,
    });
    // C: churn risk — creem subscription expired >30d before window end and
    //    the last completed payment is also >30d old.
    await seedClient(db, {
      keyHash: 'kh-gone',
      kind: 'creem',
      email: 'gone@example.com',
      callsRemaining: 20,
      currentPeriodEnd: new Date(WINDOW_TO.getTime() - 45 * 24 * 3600 * 1000),
    });
    await seedPayment(db, {
      clientKeyHash: 'kh-gone',
      endpoint: 'POST /v1/research',
      amountUsd: '29.00',
      provider: 'subscription',
      proof: 'proof-gone-1',
      status: 'completed',
      createdAt: new Date(WINDOW_TO.getTime() - 60 * 24 * 3600 * 1000).toISOString(),
    });
    // D: legacy agent row with NULL email — must never appear anywhere.
    await seedClient(db, { keyHash: 'kh-agent', kind: 'agent', email: null });

    const data = await buildWeeklyDigest(db, { from: WINDOW_FROM, to: WINDOW_TO });

    // Renewed: only the active creem subscriber.
    expect(data.renewed.map((r) => r.email)).toEqual(['renew@example.com']);
    // Watchlist: only the low-calls client.
    expect(data.watchlist.map((r) => r.email)).toEqual(['low@example.com']);
    // Churn risk: only the expired/no-recent-payment client.
    expect(data.churnRisk.map((r) => r.email)).toEqual(['gone@example.com']);
    // Agent row with NULL email excluded; active (emailed) client count = 3.
    const allEmails = [
      ...data.renewed.map((r) => r.email),
      ...data.watchlist.map((r) => r.email),
      ...data.churnRisk.map((r) => r.email),
    ];
    expect(allEmails).not.toContain(null);
    expect(allEmails).not.toContain(undefined);
    expect(allEmails).toHaveLength(3);
    expect(data.activeCount).toBe(3);
    expect(data.window.from.toISOString()).toBe(WINDOW_FROM.toISOString());
    expect(data.window.to.toISOString()).toBe(WINDOW_TO.toISOString());
  });

  it('reports an honest empty state when no clients qualify', async () => {
    // Only an agent row without email — no digestable clients at all.
    await seedClient(db, { keyHash: 'kh-sole-agent', kind: 'agent', email: null });

    const data = await buildWeeklyDigest(db, { from: WINDOW_FROM, to: WINDOW_TO });

    expect(data.renewed).toEqual([]);
    expect(data.watchlist).toEqual([]);
    expect(data.churnRisk).toEqual([]);
    expect(data.activeCount).toBe(0);
  });
});

describe('sendWeeklyDigest', () => {
  let db: Db;
  let log: Logger;
  const sendSpy = vi.fn();

  beforeEach(async () => {
    db = await makeTestDb();
    log = silentLogger();
    sendSpy.mockReset();
    // One client so the digest has real content.
    await db.query(
      `INSERT INTO api_clients (key_hash, kind, email, calls_remaining, current_period_end)
       VALUES ('kh-send-1', 'creem', 'renew@example.com', 50, $1)`,
      [new Date(WINDOW_TO.getTime() + 10 * 24 * 3600 * 1000)],
    );
  });

  afterEach(async () => {
    await db.end();
    vi.restoreAllMocks();
  });

  async function sendEnv(overrides: Record<string, unknown> = {}) {
    return {
      db,
      log,
      resendApiKey: 're_test_abcdefghijklmnopqrstuvwxyz0123456789',
      from: 'digest@licita.example',
      bcc: 'ops@licita.example,ceo@licita.example',
      baseUrl: 'https://licita.example',
      now: WINDOW_TO,
      send: sendSpy,
      ...overrides,
    };
  }

  it('sends exactly one digest email addressed only to from and bcc', async () => {
    const sent = await sendWeeklyDigest(await sendEnv());
    expect(sent).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const [callLog, apiKey, payload, tag] = sendSpy.mock.calls[0] as [
      Logger,
      string,
      ResendEmailPayload,
      string,
    ];
    expect(callLog).toBe(log);
    expect(apiKey).toBe('re_test_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(tag).toBe('digest');
    // Rate-guard: recipients are exactly from (to) + bcc list — nothing else.
    expect(payload.to).toEqual(['digest@licita.example']);
    expect(payload.bcc).toEqual(['ops@licita.example', 'ceo@licita.example']);
    const allRecipients = [...payload.to, ...(payload.bcc ?? [])];
    expect(allRecipients.every((r) => r === 'digest@licita.example' || r === 'ops@licita.example' || r === 'ceo@licita.example')).toBe(true);

    // Subject names the window; html carries the sections + client evidence.
    expect(payload.subject).toContain('Renewal Radar');
    expect(payload.subject).toContain('2026');
    expect(payload.html).toContain('EU Tech-Policy Deadlines');
    expect(payload.html).toContain('renew@example.com');
    expect(payload.from).toBe('digest@licita.example');
  });

  it('does not send when DIGEST_FROM_EMAIL is empty (rate-guard)', async () => {
    const sent = await sendWeeklyDigest(await sendEnv({ from: '' }));
    expect(sent).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does not send when DIGEST_BCC is empty (rate-guard)', async () => {
    const sent = await sendWeeklyDigest(await sendEnv({ bcc: '' }));
    expect(sent).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does not send when RESEND_API_KEY is empty (dev/test no-secrets run)', async () => {
    const sent = await sendWeeklyDigest(await sendEnv({ resendApiKey: '' }));
    expect(sent).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
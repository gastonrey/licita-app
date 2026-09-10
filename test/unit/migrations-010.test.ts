// C1.1 migration 010_webhook_events.sql — webhook event idempotency table.
//
// Executes the REAL migration file against pg-mem (same pattern as
// migrations-009.test.ts): pre-seed 001/005, run 002..009, then 010.
// Verifies the table schema, replay-safety, and idempotent INSERT behavior.

import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { runMigrations } from '../../src/db/migrate.js';
import { TEST_SCHEMA_SQL } from './testdb.js';

const BASE_SCHEMA_SQL = `
${TEST_SCHEMA_SQL}
`;

/**
 * Set up pg-mem with the current app schema (TEST_SCHEMA_SQL includes all
 * columns through 009). Pre-seed 001/005 as already applied (pg-mem
 * incompatibility: unaccent extension + plpgsql DO block).
 */
async function makeMigratedDb() {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const db = new Pool();
  await db.query(BASE_SCHEMA_SQL);
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  );
  // TEST_SCHEMA_SQL already mirrors 001..009 (see testdb.ts header), so
  // pre-seed all those migrations to avoid ALTER TABLE re-adding columns.
  await db.query(
    `INSERT INTO schema_migrations(name) VALUES
      ('001_core.sql'),
      ('002_payments_x402.sql'),
      ('003_identity.sql'),
      ('004_observability.sql'),
      ('005_sequence_grants.sql'),
      ('006_credits.sql'),
      ('007_demo_requests.sql'),
      ('008_demo_funnel.sql'),
      ('009_trial_api_keys.sql')`,
  );
  return db as unknown as Parameters<typeof runMigrations>[0];
}

describe('migration 010_webhook_events.sql (pg-mem verbatim)', () => {
  it('applies 010 on top of 001..009 and re-runs as a clean no-op (replay-safe)', async () => {
    const db = await makeMigratedDb();

    const first = await runMigrations(db);
    expect(first).toContain('010_webhook_events.sql');

    // Replay-safety: a second run applies nothing.
    const second = await runMigrations(db);
    expect(second).toEqual([]);
  });

  it('creates webhook_events with id, event_id UNIQUE, type, status, timestamps', async () => {
    const db = await makeMigratedDb();
    await runMigrations(db);

    const cols = await db.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'webhook_events'
       ORDER BY ordinal_position`,
    );
    const map = Object.fromEntries(
      (cols.rows as Array<{ column_name: string; data_type: string; is_nullable: string }>).map(
        (r) => [r.column_name, r.data_type],
      ),
    );

    expect(map.id).toBeDefined();
    expect(map.event_id).toBe('text');
    expect(map.type).toBe('text');
    expect(map.status).toBe('text');
    expect(map.created_at).toBeDefined();
    expect(map.updated_at).toBeDefined();

    // Verify event_id has a UNIQUE constraint (information_schema may not show
    // unique constraints directly; verify via INSERT behavior below).
  });

  it('enforces event_id UNIQUE — duplicate event_id is rejected', async () => {
    const db = await makeMigratedDb();
    await runMigrations(db);

    await db.query(
      `INSERT INTO webhook_events (event_id, type, status, requested_at)
       VALUES ('evt_001', 'checkout.session.completed', 'processing', now())`,
    );

    await expect(
      db.query(
        `INSERT INTO webhook_events (event_id, type, status, requested_at)
         VALUES ('evt_001', 'checkout.session.completed', 'processing', now())`,
      ),
    ).rejects.toThrow(/duplicate/i);
  });

  it('accepts all three valid statuses: processing, completed, failed', async () => {
    const db = await makeMigratedDb();
    await runMigrations(db);

    const entries: Array<[string, string]> = [
      ['evt_s1', 'processing'],
      ['evt_s2', 'completed'],
      ['evt_s3', 'failed'],
    ];
    for (const [eventId, status] of entries) {
      await db.query(
        `INSERT INTO webhook_events (event_id, type, status, requested_at)
         VALUES ($1, 'invoice.paid', $2, now())`,
        [eventId, status],
      );
    }

    const rows = await db.query('SELECT event_id, status FROM webhook_events ORDER BY event_id');
    expect(rows.rows).toEqual([
      { event_id: 'evt_s1', status: 'processing' },
      { event_id: 'evt_s2', status: 'completed' },
      { event_id: 'evt_s3', status: 'failed' },
    ]);
  });

  it('supports INSERT ... ON CONFLICT (event_id) DO NOTHING for idempotent inserts', async () => {
    const db = await makeMigratedDb();
    await runMigrations(db);

    // First insert: row is created.
    await db.query(
      `INSERT INTO webhook_events (event_id, type, status, requested_at)
       VALUES ('evt_idem_1', 'checkout.session.completed', 'processing', now())
       ON CONFLICT (event_id) DO NOTHING`,
    );
    const countAfterFirst = await db.query('SELECT count(*)::int AS n FROM webhook_events');
    expect((countAfterFirst.rows[0] as { n: number }).n).toBe(1);

    // Duplicate insert: ON CONFLICT DO NOTHING — no error, no new row.
    await db.query(
      `INSERT INTO webhook_events (event_id, type, status, requested_at)
       VALUES ('evt_idem_1', 'checkout.session.completed', 'processing', now())
       ON CONFLICT (event_id) DO NOTHING`,
    );
    const countAfterSecond = await db.query('SELECT count(*)::int AS n FROM webhook_events');
    expect((countAfterSecond.rows[0] as { n: number }).n).toBe(1);

    // A different event_id inserts fine.
    await db.query(
      `INSERT INTO webhook_events (event_id, type, status, requested_at)
       VALUES ('evt_idem_2', 'invoice.paid', 'processing', now())
       ON CONFLICT (event_id) DO NOTHING`,
    );
    const countAfterThird = await db.query('SELECT count(*)::int AS n FROM webhook_events');
    expect((countAfterThird.rows[0] as { n: number }).n).toBe(2);
  });

  it('does not affect existing tables (api_clients, payments, etc.)', async () => {
    const db = await makeMigratedDb();
    await runMigrations(db);

    // Original 001 tables still exist and are functional
    const apiClientsCols = await db.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'api_clients' ORDER BY ordinal_position`,
    );
    expect(apiClientsCols.rows.length).toBeGreaterThan(0);
    const colNames = apiClientsCols.rows.map((r: { column_name: string }) => r.column_name);
    expect(colNames).toContain('key_hash');
    expect(colNames).toContain('email');
  });
});

// B1.1 migration 009 (trial api_clients activation) — pg-mem verbatim test.
//
// Executes the REAL migration files from migrations/ against pg-mem:
// - 001_core.sql and 005_sequence_grants.sql are pre-seeded as applied because
//   pg-mem cannot parse them (001: unaccent extension + generated tsvector
//   column; 005: plpgsql DO block) — same documented limitation as
//   test/unit/testdb.ts.
// - 002, 003, 004, 006, 007, 008 run verbatim on top of the 001-mirror base.
// - 009 (the file under test) must apply cleanly and be replay-safe.
//
// The kind domain ('agent' | 'trial' | 'pro') is enforced by Zod in the app
// (no DB CHECK — design Decision for 009), so the domain test imports the app
// schema.

import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { runMigrations } from '../../src/db/migrate.js';
import { TEST_SCHEMA_SQL } from './testdb.js';
import { apiClientKindSchema } from '../../src/api/validate.js';

const BASE_SCHEMA_SQL = `
${TEST_SCHEMA_SQL}
`;
const STRIP_009_SQL = `
DROP INDEX api_clients_email_lower_ux;
ALTER TABLE api_clients DROP COLUMN current_period_end;
ALTER TABLE api_clients DROP COLUMN expires_at;
ALTER TABLE api_clients DROP COLUMN calls_remaining;
ALTER TABLE api_clients DROP COLUMN email;
`;

/**
 * Base schema mirroring what 001_core.sql produces on real PostgreSQL, minus
 * the pg-mem-incompatible pieces (see header). TEST_SCHEMA_SQL carries the
 * post-009 api_clients mirror for the rest of the unit suite, so here we strip
 * the 009 columns back to the ORIGINAL 001 shape — then migration 009's ADD
 * COLUMNs are what add them again (pg-mem clutters its constraint registry on
 * DROP TABLE, so we ALTER rather than drop/recreate).
 */
async function makeMigratedDb() {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const db = new Pool();
  await db.query(BASE_SCHEMA_SQL);
  await db.query(STRIP_009_SQL);
  await db.query(
    'CREATE TABLE schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  );
  // 001 and 005 are pg-mem-incompatible; everything else runs verbatim.
  await db.query("INSERT INTO schema_migrations(name) VALUES ('001_core.sql'), ('005_sequence_grants.sql')");
  return db as unknown as Parameters<typeof runMigrations>[0];
}

describe('migration 009_trial_api_keys.sql (pg-mem verbatim)', () => {
  it('applies 009 on top of 001..008 (skipping 001/005 pg-mem gaps) and re-runs as a clean no-op', async () => {
    const db = await makeMigratedDb();

    const first = await runMigrations(db);
    expect(first).toContain('009_trial_api_keys.sql');
    // 002..008 were expected to apply in the same pass (001/005 pre-seeded).
    for (const f of ['002_payments_x402.sql', '003_identity.sql', '004_observability.sql', '006_credits.sql', '007_demo_requests.sql', '008_demo_funnel.sql']) {
      expect(first).toContain(f);
    }

    // Replay-safety: a second run applies nothing.
    const second = await runMigrations(db);
    expect(second).toEqual([]);
  });

  it('adds email/calls_remaining/expires_at/current_period_end to api_clients', async () => {
    const db = await makeMigratedDb();
    await runMigrations(db);

    const cols = await db.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'api_clients' ORDER BY ordinal_position`,
    );
    const map = Object.fromEntries((cols.rows as Array<{ column_name: string; data_type: string }>).map((r) => [r.column_name, r.data_type]));
    expect(map.email).toBe('text');
    expect(map.calls_remaining).toBe('integer');
    // pg-mem reports timestamptz compactly (prod PostgreSQL expands it)
    expect(map.expires_at).toMatch(/timestamptz|timestamp with time zone/);
    expect(map.current_period_end).toMatch(/timestamptz|timestamp with time zone/);
    // original 001 columns preserved
    expect(map.key_hash).toBe('text');
    expect(map.kind).toBe('text');
  });

  it('kind domain is enforced by Zod (agent|trial|pro) and rejects bogus values', async () => {
    for (const kind of ['agent', 'trial', 'pro']) {
      expect(apiClientKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(apiClientKindSchema.safeParse('bogus').success).toBe(false);
  });

  it('lower(email) unique index dedupes normalized emails yet leaves NULL (agent) emails unaffected', async () => {
    const db = await makeMigratedDb();
    await runMigrations(db);

    // two agent rows with NULL email are distinct in the unique index
    await db.query("INSERT INTO api_clients (key_hash, kind) VALUES ('h-agent-1', 'agent')");
    await db.query("INSERT INTO api_clients (key_hash, kind) VALUES ('h-agent-2', 'agent')");

    // mixed-case duplicates collide on lower(email)
    await db.query(
      "INSERT INTO api_clients (key_hash, kind, email, calls_remaining, expires_at) VALUES ('h-trial-1', 'trial', 'Work@Example.COM', 25, now() + interval '14 days')",
    );
    await expect(
      db.query(
        "INSERT INTO api_clients (key_hash, kind, email, calls_remaining, expires_at) VALUES ('h-trial-2', 'trial', 'work@example.com', 25, now() + interval '14 days')",
      ),
    ).rejects.toThrow(/duplicate/i);

    // a third distinct email is fine; agent rows still there
    await db.query(
      "INSERT INTO api_clients (key_hash, kind, email) VALUES ('h-trial-3', 'trial', 'other@example.com')",
    );
    const rows = await db.query('SELECT key_hash, email, calls_remaining FROM api_clients ORDER BY key_hash');
    expect(rows.rows).toEqual([
      { key_hash: 'h-agent-1', email: null, calls_remaining: null },
      { key_hash: 'h-agent-2', email: null, calls_remaining: null },
      { key_hash: 'h-trial-1', email: 'Work@Example.COM', calls_remaining: 25 },
      { key_hash: 'h-trial-3', email: 'other@example.com', calls_remaining: null },
    ]);
  });
});
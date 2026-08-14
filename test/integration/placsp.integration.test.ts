// PLACSP integration slice (P0.3): REAL PLACSP sindicación feeds (live,
// maxPages=1, a handful of docs) persisted into a REAL embedded PostgreSQL
// (scripts/dev-db.ts, port 5433).
//
// NOT run by default (`npm test` is unit-only). Run explicitly:
//   npx vitest run -c test/vitest.integration.config.ts
//
// Network guard: if contrataciondelsectorpublico.gob.es is unreachable from
// this environment, the whole suite skips with a clear message. The portal
// also serves an F5-style WAF "Request Rejected" page (HTTP 200) when it
// temporarily throttles an IP; that is treated like unreachable — skipped
// with a warning, NOT a failure — because it is an upstream transient state,
// not a code/parser defect.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { createDb, type Db } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runIngestOnce, type IngestSummary } from '../../src/ingest/cli.js';
import { isWafBlockPage, PLACSP_FEEDS } from '../../src/ingest/placsp.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PG_PORT = 5433;
const PG_URL = `postgres://licita:licita@127.0.0.1:${PG_PORT}/licita`;

async function probePlacsp(): Promise<{ ok: boolean; blocked: boolean }> {
  try {
    // HEAD is rejected by the server: a ranged GET probing the first bytes.
    const res = await fetch(PLACSP_FEEDS.licitaciones, {
      headers: { range: 'bytes=0-2048' },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (isWafBlockPage(text)) return { ok: true, blocked: true };
    return { ok: res.status > 0, blocked: false };
  } catch {
    return { ok: false, blocked: false };
  }
}

const PLACSP_PROBE = await probePlacsp();
const PLACSP_OK = PLACSP_PROBE.ok;
const PLACSP_BLOCKED = PLACSP_PROBE.blocked;
if (!PLACSP_OK) {
  console.warn(
    '[integration] PLACSP feeds unreachable from this environment — ' +
      'SKIPPING the PLACSP integration slice. Re-run with network access.',
  );
} else if (PLACSP_BLOCKED) {
  console.warn(
    '[integration] PLACSP portal is temporarily blocking this IP (WAF "Request Rejected") — ' +
      'SKIPPING the PLACSP integration slice. This is an upstream transient state, not a code defect.',
  );
}

function waitForDevDb(child: ChildProcess, output: { text: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`dev-db did not become ready. Output so far:\n${output.text}`)),
      120_000,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      output.text += chunk.toString();
      if (output.text.includes(`running on port ${PG_PORT}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`dev-db exited early (code ${code}). Output:\n${output.text}`));
    });
  });
}

async function existingDb(): Promise<Db | null> {
  try {
    const db = createDb({ databaseUrl: PG_URL } as AppConfig);
    await db.query('SELECT 1');
    return db;
  } catch {
    return null;
  }
}

describe.runIf(PLACSP_OK && !PLACSP_BLOCKED)('integration: live PLACSP slice → real postgres', () => {
  let db: Db;
  let devDb: ChildProcess | null = null;
  let summary: IngestSummary;

  beforeAll(async () => {
    const existing = await existingDb();
    if (existing) {
      db = existing;
      console.log('[integration] reusing postgres already listening on 5433');
    } else {
      const cwd = mkdtempSync(join(tmpdir(), 'licita-epg-'));
      const output = { text: '' };
      devDb = spawn('npx', ['tsx', join(REPO_ROOT, 'scripts/dev-db.ts')], {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      devDb.stderr?.on('data', (c: Buffer) => {
        output.text += c.toString();
      });
      await waitForDevDb(devDb, output);
      db = createDb({ databaseUrl: PG_URL } as AppConfig);
    }

    const config: AppConfig = {
      ...loadConfig(),
      databaseUrl: PG_URL,
      paymentsMode: 'dev',
      payHmacSecret: 'integration-secret',
      operatorKey: 'integration-operator',
      ingestOnBoot: false,
      ingestMonths: 1,
      placsp: { enabled: true, maxPages: 1, delayMs: 500, schedule: false },
    };
    await runMigrations(db);
    // Tiny live slice: at most 6 docs across both feeds.
    summary = await runIngestOnce(config, db, { source: 'placsp', maxNotices: 6 });
    console.log(`[integration] placsp ingest summary: ${JSON.stringify(summary)}`);
  }, 300_000);

  afterAll(async () => {
    if (db) await db.end();
    if (devDb) {
      devDb.kill('SIGINT');
      await new Promise((r) => setTimeout(r, 3000));
      if (!devDb.killed) devDb.kill('SIGKILL');
    }
  });

  it('ingested real PLACSP docs (tenders/awards, zero errors)', () => {
    expect(summary.errors).toBe(0);
    expect(summary.notices_seen).toBeGreaterThan(0);
    expect(summary.tenders).toBeGreaterThan(0);
    // The menores feed is all RES → at least one award is expected.
    expect(summary.upserted).toBeGreaterThan(0);
  });

  it('rows carry placsp provenance and raw payloads', async () => {
    const src = (await db.query(`SELECT id FROM sources WHERE code = 'placsp'`)).rows[0] as {
      id: number;
    };
    const t = (
      await db.query(
        'SELECT source_ref, url, raw FROM tenders WHERE source_id = $1 LIMIT 1',
        [src.id],
      )
    ).rows[0] as { source_ref: string; url: string | null; raw: { feed?: string } };
    expect(t.source_ref).toMatch(/^placsp:/);
    expect(t.url).toMatch(/^https:\/\/contrataciondel(estado|sectorpublico)\./);
    expect(t.raw?.feed).toMatch(/^(licitaciones|menores)$/);
    const a = (
      await db.query(
        `SELECT a.source_ref, a.raw FROM awards a
         JOIN tenders t ON t.id = a.tender_id WHERE t.source_id = $1 LIMIT 1`,
        [src.id],
      )
    ).rows[0] as { source_ref: string };
    expect(a.source_ref).toMatch(/^placsp:/);
  });

  it('re-ingest of the same slice is idempotent', async () => {
    const count = async (table: string): Promise<number> =>
      Number(((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0] as { n: string }).n);
    const before = {
      tenders: await count('tenders'),
      awards: await count('awards'),
      companies: await count('companies'),
    };
    const config: AppConfig = {
      ...loadConfig(),
      databaseUrl: PG_URL,
      paymentsMode: 'dev',
      payHmacSecret: 'integration-secret',
      operatorKey: 'integration-operator',
      ingestMonths: 1,
      placsp: { enabled: true, maxPages: 1, delayMs: 500, schedule: false },
    };
    const again = await runIngestOnce(config, db, { source: 'placsp', maxNotices: 6 });
    expect(again.errors).toBe(0);
    expect(await count('tenders')).toBe(before.tenders);
    expect(await count('awards')).toBe(before.awards);
    expect(await count('companies')).toBe(before.companies);
  }, 300_000);
});

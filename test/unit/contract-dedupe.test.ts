// Contract dedupe (migration 013). pg-mem cannot run plpgsql or window
// functions, so this file boots embedded Postgres and applies the real
// migrations. The fixture is the proposal-A key from the 2026-10-26 report:
// mark a TED republication (SAS 15.2 M€) and a TED/PLACSP cross; do not mark
// PLACSP lots, a multi-awardee framework, a same-source renewal with a
// different start, or a zero-value pair. On the prod copy that key marked
// 99 groups / 112 rows, touched 47 signals, was idempotent, and made no chains.
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSearchQuery } from '../../src/api/routes/search.js';
import { searchQuerySchema } from '../../src/api/validate.js';
import type { AppConfig } from '../../src/config.js';
import { createDb, type Db } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { recomputeSignals } from '../../src/forecast/signals.js';
import { runIngestOnce } from '../../src/ingest/cli.js';
import { makeTestConfig } from './testconfig.js';

const MIGRATION = readFileSync(new URL('../../migrations/013_contract_dedupe.sql', import.meta.url), 'utf8');
const PG_PORT = 55432;

/** "Servicio andaluz de salud lote" is 30 characters: the title key. */
const SAS_TITLE = 'Servicio andaluz de salud lote';
/** 31 characters; the first 30 are the cross-source title key. */
const CROSS_TITLE = 'Ayuntamiento esplublico soporte';

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

interface SeededRow {
  contractId: number;
  awardId: number;
  tenderId: number;
  awardRef: string;
  buyerId: number;
}

interface Notice {
  key: string;
  source: 'ted' | 'placsp';
  buyer: string;
  company: string;
  nif: string | null;
  cpv: string;
  title: string;
  value: number;
  start: string;
  /** Award date for recurrence. Defaults to start. The dedupe key uses start. */
  award?: string;
  end: string | null;
  pub: string;
  tenderRef: string;
  awardRef: string;
  lot?: string;
  framework?: boolean;
  shareTender?: string;
}

function num(v: unknown): number {
  return Number(v);
}

async function refreshCounts(q: Queryable): Promise<{ groups: number; marked: number }> {
  const res = await q.query('SELECT * FROM refresh_contract_dups()');
  const row = res.rows[0] ?? {};
  return { groups: num(row.groups ?? 0), marked: num(row.marked ?? 0) };
}

async function dupMap(q: Queryable): Promise<Map<number, number | null>> {
  const res = await q.query('SELECT id, dup_of FROM contracts ORDER BY id');
  const map = new Map<number, number | null>();
  for (const row of res.rows) {
    map.set(num(row.id), row.dup_of == null ? null : num(row.dup_of));
  }
  return map;
}

describe('migration 013 SQL', () => {
  it('keeps the tested function, including the temp-table reset', () => {
    expect(SAS_TITLE.length).toBe(30);
    expect(CROSS_TITLE.length).toBe(31);
    expect(MIGRATION).toContain('ALTER TABLE contracts ADD COLUMN IF NOT EXISTS dup_of bigint REFERENCES contracts(id)');
    expect(MIGRATION).toContain(
      'CREATE INDEX IF NOT EXISTS idx_contracts_dup_of ON contracts(dup_of) WHERE dup_of IS NOT NULL',
    );
    expect(MIGRATION).toContain('DROP TABLE IF EXISTS _cx,_g,_r;');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION refresh_contract_dups()');
  });
});

describe('refresh_contract_dups on Postgres', () => {
  let pg: EmbeddedPostgres | null = null;
  let db: Db | null = null;
  let dir = '';
  let url = '';
  let seeded: Record<string, SeededRow> = {};

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'licita-dedupe-'));
    const logs: string[] = [];
    pg = new EmbeddedPostgres({
      databaseDir: join(dir, 'pg'),
      user: 'licita',
      password: 'licita',
      port: PG_PORT,
      persistent: false,
      onLog: (message: string) => {
        logs.push(message);
      },
      onError: (err: unknown) => {
        logs.push(String(err));
      },
    });
    try {
      await pg.initialise();
      await pg.start();
      await pg.createDatabase('licita');
    } catch (err) {
      throw new Error(`${String(err)}\n${logs.slice(-30).join('')}`);
    }
    url = `postgres://licita:licita@127.0.0.1:${PG_PORT}/licita`;
    db = createDb(makeTestConfig({ databaseUrl: url }));
    const first = await runMigrations(db);
    expect(first).toContain('013_contract_dedupe.sql');
    expect(await runMigrations(db)).toEqual([]);
    // The migrator runs the file once. The statements themselves must replay.
    await db.query(MIGRATION);

    const col = (
      await db.query(
        `SELECT data_type, is_nullable FROM information_schema.columns
         WHERE table_name = 'contracts' AND column_name = 'dup_of'`,
      )
    ).rows[0] as { data_type: string; is_nullable: string };
    expect(col.data_type).toBe('bigint');
    expect(col.is_nullable).toBe('YES');
    const indexdef = (
      await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_contracts_dup_of'`)
    ).rows[0] as { indexdef: string };
    expect(indexdef.indexdef).toContain('dup_of IS NOT NULL');
    const fn = (
      await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'refresh_contract_dups'`)
    ).rows[0] as { prosrc: string };
    expect(fn.prosrc.replace(/,\s+/g, ',')).toContain('DROP TABLE IF EXISTS _cx,_g,_r');

    seeded = await seedFixture(db);
  }, 120_000);

  afterAll(async () => {
    if (db) await db.end();
    if (pg) await pg.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }, 30_000);

  it('marks SAS and TED/PLACSP crosses, leaves lots and frameworks, and is idempotent', async () => {
    const pool = db as Db;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const q = client as unknown as Queryable;
      const first = await refreshCounts(q);
      const marks = await dupMap(q);
      // Second call in the same transaction: temp tables still exist, so the
      // DROP at the top of the function is what makes this idempotent.
      const second = await refreshCounts(q);
      const marksAgain = await dupMap(q);
      const chains = num(
        (await q.query(
          `SELECT count(*)::int AS n FROM contracts a
           JOIN contracts b ON b.id = a.dup_of WHERE b.dup_of IS NOT NULL`,
        )).rows[0].n,
      );
      const drifted = num(
        (await q.query(
          `SELECT count(*)::int AS n FROM contracts d
           JOIN contracts k ON k.id = d.dup_of
           WHERE d.value <> k.value OR d.cpv IS DISTINCT FROM k.cpv`,
        )).rows[0].n,
      );
      await client.query('COMMIT');

      expect(first).toEqual({ groups: 2, marked: 3 });
      expect(second).toEqual(first);
      expect(marksAgain).toEqual(marks);
      expect(chains).toBe(0);
      expect(drifted).toBe(0);

      const sasKeeper = seeded.sasKeeper.contractId;
      expect(marks.get(sasKeeper)).toBeNull();
      expect(marks.get(seeded.sasMarked.contractId)).toBe(sasKeeper);
      expect(marks.get(seeded.sasNoEnd.contractId)).toBe(sasKeeper);
      // PLACSP wins over an earlier TED row when both have an end date.
      expect(marks.get(seeded.crossPlacsp.contractId)).toBeNull();
      expect(marks.get(seeded.crossTed.contractId)).toBe(seeded.crossPlacsp.contractId);

      for (const key of ['lot1', 'lot2', 'fw1', 'fw2', 'prorroga1', 'prorroga2', 'zero1', 'zero2', 'sibling']) {
        expect(marks.get(seeded[key].contractId), key).toBeNull();
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }, 60_000);

  it('keeps duplicate contracts out of signals and contract search', async () => {
    const pool = db as Db;
    await recomputeSignals(pool);
    const signals = (
      await pool.query('SELECT contract_id, signal_type, buyer_id, basis FROM forecast_signals')
    ).rows as Array<{
      contract_id: string | number | null;
      signal_type: string;
      buyer_id: string | number | null;
      basis: Record<string, unknown> | string;
    }>;
    const signalContractIds = signals
      .map((r) => (r.contract_id == null ? null : num(r.contract_id)))
      .filter((id): id is number => id != null);
    const hidden = [
      seeded.sasMarked.contractId,
      seeded.sasNoEnd.contractId,
      seeded.crossTed.contractId,
    ];
    for (const id of hidden) expect(signalContractIds).not.toContain(id);
    expect(signalContractIds).toContain(seeded.sasKeeper.contractId);
    expect(signalContractIds).toContain(seeded.crossPlacsp.contractId);
    expect(signalContractIds).toContain(seeded.lot1.contractId);
    expect(signalContractIds).toContain(seeded.lot2.contractId);
    expect(signalContractIds).toContain(seeded.fw1.contractId);
    expect(signalContractIds).toContain(seeded.fw2.contractId);

    const basisOf = (row: (typeof signals)[number]): Record<string, unknown> =>
      typeof row.basis === 'string' ? (JSON.parse(row.basis) as Record<string, unknown>) : row.basis;
    const recurrence = signals.filter(
      (r) => r.signal_type === 'recurrence' && num(r.buyer_id) === seeded.sasKeeper.buyerId,
    );
    expect(recurrence).toHaveLength(1);
    const basis = basisOf(recurrence[0]);
    expect(basis.evidence_count).toBe(2);
    expect(basis.award_refs).toEqual([seeded.sibling.awardRef, seeded.sasKeeper.awardRef]);

    const contractQuery = buildSearchQuery(searchQuerySchema.parse({ type: 'contract', size: '50' }));
    const found = (await pool.query(contractQuery.text, contractQuery.values)).rows as Array<{
      row_id: string | number;
    }>;
    const foundIds = found.map((r) => num(r.row_id)).sort((a, b) => a - b);
    const expected = Object.values(seeded)
      .map((r) => r.contractId)
      .filter((id) => !hidden.includes(id))
      .sort((a, b) => a - b);
    expect(foundIds).toEqual(expected);

    const awardQuery = buildSearchQuery(searchQuerySchema.parse({ type: 'award', size: '50' }));
    const awards = (await pool.query(awardQuery.text, awardQuery.values)).rows as Array<{
      row_id: string | number;
    }>;
    const awardIds = awards.map((r) => num(r.row_id));
    expect(awardIds).toContain(seeded.sasMarked.awardId);
    expect(awardIds).toContain(seeded.crossTed.awardId);
  }, 60_000);

  it('clears with dup_of = NULL and marks again on the next refresh', async () => {
    const pool = db as Db;
    await pool.query('UPDATE contracts SET dup_of = NULL');
    await recomputeSignals(pool);
    const restored = (
      await pool.query(
        `SELECT contract_id FROM forecast_signals WHERE signal_type = 'duration_expiry'`,
      )
    ).rows.map((r) => num((r as { contract_id: string | number }).contract_id));
    expect(restored).toContain(seeded.sasMarked.contractId);
    expect(restored).toContain(seeded.crossTed.contractId);
    const evidenceRow = (
      await pool.query(
        `SELECT basis FROM forecast_signals WHERE signal_type = 'recurrence' AND buyer_id = $1`,
        [seeded.sasKeeper.buyerId],
      )
    ).rows[0] as { basis: { evidence_count?: number; award_refs?: string[] } } | undefined;
    expect(evidenceRow?.basis.evidence_count).toBe(4);
    expect(evidenceRow?.basis.award_refs).toContain(seeded.sasMarked.awardRef);
    expect(evidenceRow?.basis.award_refs).toContain(seeded.sasNoEnd.awardRef);

    expect(await refreshCounts(pool)).toEqual({ groups: 2, marked: 3 });
    const marks = await dupMap(pool);
    expect(marks.get(seeded.sasMarked.contractId)).toBe(seeded.sasKeeper.contractId);
    expect(marks.get(seeded.crossTed.contractId)).toBe(seeded.crossPlacsp.contractId);

    const lines: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => {
      if (typeof msg === 'string') lines.push(msg);
    };
    try {
      await runIngestOnce(makeTestConfig({ databaseUrl: url }), pool, { source: 'placsp' });
    } finally {
      console.log = orig;
    }
    const dedupe = lines
      .map((line) => {
        try {
          return JSON.parse(line) as { msg?: string; groups?: number; marked?: number };
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.msg === 'contract dedupe');
    expect(dedupe).toEqual({ level: 'info', msg: 'contract dedupe', groups: 2, marked: 3, ts: expect.any(String) });

    await recomputeSignals(pool);
    const hiddenAgain = (
      await pool.query('SELECT contract_id FROM forecast_signals WHERE contract_id = $1', [
        seeded.sasMarked.contractId,
      ])
    ).rows;
    expect(hiddenAgain).toEqual([]);
  }, 60_000);
});

async function seedFixture(pool: Db): Promise<Record<string, SeededRow>> {
  const ted = num((await pool.query(`INSERT INTO sources(code, name) VALUES ('ted', 'TED') RETURNING id`)).rows[0].id);
  const placsp = num(
    (await pool.query(`INSERT INTO sources(code, name) VALUES ('placsp', 'PLACSP') RETURNING id`)).rows[0].id,
  );
  // refresh_contract_dups prefers source_id 2, which is PLACSP in production.
  expect(ted).toBe(1);
  expect(placsp).toBe(2);
  const sourceId = { ted, placsp };

  const buyers = new Map<string, number>();
  const companies = new Map<string, number>();
  const tenders = new Map<string, number>();
  const out: Record<string, SeededRow> = {};

  const buyerId = async (source: 'ted' | 'placsp', nameNorm: string): Promise<number> => {
    const cache = `${source}|${nameNorm}`;
    const hit = buyers.get(cache);
    if (hit) return hit;
    const row = await pool.query(
      `INSERT INTO buyers(source_id, source_ref, name, name_norm, country)
       VALUES ($1, $2, $3, $3, 'ESP') RETURNING id`,
      [sourceId[source], `${nameNorm}|ESP`, nameNorm],
    );
    const id = num(row.rows[0].id);
    buyers.set(cache, id);
    return id;
  };

  const companyId = async (
    source: 'ted' | 'placsp',
    nameNorm: string,
    nif: string | null,
  ): Promise<number> => {
    const cache = `${source}|${nif ?? nameNorm}`;
    const hit = companies.get(cache);
    if (hit) return hit;
    const row = await pool.query(
      `INSERT INTO companies(source_id, source_ref, name, name_norm, country, nif)
       VALUES ($1, $2, $3, $3, 'ESP', $4) RETURNING id`,
      [sourceId[source], nif ?? nameNorm, nameNorm, nif],
    );
    const id = num(row.rows[0].id);
    companies.set(cache, id);
    return id;
  };

  const notices: Notice[] = [
    // TED x2 (+ a third copy). Keeper is the later id: it has an end date and
    // an earlier publication than the other ended row. The earliest id has no
    // end date, so it must not win.
    {
      key: 'sasNoEnd',
      source: 'ted',
      buyer: 'servicio andaluz de salud',
      company: 'adjudicatario sas',
      nif: 'A15200550',
      cpv: '85100000',
      title: `${SAS_TITLE} republicado`,
      value: 15_200_550,
      start: '2025-06-06',
      end: null,
      pub: '2025-01-01',
      tenderRef: '473543-2025',
      awardRef: '473543-2025',
      award: '2023-06-06',
    },
    {
      key: 'sasMarked',
      source: 'ted',
      buyer: 'servicio andaluz de salud',
      company: 'adjudicatario sas',
      nif: 'A15200550',
      cpv: '85100000',
      title: `${SAS_TITLE} aviso 582409`,
      value: 15_200_550,
      start: '2025-06-06',
      end: '2026-06-06',
      pub: '2026-02-01',
      tenderRef: '582409-2026',
      awardRef: '582409-2026',
      award: '2024-06-06',
    },
    {
      key: 'sasKeeper',
      source: 'ted',
      buyer: 'servicio andaluz de salud',
      company: 'adjudicatario sas',
      nif: 'A15200550',
      cpv: '85100000',
      title: `${SAS_TITLE} canonico`,
      value: 15_200_550,
      start: '2025-06-06',
      end: '2026-06-06',
      pub: '2025-06-01',
      tenderRef: '4066-keeper',
      awardRef: '4066-keeper',
      award: '2025-06-06',
    },
    // Same NIF, different name_norm, different start dates, both sources.
    {
      key: 'crossTed',
      source: 'ted',
      buyer: 'ayuntamiento de ejemplo',
      company: 'espublico',
      nif: 'B50369100',
      cpv: '72000000',
      title: `${CROSS_TITLE} ted`,
      value: 503_691,
      start: '2024-01-01',
      end: '2026-01-01',
      pub: '2024-02-01',
      tenderRef: 'ted-ayto-503691',
      awardRef: 'ted-ayto-503691',
    },
    {
      key: 'crossPlacsp',
      source: 'placsp',
      buyer: 'ayuntamiento de ejemplo',
      company: 'es publico sl',
      nif: 'B50369100',
      cpv: '72000000',
      title: `${CROSS_TITLE} placsp`,
      value: 503_691,
      start: '2024-06-01',
      end: '2026-06-01',
      pub: '2025-03-01',
      tenderRef: 'placsp-ayto-503691',
      awardRef: 'placsp-ayto-503691',
    },
    // Same tender, same company, same amount: PLACSP lots are not duplicates.
    {
      key: 'lot1',
      source: 'placsp',
      buyer: 'organismo de lotes',
      company: 'empresa lotes',
      nif: 'B00000010',
      cpv: '33000000',
      title: 'Suministro de material de oficina',
      value: 1_200,
      start: '2025-03-01',
      end: '2026-03-01',
      pub: '2025-03-15',
      tenderRef: 'placsp-lotes',
      awardRef: 'placsp-lote-1',
      lot: '1',
    },
    {
      key: 'lot2',
      source: 'placsp',
      buyer: 'organismo de lotes',
      company: 'empresa lotes',
      nif: 'B00000010',
      cpv: '33000000',
      title: 'Suministro de material de oficina',
      value: 1_200,
      start: '2025-03-01',
      end: '2026-03-01',
      pub: '2025-03-15',
      tenderRef: 'placsp-lotes-2',
      awardRef: 'placsp-lote-2',
      lot: '2',
      shareTender: 'placsp-lotes',
    },
    // Same buyer, amount, cpv, title and start, but two winners. Two tenders,
    // so the lot rule would not save them: the company key must.
    {
      key: 'fw1',
      source: 'ted',
      buyer: 'organismo de marco',
      company: 'empresa marco uno',
      nif: 'B00000001',
      cpv: '48000000',
      title: 'Acuerdo marco de servicios comunes',
      value: 195_800_000,
      start: '2025-01-01',
      end: '2027-01-01',
      pub: '2025-01-20',
      tenderRef: 'marco-1',
      awardRef: 'marco-1',
      framework: true,
    },
    {
      key: 'fw2',
      source: 'ted',
      buyer: 'organismo de marco',
      company: 'empresa marco dos',
      nif: 'B00000002',
      cpv: '48000000',
      title: 'Acuerdo marco de servicios comunes',
      value: 195_800_000,
      start: '2025-01-01',
      end: '2027-01-01',
      pub: '2025-01-20',
      tenderRef: 'marco-2',
      awardRef: 'marco-2',
      framework: true,
    },
    // Same key except the start date, one source: a renewal, not a duplicate.
    {
      key: 'prorroga1',
      source: 'ted',
      buyer: 'organismo de prorroga',
      company: 'empresa prorroga',
      nif: 'B00000020',
      cpv: '90000000',
      title: 'Limpieza viaria del municipio norte',
      value: 80_000,
      start: '2023-01-01',
      end: '2024-01-01',
      pub: '2023-01-15',
      tenderRef: 'prorroga-1',
      awardRef: 'prorroga-1',
    },
    {
      key: 'prorroga2',
      source: 'ted',
      buyer: 'organismo de prorroga',
      company: 'empresa prorroga',
      nif: 'B00000020',
      cpv: '90000000',
      title: 'Limpieza viaria del municipio norte',
      value: 80_000,
      start: '2024-06-01',
      end: '2025-06-01',
      pub: '2024-06-15',
      tenderRef: 'prorroga-2',
      awardRef: 'prorroga-2',
    },
    // value > 0 is part of the key. Two zero-amount notices must stay unmarked.
    {
      key: 'zero1',
      source: 'ted',
      buyer: 'organismo sin importe',
      company: 'empresa cero',
      nif: 'B00000030',
      cpv: '15000000',
      title: 'Servicio sin importe economico',
      value: 0,
      start: '2025-04-01',
      end: '2026-04-01',
      pub: '2025-04-02',
      tenderRef: 'cero-1',
      awardRef: 'cero-1',
    },
    {
      key: 'zero2',
      source: 'ted',
      buyer: 'organismo sin importe',
      company: 'empresa cero',
      nif: 'B00000030',
      cpv: '15000000',
      title: 'Servicio sin importe economico',
      value: 0,
      start: '2025-04-01',
      end: '2026-04-01',
      pub: '2025-05-02',
      tenderRef: 'cero-2',
      awardRef: 'cero-2',
    },
    // Same SAS buyer and CPV division, different contract. Counts toward recurrence.
    {
      key: 'sibling',
      source: 'ted',
      buyer: 'servicio andaluz de salud',
      company: 'adjudicatario sas',
      nif: 'A15200550',
      cpv: '85110000',
      title: 'Otro servicio de esterilizacion hospitalaria',
      value: 2_500,
      start: '2024-06-06',
      end: '2025-06-06',
      pub: '2024-06-10',
      tenderRef: 'sas-sibling',
      awardRef: 'sas-sibling',
      award: '2022-06-06',
    },
  ];

  for (const n of notices) {
    await pool.query('INSERT INTO cpvs(code) VALUES ($1) ON CONFLICT (code) DO NOTHING', [n.cpv]);
    const bId = await buyerId(n.source, n.buyer);
    const cId = await companyId(n.source, n.company, n.nif);
    let tenderId = n.shareTender ? tenders.get(n.shareTender) : undefined;
    if (n.shareTender && tenderId == null) throw new Error(`missing tender ${n.shareTender}`);
    if (tenderId == null) {
      const tender = await pool.query(
        `INSERT INTO tenders(source_id, source_ref, publication_date, buyer_id, title, cpv_main)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [sourceId[n.source], n.tenderRef, n.pub, bId, n.title, n.cpv],
      );
      tenderId = num(tender.rows[0].id);
      tenders.set(n.tenderRef, tenderId);
    }
    const award = await pool.query(
      `INSERT INTO awards(tender_id, source_ref, award_date, winner_company_id, lot, value,
                          framework, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        tenderId,
        n.awardRef,
        n.award ?? n.start,
        cId,
        n.lot ?? null,
        n.value,
        n.framework ?? false,
        n.start,
        n.end,
      ],
    );
    const awardId = num(award.rows[0].id);
    const contract = await pool.query(
      `INSERT INTO contracts(award_id, buyer_id, company_id, cpv, title, value, currency,
                             start_date, end_date, framework)
       VALUES ($1, $2, $3, $4, $5, $6, 'EUR', $7, $8, $9) RETURNING id`,
      [awardId, bId, cId, n.cpv, n.title, n.value, n.start, n.end, n.framework ?? false],
    );
    out[n.key] = {
      contractId: num(contract.rows[0].id),
      awardId,
      tenderId,
      awardRef: n.awardRef,
      buyerId: bId,
    };
  }
  return out;
}

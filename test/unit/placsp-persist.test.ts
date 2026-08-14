// PLACSP persistence tests: pg-mem round-trip proving idempotent upserts of
// tender/award/contract/events from REAL feed slices (fixtures, unmodified
// upstream values), plus the placsp source row registration.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAtomFeed } from '../../src/ingest/placsp-parse.js';
import {
  ensurePlacspSource,
  persistPlacspDoc,
  PLACSP_SOURCE,
} from '../../src/ingest/normalize-placsp.js';
import { countRows, makeTestDb } from './testdb.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const licPage = parseAtomFeed(
  readFileSync(join(fixturesDir, 'placsp-atom-licitaciones.xml'), 'utf8'),
  'licitaciones',
);
const menPage = parseAtomFeed(
  readFileSync(join(fixturesDir, 'placsp-atom-menores.xml'), 'utf8'),
  'menores',
);

function entryByFolder(folderId: string) {
  const found = licPage.entries.find((x) => JSON.stringify(x.statusNode).includes(folderId));
  if (!found) throw new Error(`fixture entry not found: ${folderId}`);
  return found;
}

describe('ensurePlacspSource', () => {
  it('inserts the placsp source row once, with license note', async () => {
    const db = await makeTestDb();
    const id1 = await ensurePlacspSource(db);
    const id2 = await ensurePlacspSource(db);
    expect(id2).toBe(id1);
    expect(await countRows(db, 'sources')).toBe(1);
    const row = (
      await db.query('SELECT code, name, base_url, license_note FROM sources')
    ).rows[0] as { code: string; name: string; base_url: string; license_note: string };
    expect(row.code).toBe('placsp');
    expect(row.name).toBe(PLACSP_SOURCE.name);
    expect(row.license_note).toContain('datos.gob.es/avisolegal');
  });
});

describe('persistPlacspDoc on pg-mem (real fixture entries)', () => {
  it('licitación-only doc: tender without awards, nulls not fabricated', async () => {
    const db = await makeTestDb();
    const sourceId = await ensurePlacspSource(db);
    const counts = await persistPlacspDoc(db, sourceId, entryByFolder('S-02027-2026'));
    expect(counts).toEqual({ buyers: 1, companies: 0, tenders: 1, awards: 0, contracts: 0 });

    const t = (
      await db.query(
        `SELECT source_ref, notice_type, publication_date AS pub, title, cpv_main,
                cpv_all, procedure_type, deadline AS dl, estimated_value, currency, description
         FROM tenders`,
      )
    ).rows[0] as Record<string, unknown>;
    expect(t.source_ref).toBe('placsp:S-02027-2026');
    expect(t.notice_type).toBe('EV');
    expect((t.pub as Date).toISOString().slice(0, 10)).toBe('2026-06-19');
    expect(t.cpv_main).toBe('72512000'); // IT-priority CPV wins
    expect(t.cpv_all).toEqual(['72512000', '79530000']);
    expect(t.procedure_type).toBe('1');
    expect((t.dl as Date).toISOString().slice(0, 10)).toBe('2026-07-20');
    expect(Number(t.estimated_value)).toBe(717120);
    expect(t.currency).toBe('EUR');
    expect(t.description).toBeNull();

    const b = (await db.query('SELECT name, source_ref, nuts FROM buyers')).rows[0] as Record<
      string,
      unknown
    >;
    expect(b.source_ref).toBe('nif:A84818558');
    expect(b.nuts).toBe('ES300');
    expect(await countRows(db, 'cpvs')).toBe(2);
  });

  it('adjudicación doc: winner company with NIF, award, contract, events; re-run idempotent', async () => {
    const db = await makeTestDb();
    const sourceId = await ensurePlacspSource(db);
    const entry = entryByFolder('020120230187');

    const counts = await persistPlacspDoc(db, sourceId, entry);
    expect(counts).toEqual({ buyers: 1, companies: 1, tenders: 1, awards: 1, contracts: 1 });

    const c = (
      await db.query('SELECT id, name, nif, source_ref FROM companies')
    ).rows[0] as { id: number; name: string; nif: string; source_ref: string };
    expect(c.name).toBe('TRANSVIA,S.L.');
    expect(c.nif).toBe('B46036398');
    expect(c.source_ref).toBe('nif:B46036398');

    // Identity backbone: nif + placsp identifiers registered for the winner.
    const identifiers = (
      await db.query(
        'SELECT scheme, value FROM company_identifiers WHERE company_id = $1 ORDER BY scheme',
        [c.id],
      )
    ).rows as Array<{ scheme: string; value: string }>;
    expect(identifiers).toEqual([
      { scheme: 'nif', value: 'B46036398' },
      { scheme: 'placsp', value: 'nif:B46036398' },
    ]);

    const a = (
      await db.query(
        `SELECT source_ref, award_date AS ad, value, currency, bidders_count,
                framework, duration_months, start_date AS sd, end_date
         FROM awards`,
      )
    ).rows[0] as Record<string, unknown>;
    expect(a.source_ref).toBe('placsp:020120230187');
    expect((a.ad as Date).toISOString().slice(0, 10)).toBe('2024-02-14');
    expect(Number(a.value)).toBe(770234.4);
    expect(a.currency).toBe('EUR');
    expect(a.bidders_count).toBe(1);
    expect(a.framework).toBe(false);
    expect(Number(a.duration_months)).toBe(24);
    expect((a.sd as Date).toISOString().slice(0, 10)).toBe('2024-02-14'); // no planned start → award date
    expect(a.end_date).toBeNull(); // explicit-only on awards; derived on contracts

    const contract = (
      await db.query('SELECT start_date AS sd, end_date AS ed, status FROM contracts')
    ).rows[0] as { sd: Date; ed: Date; status: string };
    expect(contract.sd.toISOString().slice(0, 10)).toBe('2024-02-14');
    expect(contract.ed.toISOString().slice(0, 10)).toBe('2026-02-14'); // 24m derived
    expect(contract.status).toBe('expired');

    const events = (
      await db.query('SELECT event_type, source_ref FROM contract_events ORDER BY event_type')
    ).rows as Array<{ event_type: string; source_ref: string }>;
    expect(events.map((e) => e.event_type)).toEqual(['award', 'expiry']);
    expect(events[0].source_ref).toBe('placsp:020120230187');

    // Idempotent re-ingest: zero new rows.
    await persistPlacspDoc(db, sourceId, entry);
    expect(await countRows(db, 'buyers')).toBe(1);
    expect(await countRows(db, 'tenders')).toBe(1);
    expect(await countRows(db, 'awards')).toBe(1);
    expect(await countRows(db, 'contracts')).toBe(1);
    expect(await countRows(db, 'contract_events')).toBe(2);
    expect(await countRows(db, 'company_identifiers')).toBe(2);
  });

  it('multi-lot RES: one award per lot, deduped by (tender, lot, source_ref)', async () => {
    const db = await makeTestDb();
    const sourceId = await ensurePlacspSource(db);
    const entry = entryByFolder('CON/2026/6');
    const counts = await persistPlacspDoc(db, sourceId, entry);
    expect(counts.awards).toBe(2);
    expect(await countRows(db, 'companies')).toBe(2);
    const lots = (
      await db.query('SELECT lot, source_ref, value FROM awards ORDER BY lot')
    ).rows as Array<{ lot: string; source_ref: string; value: string }>;
    expect(lots.map((l) => l.lot)).toEqual(['1', '2']);
    expect(lots[0].source_ref).toBe('placsp:CON/2026/6#1');
    expect(Number(lots[0].value)).toBe(60728.36);
    // re-run: same two awards, no duplicates
    await persistPlacspDoc(db, sourceId, entry);
    expect(await countRows(db, 'awards')).toBe(2);
    expect(await countRows(db, 'contracts')).toBe(2);
  });

  it('contrato menor: full chain; winner without NIF keeps null', async () => {
    const db = await makeTestDb();
    const sourceId = await ensurePlacspSource(db);
    for (const e of menPage.entries) await persistPlacspDoc(db, sourceId, e);
    expect(await countRows(db, 'tenders')).toBe(2);
    expect(await countRows(db, 'awards')).toBe(2);
    const elsevier = (
      await db.query(`SELECT nif, source_ref FROM companies WHERE name = 'ELSEVIER B.V.'`)
    ).rows[0] as { nif: string | null; source_ref: string };
    expect(elsevier.nif).toBeNull();
    expect(elsevier.source_ref).toMatch(/^name:elsevier b\.v\.\|/);
    const menor = (
      await db.query(
        `SELECT t.notice_type, t.procedure_type, a.award_date AS ad, a.value
         FROM awards a JOIN tenders t ON t.id = a.tender_id
         WHERE t.source_ref = 'placsp:CMENOR/2026/39N25/0266-2026/10529'`,
      )
    ).rows[0] as Record<string, unknown>;
    expect(menor.notice_type).toBe('RES');
    expect(menor.procedure_type).toBe('6');
    expect((menor.ad as Date).toISOString().slice(0, 10)).toBe('2026-05-18');
    expect(Number(menor.value)).toBe(3000);
  });

  it('entry without minimum identity is skipped (zero counts, no rows)', async () => {
    const db = await makeTestDb();
    const sourceId = await ensurePlacspSource(db);
    const counts = await persistPlacspDoc(db, sourceId, {
      feed: 'licitaciones',
      entryId: 'x',
      url: null,
      updated: null,
      statusNode: {},
      raw: null,
    });
    expect(counts).toEqual({ buyers: 0, companies: 0, tenders: 0, awards: 0, contracts: 0 });
    expect(await countRows(db, 'tenders')).toBe(0);
  });
});

// Upsert SQL builder tests: statement shape + parameter ordering, plus a
// pg-mem round-trip proving idempotent persistence end to end.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildAwardInsert,
  buildAwardSelect,
  buildAwardUpdate,
  buildBuyerUpsert,
  buildCompanyUpsert,
  buildContractEventInsert,
  buildContractUpsert,
  buildCpvInsert,
  buildTenderUpsert,
  ensureSource,
  parseTedNotice,
  persistNotice,
} from '../../src/ingest/normalize.js';
import type { TedSearchResponse } from '../../src/domain/types.js';
import { countRows, makeTestDb } from './testdb.js';

function placeholders(text: string): number {
  const ns = [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  return ns.length ? Math.max(...ns) : 0;
}

describe('SQL builders', () => {
  it('buyer/company upserts dedupe on (source_id, source_ref) with name_norm', () => {
    const b = buildBuyerUpsert({
      sourceId: 1,
      sourceRef: 'x|ESP',
      name: 'X',
      nameNorm: 'x',
      country: 'ESP',
      nuts: 'ES300',
      raw: null,
    });
    expect(b.text).toContain('ON CONFLICT (source_id, source_ref) DO UPDATE');
    expect(b.text).toContain('RETURNING id');
    expect(placeholders(b.text)).toBe(b.values.length);
    expect(b.values[1]).toBe('x|ESP');
    expect(b.values[3]).toBe('x');

    const c = buildCompanyUpsert({
      sourceId: 1,
      sourceRef: 'y|ESP',
      name: 'Y',
      nameNorm: 'y',
      country: 'ESP',
      nif: 'A28963767',
      raw: null,
    });
    // nif is never overwritten with NULL on re-ingest
    expect(c.text).toContain('nif = COALESCE(EXCLUDED.nif, companies.nif)');
    expect(placeholders(c.text)).toBe(c.values.length);
  });

  it('cpv insert is code-only, labels stay null', () => {
    const s = buildCpvInsert('72000000');
    expect(s.text).toBe('INSERT INTO cpvs(code) VALUES ($1) ON CONFLICT (code) DO NOTHING');
    expect(s.values).toEqual(['72000000']);
  });

  it('tender upsert and award statements have matching params', () => {
    const t = buildTenderUpsert({
      sourceId: 1,
      sourceRef: '1-2026',
      noticeType: 'can-standard',
      publicationDate: '2026-07-01',
      buyerId: 7,
      title: null,
      description: null,
      cpvMain: '72000000',
      cpvAll: ['72000000'],
      nuts: 'ES300',
      url: 'https://ted.europa.eu/en/notice/-/detail/1-2026',
      raw: null,
    });
    expect(t.text).toContain('ON CONFLICT (source_id, source_ref) DO UPDATE');
    expect(placeholders(t.text)).toBe(t.values.length);

    const sel = buildAwardSelect(5, null, '1-2026');
    expect(sel.text).toContain("COALESCE(lot, '') = COALESCE($2, '')");

    const award = {
      sourceRef: '1-2026',
      awardDate: '2026-06-30',
      winnerCompanyId: 3,
      lot: null,
      value: 10,
      currency: 'EUR',
      biddersCount: 2,
      framework: false,
      durationMonths: 12,
      startDate: '2026-06-30',
      endDate: null,
      raw: null,
    };
    const ins = buildAwardInsert({ tenderId: 5, ...award });
    expect(placeholders(ins.text)).toBe(ins.values.length);
    const upd = buildAwardUpdate(9, award);
    expect(upd.values[0]).toBe(9);
    expect(placeholders(upd.text)).toBe(upd.values.length);
  });

  it('contract upsert keys on award_id; events carry provenance', () => {
    const c = buildContractUpsert({
      awardId: 11,
      buyerId: 7,
      companyId: 3,
      cpv: '72000000',
      title: null,
      value: 10,
      currency: 'EUR',
      startDate: '2026-06-30',
      endDate: '2027-06-30',
      durationMonths: 12,
      framework: false,
      renewalWindowStart: null,
      renewalWindowEnd: null,
      status: 'active',
    });
    expect(c.text).toContain('ON CONFLICT (award_id) DO UPDATE');
    expect(placeholders(c.text)).toBe(c.values.length);

    const e = buildContractEventInsert({
      contractId: 2,
      eventType: 'expiry',
      eventDate: '2027-06-30',
      details: { source: 'ted', source_ref: '1-2026' },
      sourceRef: '1-2026',
    });
    expect(e.values[4]).toBe('1-2026');
  });
});

describe('persistNotice on pg-mem (fixtures from real TED responses)', () => {
  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
  const fixture = JSON.parse(
    readFileSync(join(fixturesDir, 'ted-search-es-can-it.json'), 'utf8'),
  ) as TedSearchResponse;
  const multi = JSON.parse(
    readFileSync(join(fixturesDir, 'ted-search-es-multiwinner-duration.json'), 'utf8'),
  ) as TedSearchResponse;

  it('upserts buyers/tender/award/contract/events with provenance; re-run is idempotent', async () => {
    const db = await makeTestDb();
    const sourceId = await ensureSource(db);

    const counts = await persistNotice(db, sourceId, fixture.notices[0]);
    expect(counts).toEqual({ buyers: 1, companies: 1, tenders: 1, awards: 1, contracts: 1 });

    expect(await countRows(db, 'buyers')).toBe(1);
    expect(await countRows(db, 'tenders')).toBe(1);
    expect(await countRows(db, 'awards')).toBe(1);
    expect(await countRows(db, 'contracts')).toBe(1);
    expect(await countRows(db, 'contract_events')).toBe(1); // award event only (no dates)
    const cpvCount = await countRows(db, 'cpvs');
    expect(cpvCount).toBeGreaterThan(0);

    const buyer = (await db.query('SELECT name_norm, country, nif FROM buyers')).rows[0] as {
      name_norm: string;
      country: string;
      nif: string | null;
    };
    expect(buyer.name_norm).toBe('junta de contratacion del ministerio de sanidad');
    expect(buyer.nif).toBe('S2827001E'); // parsed from TED buyer-identifier
    const company = (await db.query('SELECT nif FROM companies')).rows[0] as { nif: string };
    expect(company.nif).toBe('A28963767');

    // Identity backbone: nif + per-source identifiers registered.
    const identifiers = (
      await db.query('SELECT scheme, value FROM company_identifiers ORDER BY scheme')
    ).rows as Array<{ scheme: string; value: string }>;
    expect(identifiers).toEqual([
      { scheme: 'nif', value: 'A28963767' },
      { scheme: 'ted', value: 'tecnilogica ecosistemas, s.a.u.|ESP' },
    ]);

    // Re-ingest the same notice: zero new rows (idempotent upsert).
    await persistNotice(db, sourceId, fixture.notices[0]);
    expect(await countRows(db, 'buyers')).toBe(1);
    expect(await countRows(db, 'tenders')).toBe(1);
    expect(await countRows(db, 'awards')).toBe(1);
    expect(await countRows(db, 'contracts')).toBe(1);
    expect(await countRows(db, 'contract_events')).toBe(1);
    expect(await countRows(db, 'cpvs')).toBe(cpvCount);
    expect(await countRows(db, 'company_identifiers')).toBe(2);
  });

  it('dedupes buyers by name_norm+country across notices', async () => {
    const db = await makeTestDb();
    const sourceId = await ensureSource(db);
    for (const n of fixture.notices) await persistNotice(db, sourceId, n);
    // 3 distinct buyers in the fixture
    expect(await countRows(db, 'buyers')).toBe(3);
    expect(await countRows(db, 'tenders')).toBe(3);
  });

  it('multi-winner notice yields one award per winner, deduped on re-run', async () => {
    const db = await makeTestDb();
    const sourceId = await ensureSource(db);
    const notice = multi.notices.find(
      (n) => n['publication-number'] === '539696-2026',
    )!;
    const counts = await persistNotice(db, sourceId, notice);
    expect(counts.awards).toBe(4);
    expect(await countRows(db, 'companies')).toBe(4);
    // duration (10 MONTH) + conclusion date → award + expiry events per contract
    expect(await countRows(db, 'contract_events')).toBe(8);
    await persistNotice(db, sourceId, notice);
    expect(await countRows(db, 'awards')).toBe(4);
    expect(await countRows(db, 'contract_events')).toBe(8);
  });

  it('derives contract end_date from duration and stores expiry event', async () => {
    const db = await makeTestDb();
    const sourceId = await ensureSource(db);
    const notice = multi.notices.find(
      (n) => n['publication-number'] === '533655-2026',
    )!;
    await persistNotice(db, sourceId, notice);
    const contract = (
      await db.query('SELECT start_date, end_date, duration_months FROM contracts')
    ).rows[0] as { start_date: Date; end_date: Date; duration_months: number };
    expect(contract.end_date.toISOString().slice(0, 10)).toBe('2028-07-24');
    const events = (
      await db.query('SELECT event_type FROM contract_events ORDER BY event_type')
    ).rows as Array<{ event_type: string }>;
    expect(events.map((e) => e.event_type)).toEqual(['award', 'expiry']);
  });

  it('framework notice gets renewal window and capped end (48m LCSP)', async () => {
    const db = await makeTestDb();
    const sourceId = await ensureSource(db);
    const fw = JSON.parse(
      readFileSync(join(fixturesDir, 'ted-search-es-framework.json'), 'utf8'),
    ) as TedSearchResponse;
    await persistNotice(db, sourceId, fw.notices[0]);
    const c = (
      await db.query(
        'SELECT framework, end_date, renewal_window_start, renewal_window_end FROM contracts',
      )
    ).rows[0] as {
      framework: boolean;
      end_date: Date;
      renewal_window_start: Date;
      renewal_window_end: Date;
    };
    expect(c.framework).toBe(true);
    expect(c.end_date.toISOString().slice(0, 10)).toBe('2026-12-31'); // explicit
    expect(c.renewal_window_start.toISOString().slice(0, 10)).toBe('2026-10-02');
    expect(c.renewal_window_end.toISOString().slice(0, 10)).toBe('2027-03-31');
  });

  it('parseTedNotice fixture sanity: every notice parses', () => {
    for (const n of fixture.notices) expect(parseTedNotice(n).length).toBeGreaterThan(0);
  });
});

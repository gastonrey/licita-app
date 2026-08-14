// Cross-source identity round-trip through BOTH normalizers (pg-mem): a TED
// single-winner notice and a real PLACSP fixture entry declaring the same NIF
// resolve to ONE company, with the other source's name as alias and
// identifiers for both sources. Awards from both sources point to it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ensureSource, persistNotice } from '../../src/ingest/normalize.js';
import { parseAtomFeed } from '../../src/ingest/placsp-parse.js';
import {
  ensurePlacspSource,
  persistPlacspDoc,
} from '../../src/ingest/normalize-placsp.js';
import type { TedNotice } from '../../src/domain/types.js';
import { countRows, makeTestDb } from './testdb.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

// Synthetic single-winner TED notice: same NIF as the PLACSP fixture winner
// (TRANSVIA B46036398), slightly different name spelling.
const TED_NOTICE: TedNotice = {
  'publication-number': ['999999-2026'],
  'notice-type': ['can-standard'],
  'publication-date': ['2026-08-01+02:00'],
  'buyer-name': { spa: ['Junta de Contratación de Prueba'] },
  'buyer-country': ['ESP'],
  'buyer-identifier': ['99999999999999'],
  'winner-name': { spa: ['TRANSVIA S.L.'] },
  'winner-country': ['ES'],
  'winner-identifier': ['B46036398'],
  'winner-decision-date': ['2026-07-15+02:00'],
  'classification-cpv': ['72200000'],
  'total-value': 50000,
  'total-value-cur': ['EUR'],
} as unknown as TedNotice;

describe('cross-source identity through persistNotice + persistPlacspDoc', () => {
  it('TED then PLACSP with the same NIF → one company, alias, both identifiers', async () => {
    const db = await makeTestDb();
    const tedSource = await ensureSource(db);
    const placspSource = await ensurePlacspSource(db);

    await persistNotice(db, tedSource, TED_NOTICE);
    expect(await countRows(db, 'companies')).toBe(1);

    const licPage = parseAtomFeed(
      readFileSync(join(fixturesDir, 'placsp-atom-licitaciones.xml'), 'utf8'),
      'licitaciones',
    );
    const entry = licPage.entries.find((x) =>
      JSON.stringify(x.statusNode).includes('020120230187'),
    )!;
    await persistPlacspDoc(db, placspSource, entry);

    // The PLACSP winner resolved onto the TED-created company.
    expect(await countRows(db, 'companies')).toBe(1);
    const company = (
      await db.query('SELECT id, name, nif FROM companies')
    ).rows[0] as { id: number; name: string; nif: string };
    expect(company.nif).toBe('B46036398');

    const identifiers = (
      await db.query(
        'SELECT scheme, value FROM company_identifiers WHERE company_id = $1 ORDER BY scheme',
        [company.id],
      )
    ).rows as Array<{ scheme: string; value: string }>;
    expect(identifiers).toEqual([
      { scheme: 'nif', value: 'B46036398' },
      { scheme: 'placsp', value: 'nif:B46036398' },
      { scheme: 'ted', value: 'transvia s.l.|ES' },
    ]);

    const aliases = (
      await db.query('SELECT alias, alias_norm FROM company_aliases WHERE company_id = $1', [
        company.id,
      ])
    ).rows as Array<{ alias: string; alias_norm: string }>;
    expect(aliases).toEqual([{ alias: 'TRANSVIA,S.L.', alias_norm: 'transvia,s.l.' }]);

    // Awards from BOTH sources point at the single company.
    const awardWinners = (
      await db.query('SELECT DISTINCT winner_company_id AS id FROM awards')
    ).rows as Array<{ id: number }>;
    expect(awardWinners).toEqual([{ id: company.id }]);

    // Re-ingest both: fully idempotent.
    await persistNotice(db, tedSource, TED_NOTICE);
    await persistPlacspDoc(db, placspSource, entry);
    expect(await countRows(db, 'companies')).toBe(1);
    expect(await countRows(db, 'company_aliases')).toBe(1);
    expect(await countRows(db, 'company_identifiers')).toBe(3);
    expect(await countRows(db, 'awards')).toBe(2);
  });
});

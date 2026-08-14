// Identity resolver tests (pg-mem): cross-source NIF reuse, per-source
// separation without NIF, late-NIF conflict (no merge, alias + identifier on
// the canonical row, conflict logged), alias idempotence, backfill idempotence.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backfillIdentity,
  normalizeNif,
  resolveBuyer,
  resolveCompany,
} from '../../src/ingest/identity.js';
import type { Db } from '../../src/db/client.js';
import { countRows, makeTestDb } from './testdb.js';

async function seedSources(db: Db): Promise<{ ted: number; placsp: number }> {
  await db.query(
    `INSERT INTO sources(code, name) VALUES ('ted', 'TED'), ('placsp', 'PLACSP')`,
  );
  const rows = (
    await db.query(`SELECT id, code FROM sources`)
  ).rows as Array<{ id: number; code: string }>;
  return {
    ted: rows.find((r) => r.code === 'ted')!.id,
    placsp: rows.find((r) => r.code === 'placsp')!.id,
  };
}

const INDRA_TED = {
  sourceCode: 'ted',
  sourceRef: 'indra sistemas sa|es',
  name: 'INDRA SISTEMAS SA',
  country: 'es',
  raw: null,
};
const INDRA_PLACSP = {
  sourceCode: 'placsp',
  sourceRef: 'nif:A28599033',
  name: 'INDRA SISTEMAS, S.A.',
  country: 'ES',
  raw: null,
};

describe('normalizeNif', () => {
  it('uppercases and strips spaces/dots/dashes', () => {
    expect(normalizeNif(' a28.599.033 ')).toBe('A28599033');
    expect(normalizeNif('b-46036398')).toBe('B46036398');
  });
});

describe('resolveCompany', () => {
  it('cross-source hit by NIF: one company, alias recorded, identifiers for both sources', async () => {
    const db = await makeTestDb();
    const src = await seedSources(db);

    const tedId = await resolveCompany(db, { ...INDRA_TED, sourceId: src.ted, nif: 'A28599033' });
    const placspId = await resolveCompany(db, {
      ...INDRA_PLACSP,
      sourceId: src.placsp,
      nif: 'a28.599.033', // normalized before matching
    });

    expect(placspId).toBe(tedId);
    expect(await countRows(db, 'companies')).toBe(1);

    const aliases = (
      await db.query('SELECT alias, alias_norm FROM company_aliases')
    ).rows as Array<{ alias: string; alias_norm: string }>;
    expect(aliases).toEqual([{ alias: 'INDRA SISTEMAS, S.A.', alias_norm: 'indra sistemas, s.a.' }]);

    const identifiers = (
      await db.query('SELECT scheme, value FROM company_identifiers ORDER BY scheme')
    ).rows as Array<{ scheme: string; value: string }>;
    expect(identifiers).toEqual([
      { scheme: 'nif', value: 'A28599033' },
      { scheme: 'placsp', value: 'nif:A28599033' },
      { scheme: 'ted', value: 'indra sistemas sa|es' },
    ]);

    const company = (await db.query('SELECT nif FROM companies')).rows[0] as { nif: string };
    expect(company.nif).toBe('A28599033');
  });

  it('without NIF, sources stay separate (never merged by name)', async () => {
    const db = await makeTestDb();
    const src = await seedSources(db);
    const tedId = await resolveCompany(db, { ...INDRA_TED, sourceId: src.ted, nif: null });
    const placspId = await resolveCompany(db, {
      sourceId: src.placsp,
      sourceCode: 'placsp',
      sourceRef: 'name:indra sistemas sa|es',
      name: 'INDRA SISTEMAS SA',
      country: 'es',
      nif: null,
      raw: null,
    });
    expect(placspId).not.toBe(tedId);
    expect(await countRows(db, 'companies')).toBe(2);
  });

  it('late-NIF conflict: no merge, identifier+alias on canonical row, conflict logged', async () => {
    const db = await makeTestDb();
    const src = await seedSources(db);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // 1. TED row ingested without NIF.
    const tedId = await resolveCompany(db, { ...INDRA_TED, sourceId: src.ted, nif: null });
    // 2. PLACSP row declares the NIF → becomes the NIF-canonical row.
    const placspId = await resolveCompany(db, { ...INDRA_PLACSP, sourceId: src.placsp, nif: 'A28599033' });
    expect(placspId).not.toBe(tedId);
    // 3. A later single-winner TED notice reveals the same NIF.
    const resolved = await resolveCompany(db, { ...INDRA_TED, sourceId: src.ted, nif: 'A28599033' });

    expect(resolved).toBe(placspId); // new knowledge points at the canonical row
    expect(await countRows(db, 'companies')).toBe(2); // rows NOT merged

    const tedRow = (
      await db.query('SELECT nif FROM companies WHERE id = $1', [tedId])
    ).rows[0] as { nif: string | null };
    expect(tedRow.nif).toBeNull(); // duplicate row keeps its own (null) nif

    const conflicts = warn.mock.calls
      .map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
      .filter((l) => l.msg === 'identity_conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      nif: 'A28599033',
      canonical_company_id: placspId,
      duplicate_company_id: tedId,
    });

    // TED name recorded as alias on the canonical row.
    const aliases = (
      await db.query('SELECT alias_norm FROM company_aliases WHERE company_id = $1', [placspId])
    ).rows as Array<{ alias_norm: string }>;
    expect(aliases.map((a) => a.alias_norm)).toEqual(['indra sistemas sa']);
  });

  it('re-ingest is idempotent: no duplicate aliases or identifiers', async () => {
    const db = await makeTestDb();
    const src = await seedSources(db);
    await resolveCompany(db, { ...INDRA_TED, sourceId: src.ted, nif: 'A28599033' });
    for (let i = 0; i < 2; i++) {
      await resolveCompany(db, { ...INDRA_PLACSP, sourceId: src.placsp, nif: 'A28599033' });
      await resolveCompany(db, { ...INDRA_TED, sourceId: src.ted, nif: 'A28599033' });
    }
    expect(await countRows(db, 'companies')).toBe(1);
    expect(await countRows(db, 'company_aliases')).toBe(1);
    expect(await countRows(db, 'company_identifiers')).toBe(3);
  });

  it('a NIF-known row that loses the NIF on re-ingest keeps it (COALESCE)', async () => {
    const db = await makeTestDb();
    const src = await seedSources(db);
    const id = await resolveCompany(db, { ...INDRA_PLACSP, sourceId: src.placsp, nif: 'B46036398' });
    const again = await resolveCompany(db, { ...INDRA_PLACSP, sourceId: src.placsp, nif: null });
    expect(again).toBe(id);
    const row = (await db.query('SELECT nif FROM companies WHERE id = $1', [id])).rows[0] as {
      nif: string;
    };
    expect(row.nif).toBe('B46036398');
  });
});

describe('resolveBuyer', () => {
  it('reuses a buyer across sources by exact NIF; stays per-source without NIF', async () => {
    const db = await makeTestDb();
    const src = await seedSources(db);
    const base = { name: 'Ayuntamiento de X', country: 'ES', nuts: 'ES61', raw: null };
    const placspId = await resolveBuyer(db, {
      ...base,
      sourceId: src.placsp,
      sourceCode: 'placsp',
      sourceRef: 'nif:P46123000',
      nif: 'p46123000',
    });
    const tedId = await resolveBuyer(db, {
      ...base,
      sourceId: src.ted,
      sourceCode: 'ted',
      sourceRef: 'ayuntamiento de x|ES',
      nif: 'P46123000',
    });
    expect(tedId).toBe(placspId);
    expect(await countRows(db, 'buyers')).toBe(1);

    const noNif = await resolveBuyer(db, {
      ...base,
      sourceId: src.ted,
      sourceCode: 'ted',
      sourceRef: 'ayuntamiento de y|ES',
      name: 'Ayuntamiento de Y',
      nif: null,
    });
    expect(noNif).not.toBe(placspId);
    expect(await countRows(db, 'buyers')).toBe(2);

    const stored = (await db.query('SELECT nif FROM buyers WHERE id = $1', [placspId])).rows[0] as {
      nif: string;
    };
    expect(stored.nif).toBe('P46123000'); // stored normalized
  });
});

describe('backfillIdentity', () => {
  it('registers identifiers, canonicalizes duplicate NIFs, fills buyer nifs; idempotent', async () => {
    const db = await makeTestDb();
    const src = await seedSources(db);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Pre-003 rows: same company twice with differently-formatted NIFs.
    await db.query(
      `INSERT INTO companies(source_id, source_ref, name, name_norm, country, nif)
       VALUES ($1, 'indra sistemas sa|es', 'INDRA SISTEMAS SA', 'indra sistemas sa', 'es', 'a28-599 033')`,
      [src.ted],
    );
    await db.query(
      `INSERT INTO companies(source_id, source_ref, name, name_norm, country, nif)
       VALUES ($1, 'nif:A28599033', 'INDRA SISTEMAS, S.A.', 'indra sistemas, s.a.', 'ES', 'A28599033')`,
      [src.placsp],
    );
    await db.query(
      `INSERT INTO companies(source_id, source_ref, name, name_norm, country, nif)
       VALUES ($1, 'nif:B46036398', 'TRANSVIA,S.L.', 'transvia,s.l.', 'ES', 'B46036398')`,
      [src.placsp],
    );
    await db.query(
      `INSERT INTO buyers(source_id, source_ref, name, name_norm, country)
       VALUES ($1, 'nif:A84818558', 'ACUERDO MARCO', 'acuerdo marco', 'ES')`,
      [src.placsp],
    );

    const counts = await backfillIdentity(db);

    expect(counts.conflicts).toBe(1);
    // canonical = lowest id → the TED row gets the normalized nif
    const canonical = (
      await db.query(`SELECT id, nif FROM companies WHERE source_ref = 'indra sistemas sa|es'`)
    ).rows[0] as { id: number; nif: string };
    expect(canonical.nif).toBe('A28599033');

    const nifIdentifiers = (
      await db.query(`SELECT company_id, value FROM company_identifiers WHERE scheme = 'nif'`)
    ).rows as Array<{ company_id: number; value: string }>;
    expect(nifIdentifiers).toEqual([
      { company_id: canonical.id, value: 'A28599033' },
      { company_id: expect.any(Number), value: 'B46036398' },
    ]);

    const aliases = (
      await db.query('SELECT company_id, alias_norm FROM company_aliases')
    ).rows as Array<{ company_id: number; alias_norm: string }>;
    expect(aliases).toEqual([{ company_id: canonical.id, alias_norm: 'indra sistemas, s.a.' }]);

    expect(warn.mock.calls.some((c) => String(c[0]).includes('identity_conflict'))).toBe(true);

    const buyer = (await db.query('SELECT nif FROM buyers')).rows[0] as { nif: string };
    expect(buyer.nif).toBe('A84818558');

    // Re-run: identical state.
    await backfillIdentity(db);
    expect(await countRows(db, 'company_identifiers')).toBe(5); // 3 source + 2 nif
    expect(await countRows(db, 'company_aliases')).toBe(1);
    expect(await countRows(db, 'companies')).toBe(3); // still not merged
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

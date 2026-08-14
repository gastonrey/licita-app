// Cross-source company/buyer identity resolution (P0.4).
//
// Conservative by design: the ONLY cross-source merge signal is exact NIF
// equality (normalized: uppercase, spaces/dots/dashes stripped). Names are
// never merged across sources — a wrong merge is worse than a duplicate.
//
// Company resolution order (resolveCompany):
//   1. NIF present and already known (company_identifiers scheme='nif', or
//      companies.nif) → reuse that company, whatever source created it. The
//      current source's source_ref identifier is recorded on the hit row and,
//      when the incoming name_norm differs, an alias is added (only names
//      actually seen in a payload — never fabricated).
//      Late-NIF conflict: a DIFFERENT per-source row already exists for
//      (source_id, source_ref) — e.g. TED 'indra sistemas sa|es' ingested
//      without NIF, then a single-winner TED notice reveals the NIF of the
//      PLACSP row 'nif:A28599033'. Rows are NOT merged: the nif identifier
//      and the alias land on the NIF-canonical (hit) row, the per-source row
//      keeps its own identity (and its historical awards), and an
//      'identity_conflict' JSON line is logged with both ids for review.
//   2. NIF present but unknown → per-source upsert with the NIF
//      (companies.nif preserved via COALESCE on re-ingest), then identifier
//      rows for 'nif' and the current source.
//   3. No NIF → the pre-existing per-source behavior: upsert keyed by
//      (source_id, source_ref) per the source's convention (TED
//      '<name_norm>|<country>', PLACSP 'name:<name_norm>|<country>'), plus a
//      source-scheme identifier row.
//
// Buyers stay simpler (resolveBuyer): exact NIF reuse across sources via the
// new buyers.nif column, else the per-source upsert. No alias/identifier
// tables for buyers.

import { createLogger } from '../obs/log.js';
import {
  buildBuyerUpsert,
  buildCompanyUpsert,
  normalizeName,
  type Sql,
} from './normalize.js';

const log = createLogger(process.env.LOG_LEVEL ?? 'info');

export interface IdentityQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Normalized NIF: uppercase, spaces/dots/dashes stripped. */
export function normalizeNif(nif: string): string {
  return nif.trim().toUpperCase().replace(/[\s.\-]/g, '');
}

export interface ResolveCompanyInput {
  sourceId: number;
  /** Source code used as identifier scheme: 'ted' | 'placsp'. */
  sourceCode: string;
  /** Per-source dedupe key (the source's source_ref convention). */
  sourceRef: string;
  name: string;
  country: string | null;
  /** Raw NIF as declared by the source; normalized here. Null when unknown. */
  nif: string | null;
  raw: unknown;
}

export type ResolveBuyerInput = ResolveCompanyInput & { nuts: string | null };

async function run(
  q: IdentityQueryable,
  s: Sql,
): Promise<Array<Record<string, unknown>>> {
  return (await q.query(s.text, s.values)).rows;
}

async function ensureIdentifier(
  q: IdentityQueryable,
  companyId: number,
  scheme: string,
  value: string,
): Promise<void> {
  await q.query(
    `INSERT INTO company_identifiers(company_id, scheme, value) VALUES ($1, $2, $3)
     ON CONFLICT (scheme, value) DO NOTHING`,
    [companyId, scheme, value],
  );
}

async function ensureAlias(
  q: IdentityQueryable,
  companyId: number,
  alias: string,
  aliasNorm: string,
  sourceId: number,
): Promise<void> {
  await q.query(
    `INSERT INTO company_aliases(company_id, alias, alias_norm, source_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, alias_norm) DO NOTHING`,
    [companyId, alias, aliasNorm, sourceId],
  );
}

/** Company row carrying this (normalized) NIF, if any — identifiers first. */
async function findCompanyByNif(
  q: IdentityQueryable,
  nif: string,
): Promise<Record<string, unknown> | null> {
  const viaIdentifier = await q.query(
    `SELECT c.* FROM company_identifiers ci
     JOIN companies c ON c.id = ci.company_id
     WHERE ci.scheme = 'nif' AND ci.value = $1
     ORDER BY c.id LIMIT 1`,
    [nif],
  );
  if (viaIdentifier.rows[0]) return viaIdentifier.rows[0];
  const direct = await q.query('SELECT * FROM companies WHERE nif = $1 ORDER BY id LIMIT 1', [nif]);
  return direct.rows[0] ?? null;
}

export async function resolveCompany(
  q: IdentityQueryable,
  input: ResolveCompanyInput,
): Promise<number> {
  const nameNorm = normalizeName(input.name);
  const nif = input.nif ? normalizeNif(input.nif) : null;

  if (nif) {
    const hit = await findCompanyByNif(q, nif);
    if (hit) {
      const companyId = hit.id as number;
      // Late-NIF conflict: another per-source row already holds this source_ref.
      const dup = await q.query(
        'SELECT id FROM companies WHERE source_id = $1 AND source_ref = $2',
        [input.sourceId, input.sourceRef],
      );
      const dupId = dup.rows[0] ? (dup.rows[0].id as number) : null;
      if (dupId !== null && dupId !== companyId) {
        log.warn('identity_conflict', {
          nif,
          canonical_company_id: companyId,
          duplicate_company_id: dupId,
          source: input.sourceCode,
          source_ref: input.sourceRef,
        });
        // The source_ref identifier truthfully belongs to the per-source row.
        await ensureIdentifier(q, dupId, input.sourceCode, input.sourceRef);
      } else {
        await ensureIdentifier(q, companyId, input.sourceCode, input.sourceRef);
      }
      if ((hit.nif as string | null) !== nif) {
        await q.query('UPDATE companies SET nif = $1 WHERE id = $2', [nif, companyId]);
      }
      await ensureIdentifier(q, companyId, 'nif', nif);
      if (nameNorm !== (hit.name_norm as string)) {
        await ensureAlias(q, companyId, input.name, nameNorm, input.sourceId);
      }
      return companyId;
    }

    // NIF unknown so far: per-source upsert WITH the nif, then identifiers.
    const rows = await run(
      q,
      buildCompanyUpsert({
        sourceId: input.sourceId,
        sourceRef: input.sourceRef,
        name: input.name,
        nameNorm,
        country: input.country,
        nif,
        raw: input.raw,
      }),
    );
    const id = rows[0].id as number;
    await ensureIdentifier(q, id, 'nif', nif);
    await ensureIdentifier(q, id, input.sourceCode, input.sourceRef);
    return id;
  }

  // No NIF: existing per-source behavior.
  const rows = await run(
    q,
    buildCompanyUpsert({
      sourceId: input.sourceId,
      sourceRef: input.sourceRef,
      name: input.name,
      nameNorm,
      country: input.country,
      nif: null,
      raw: input.raw,
    }),
  );
  const id = rows[0].id as number;
  await ensureIdentifier(q, id, input.sourceCode, input.sourceRef);
  return id;
}

export async function resolveBuyer(
  q: IdentityQueryable,
  input: ResolveBuyerInput,
): Promise<number> {
  const nameNorm = normalizeName(input.name);
  const nif = input.nif ? normalizeNif(input.nif) : null;

  if (nif) {
    const hit = await q.query('SELECT id FROM buyers WHERE nif = $1 ORDER BY id LIMIT 1', [nif]);
    if (hit.rows[0]) return hit.rows[0].id as number; // cross-source reuse, row untouched
  }
  const rows = await run(
    q,
    buildBuyerUpsert({
      sourceId: input.sourceId,
      sourceRef: input.sourceRef,
      name: input.name,
      nameNorm,
      country: input.country,
      nuts: input.nuts,
      nif,
      raw: input.raw,
    }),
  );
  return rows[0].id as number;
}

// ---------------------------------------------------------------------------
// Backfill (existing databases): registers identifiers for rows ingested
// before 003_identity.sql. Idempotent; conflicts are logged, never merged.
// ---------------------------------------------------------------------------

export interface BackfillCounts {
  sourceIdentifiers: number;
  nifIdentifiers: number;
  aliases: number;
  conflicts: number;
  buyerNifs: number;
}

export async function backfillIdentity(db: IdentityQueryable): Promise<BackfillCounts> {
  const counts: BackfillCounts = {
    sourceIdentifiers: 0,
    nifIdentifiers: 0,
    aliases: 0,
    conflicts: 0,
    buyerNifs: 0,
  };

  const companies = (
    await db.query(
      `SELECT c.id, c.source_id, c.source_ref, c.name, c.name_norm, c.nif,
              s.code AS source_code
       FROM companies c JOIN sources s ON s.id = c.source_id
       ORDER BY c.id`,
    )
  ).rows as Array<{
    id: number;
    source_id: number;
    source_ref: string;
    name: string;
    name_norm: string;
    nif: string | null;
    source_code: string;
  }>;

  // Source-scheme identifier for every company row (truthful per-row link).
  for (const c of companies) {
    await ensureIdentifier(db, c.id, c.source_code, c.source_ref);
    counts.sourceIdentifiers += 1;
  }

  // NIF identifiers: canonical = lowest id per normalized NIF. Duplicates are
  // NOT merged: the dupe's name becomes an alias on the canonical row and the
  // conflict is logged.
  const byNif = new Map<string, typeof companies>();
  for (const c of companies) {
    if (!c.nif) continue;
    const nif = normalizeNif(c.nif);
    const group = byNif.get(nif) ?? [];
    group.push(c);
    byNif.set(nif, group);
  }
  for (const [nif, group] of byNif) {
    const canonical = group[0];
    if (canonical.nif !== nif) {
      await db.query('UPDATE companies SET nif = $1 WHERE id = $2', [nif, canonical.id]);
    }
    await ensureIdentifier(db, canonical.id, 'nif', nif);
    counts.nifIdentifiers += 1;
    for (const dupe of group.slice(1)) {
      counts.conflicts += 1;
      log.warn('identity_conflict', {
        nif,
        canonical_company_id: canonical.id,
        duplicate_company_id: dupe.id,
        source: dupe.source_code,
        source_ref: dupe.source_ref,
        backfill: true,
      });
      if (dupe.name_norm !== canonical.name_norm) {
        await ensureAlias(db, canonical.id, dupe.name, dupe.name_norm, dupe.source_id);
        counts.aliases += 1;
      }
    }
  }

  // Buyers: PLACSP rows keyed 'nif:<NIF>' get their nif column filled.
  const placspBuyers = (
    await db.query(
      `SELECT id, source_ref FROM buyers
       WHERE nif IS NULL AND source_ref LIKE 'nif:%'`,
    )
  ).rows as Array<{ id: number; source_ref: string }>;
  for (const b of placspBuyers) {
    await db.query('UPDATE buyers SET nif = $1 WHERE id = $2 AND nif IS NULL', [
      normalizeNif(b.source_ref.slice('nif:'.length)),
      b.id,
    ]);
    counts.buyerNifs += 1;
  }

  return counts;
}

// PLACSP persistence — mirrors normalize.ts persistNotice() (per-doc
// transaction, idempotent upserts keyed (source_id, source_ref), raw jsonb
// provenance), fed by the CODICE parser in placsp-parse.ts.
//
// Dedupe decisions (verified against the live feeds, 2026-08-14):
// - tenders.source_ref = "placsp:<ContractFolderID>": the expediente is the
//   stable identity across status transitions (PUB→EV→ADJ→RES); re-ingesting
//   an update folds it into the same tender row.
// - buyers/companies.source_ref = "nif:<NIF>" when the source declares a NIF
//   (schemeName="NIF" only), else "name:<name_norm>|<country>" (TED's rule).
// - awards: one row per awarded TenderResult; multi-lot results get
//   source_ref suffix "#<lotId>" (or "#<index>" when the lot id is absent),
//   consistent with the TED "#N" convention and the uq_awards_dedup index.
// - Framework 48m cap (LCSP) only applies via deriveContractDates when the
//   doc actually declares an acuerdo marco (ContractingSystemCode 1/3).

import type { Db } from '../db/client.js';
import { resolveBuyer, resolveCompany } from './identity.js';
import {
  buildAwardInsert,
  buildAwardSelect,
  buildAwardUpdate,
  buildContractEventInsert,
  buildContractEventsDelete,
  buildContractUpsert,
  buildCpvInsert,
  buildTenderUpsert,
  deriveContractDates,
  type PersistCounts,
  type Sql,
} from './normalize.js';
import {
  parsePlacspEntry,
  type PlacspFeedEntry,
  type PlacspNormalizedDoc,
} from './placsp-parse.js';

export const PLACSP_SOURCE = {
  code: 'placsp',
  name: 'Plataforma de Contratación del Sector Público (PLACSP)',
  baseUrl: 'https://contrataciondelsectorpublico.gob.es',
  licenseNote:
    'Datos abiertos: reuse authorized for commercial and non-commercial purposes ' +
    'under the Ministerio de Hacienda general reuse conditions ' +
    '(https://www.datos.gob.es/avisolegal; Ley 37/2007, RD 1495/2011), ' +
    'citing PLACSP as the source.',
} as const;

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Registers sources.code='placsp' (idempotent) and returns its id. */
export async function ensurePlacspSource(db: Db): Promise<number> {
  const found = await db.query('SELECT id FROM sources WHERE code = $1', [PLACSP_SOURCE.code]);
  if (found.rows[0]) return found.rows[0].id as number;
  const res = await db.query(
    `INSERT INTO sources(code, name, base_url, license_note) VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET
       name = EXCLUDED.name, base_url = EXCLUDED.base_url,
       license_note = EXCLUDED.license_note
     RETURNING id`,
    [PLACSP_SOURCE.code, PLACSP_SOURCE.name, PLACSP_SOURCE.baseUrl, PLACSP_SOURCE.licenseNote],
  );
  return res.rows[0].id as number;
}

/**
 * Persist one feed entry (parse + upsert) in a single transaction.
 * Returns zero counts when the entry lacks minimum identity
 * (ContractFolderID / buyer name) — the caller counts it as skipped.
 * Kill-safe: completed docs stay committed; a crash mid-doc rolls back only
 * that doc and re-ingest is idempotent.
 */
export async function persistPlacspDoc(
  db: Db,
  sourceId: number,
  entry: PlacspFeedEntry,
): Promise<PersistCounts> {
  const doc = parsePlacspEntry(entry);
  const counts: PersistCounts = { buyers: 0, companies: 0, tenders: 0, awards: 0, contracts: 0 };
  if (!doc) return counts;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const q = client as unknown as Queryable;
    const run = async (s: Sql): Promise<Record<string, unknown>[]> =>
      (await q.query(s.text, s.values)).rows;

    for (const code of doc.cpvs) await run(buildCpvInsert(code));
    const cpvMain = doc.cpvs.find((c) => c.startsWith('72') || c.startsWith('48')) ?? doc.cpvs[0] ?? null;

    const buyerId = await resolveBuyer(q, {
      sourceId,
      sourceCode: 'placsp',
      sourceRef: doc.buyer.sourceRef,
      name: doc.buyer.name,
      country: doc.buyer.country,
      nuts: doc.buyer.nuts,
      nif: doc.buyer.nif,
      raw: {
        party: { name: doc.buyer.name, country: doc.buyer.country, nif: doc.buyer.nif },
        source: 'placsp',
        source_ref: doc.sourceRef,
      },
    });
    counts.buyers += 1;

    const tenderRows = await run(
      buildTenderUpsert({
        sourceId,
        sourceRef: doc.sourceRef,
        noticeType: doc.statusCode,
        publicationDate: doc.publicationDate,
        buyerId,
        title: doc.title,
        description: doc.description,
        cpvMain,
        cpvAll: doc.cpvs,
        nuts: doc.nuts,
        url: doc.url,
        raw: doc.raw,
        procedureType: doc.procedureType,
        deadline: doc.deadline,
        estimatedValue: doc.estimatedValue,
        currency: doc.budgetCurrency,
      }),
    );
    const tenderId = tenderRows[0].id as number;
    counts.tenders += 1;

    for (const award of doc.awards) {
      let winnerCompanyId: number | null = null;
      if (award.winner) {
        winnerCompanyId = await resolveCompany(q, {
          sourceId,
          sourceCode: 'placsp',
          sourceRef: award.winner.sourceRef,
          name: award.winner.name,
          country: award.winner.country,
          nif: award.winner.nif,
          raw: {
            party: {
              name: award.winner.name,
              country: award.winner.country,
              nif: award.winner.nif,
            },
            source: 'placsp',
            source_ref: award.sourceRef,
          },
        });
        counts.companies += 1;
      }

      const derived = deriveContractDates({
        framework: doc.framework,
        durationMonths: doc.durationMonths,
        startDate: doc.startDate,
        endDate: doc.endDate,
        awardDate: award.awardDate,
      });
      const awardPayload = {
        sourceRef: award.sourceRef,
        awardDate: award.awardDate,
        winnerCompanyId,
        lot: award.lot,
        value: award.value,
        currency: award.currency,
        biddersCount: award.biddersCount,
        framework: doc.framework,
        durationMonths: doc.durationMonths,
        startDate: derived.startDate,
        endDate: doc.endDate, // awards.end_date = explicit only; derivation lives on contracts
        raw: doc.raw,
      };
      const existing = await run(buildAwardSelect(tenderId, award.lot, award.sourceRef));
      let awardId: number;
      if (existing[0]) {
        awardId = existing[0].id as number;
        await run(buildAwardUpdate(awardId, awardPayload));
      } else {
        const ins = await run(buildAwardInsert({ tenderId, ...awardPayload }));
        awardId = ins[0].id as number;
      }
      counts.awards += 1;

      const status =
        derived.endDate && derived.endDate < new Date().toISOString().slice(0, 10)
          ? 'expired'
          : 'active';
      const contractRows = await run(
        buildContractUpsert({
          awardId,
          buyerId,
          companyId: winnerCompanyId,
          cpv: cpvMain,
          title: doc.title,
          value: award.value,
          currency: award.currency,
          startDate: derived.startDate,
          endDate: derived.endDate,
          durationMonths: doc.durationMonths,
          framework: doc.framework,
          renewalWindowStart: derived.renewalWindowStart,
          renewalWindowEnd: derived.renewalWindowEnd,
          status,
        }),
      );
      const contractId = contractRows[0].id as number;
      counts.contracts += 1;

      await run(buildContractEventsDelete(contractId));
      const provenance = { source: 'placsp', source_ref: award.sourceRef, url: doc.url };
      const awardEventDate = award.awardDate ?? derived.startDate;
      if (awardEventDate) {
        await run(
          buildContractEventInsert({
            contractId,
            eventType: 'award',
            eventDate: awardEventDate,
            details: provenance,
            sourceRef: award.sourceRef,
          }),
        );
      }
      if (derived.endDate) {
        await run(
          buildContractEventInsert({
            contractId,
            eventType: 'expiry',
            eventDate: derived.endDate,
            details: { ...provenance, derived: doc.endDate === null },
            sourceRef: award.sourceRef,
          }),
        );
      }
    }

    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export type { PlacspNormalizedDoc };

// TED notice → normalized rows + idempotent upserts (SPEC §8).
//
// Parsing rules (all verified against the live API, see fixtures):
// - buyer-name / winner-name / title-lot / description-lot are language maps
//   { spa: [...], eng?: [...] }; we prefer 'spa', then 'eng', then first key.
// - Dates arrive as "YYYY-MM-DD+02:00" (or "...Z"); we keep the date part only.
// - total-value is a scalar number; currency is total-value-cur[0].
// - duration-period-value-lot + duration-period-unit-lot (DAY|WEEK|MONTH|YEAR)
//   convert to months.
// - framework-agreement-lot values: "none" | "fa-wo-rc" | "fa-w-rc" | ...
//   anything other than "none" means framework agreement.
// - A notice may name several winners (one per lot). Lot↔winner mapping is not
//   recoverable from Search-API fields, so we emit ONE award row per distinct
//   winner; notice-level value/bidders are only attributable when the notice
//   has a single winner, otherwise they stay null (never fabricated).
//
// Dedupe: buyers/companies are keyed by source_ref = "<name_norm>|<country>"
// where name_norm = lower(unaccent(trim(name))) computed in JS (NFD strip),
// equivalent to the SQL expression in SPEC §4 and portable to pg-mem.

import type { Db } from '../db/client.js';
import type { NormalizedAward, TedNotice } from '../domain/types.js';

/** Row produced by parseTedNotice: the shared NormalizedAward contract plus
 *  the extra columns we persist (kept here, not in domain/types.ts). */
export interface NormalizedAwardRow extends NormalizedAward {
  startDate: string | null;
  endDate: string | null; // explicit end from the notice (not derived)
  winnerNif: string | null;
}

export interface Sql {
  text: string;
  values: unknown[];
}

// ---------------------------------------------------------------------------
// Pure parsing helpers
// ---------------------------------------------------------------------------

/** name_norm per SPEC §4: lower(unaccent(trim(name))). */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks
    .trim()
    .toLowerCase();
}

export function asArray(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** First string from a TED language map ({ spa: [...] }) or array field. */
export function firstLangValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = firstLangValue(item);
      if (s) return s;
    }
    return null;
  }
  if (typeof v === 'object') {
    const map = v as Record<string, unknown>;
    for (const lang of ['spa', 'eng']) {
      const got = firstLangValue(map[lang]);
      if (got) return got;
    }
    for (const key of Object.keys(map)) {
      const got = firstLangValue(map[key]);
      if (got) return got;
    }
  }
  return null;
}

/** All distinct strings of a language map / array field (e.g. several winners). */
export function allLangValues(v: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown): void => {
    if (x === null || x === undefined) return;
    if (typeof x === 'string') {
      out.push(x);
      return;
    }
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    if (typeof x === 'object') Object.values(x as Record<string, unknown>).forEach(walk);
  };
  walk(v);
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

/** "2026-07-01+02:00" | "2026-07-01Z" | "20260701" → "2026-07-01". */
export function isoDate(v: unknown): string | null {
  const s = typeof v === 'string' ? v : null;
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const c = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (c) return `${c[1]}-${c[2]}-${c[3]}`;
  return null;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const UNIT_TO_MONTHS: Record<string, number> = {
  DAY: 1 / 30.4375,
  WEEK: 7 / 30.4375,
  MONTH: 1,
  YEAR: 12,
};

export function monthsFromDuration(value: unknown, unit: unknown): number | null {
  const n = num(value);
  if (n === null) return null;
  const u = typeof unit === 'string' ? unit.toUpperCase() : 'MONTH';
  const factor = UNIT_TO_MONTHS[u];
  if (!factor) return null;
  return Math.round(n * factor * 100) / 100;
}

export function isFrameworkFlag(v: unknown): boolean {
  return asArray(v).some((x) => {
    if (x === true) return true;
    if (typeof x !== 'string') return false;
    const s = x.trim().toLowerCase();
    return s !== '' && s !== 'none' && s !== 'false';
  });
}

/** Spanish NIF/CIF-looking identifier (winner-identifier may hold several ids). */
export function pickNif(identifiers: unknown): string | null {
  for (const raw of asArray(identifiers)) {
    if (typeof raw !== 'string') continue;
    const s = raw.trim().toUpperCase();
    if (/^[A-Z]\d{7}[A-Z0-9]$/.test(s) || /^\d{8}[A-Z]$/.test(s)) return s;
  }
  return null;
}

/** Add `months` to an ISO date, clamping to month end (2026-01-31 +1 → 2026-02-28). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** First NUTS code more granular than the country (ES300 over ESP). */
export function pickNuts(placeOfPerformance: unknown): string | null {
  const codes = asArray(placeOfPerformance).filter((x): x is string => typeof x === 'string');
  return codes.find((c) => c.length > 3) ?? codes[0] ?? null;
}

export const TED_NOTICE_URL = (pubno: string): string =>
  `https://ted.europa.eu/en/notice/-/detail/${pubno}`;

// ---------------------------------------------------------------------------
// TedNotice → NormalizedAwardRow[]
// ---------------------------------------------------------------------------

export function parseTedNotice(notice: TedNotice): NormalizedAwardRow[] {
  const sourceRef = asArray(notice['publication-number'])[0];
  if (typeof sourceRef !== 'string' || !sourceRef) return [];

  const buyerName = firstLangValue(notice['buyer-name']);
  if (!buyerName) return []; // no buyer identity → cannot dedupe; skip notice
  const buyerCountry = asArray(notice['buyer-country'])[0];
  const buyer: NormalizedAwardRow['buyer'] = {
    sourceRef: `${normalizeName(buyerName)}|${typeof buyerCountry === 'string' ? buyerCountry : ''}`,
    name: buyerName,
    country: typeof buyerCountry === 'string' ? buyerCountry : null,
    nuts: pickNuts(notice['place-of-performance']),
  };

  const cpvs = [
    ...new Set(
      asArray(notice['classification-cpv'])
        .filter((x): x is string => typeof x === 'string' && /^\d{8}/.test(x))
        .map((x) => x.slice(0, 8)),
    ),
  ];

  const winnerNames = allLangValues(notice['winner-name']);
  const winnerCountry = asArray(notice['winner-country'])[0];
  const winnerNif = pickNif(notice['winner-identifier']);
  const winners = winnerNames.map((name) => ({
    sourceRef: `${normalizeName(name)}|${typeof winnerCountry === 'string' ? winnerCountry : ''}`,
    name,
    country: typeof winnerCountry === 'string' ? winnerCountry : null,
  }));

  const publicationDate = isoDate(asArray(notice['publication-date'])[0] ?? notice['publication-date']);
  const awardDate =
    isoDate(asArray(notice['winner-decision-date'])[0]) ??
    isoDate(asArray(notice['contract-conclusion-date'])[0]);

  const biddersValues = asArray(notice['received-submissions-type-val'])
    .map(num)
    .filter((n): n is number => n !== null);
  // With several lots the awarded lot's count is not identifiable; max() is the
  // most contested lot's tender count and is an upper bound. Only attributable
  // to the award when the notice names a single winner (see below).
  const biddersCount = biddersValues.length ? Math.max(...biddersValues) : null;

  const value = num(notice['total-value']);
  const currency = ((): string | null => {
    const c = asArray(notice['total-value-cur'])[0];
    return typeof c === 'string' ? c : null;
  })();

  const base = {
    sourceRef,
    noticeType: ((): string | null => {
      const t = asArray(notice['notice-type'])[0];
      return typeof t === 'string' ? t : null;
    })(),
    publicationDate,
    buyer,
    title: firstLangValue(notice['title-proc']) ?? firstLangValue(notice['title-lot']),
    description: firstLangValue(notice['description-lot']),
    cpvs,
    awardDate,
    framework: isFrameworkFlag(notice['framework-agreement-lot']),
    durationMonths: monthsFromDuration(
      asArray(notice['duration-period-value-lot'])[0],
      asArray(notice['duration-period-unit-lot'])[0],
    ),
    startDate: isoDate(asArray(notice['contract-duration-start-date-lot'])[0]),
    endDate: isoDate(asArray(notice['contract-duration-end-date-lot'])[0]),
    url: TED_NOTICE_URL(sourceRef),
    raw: notice as unknown,
  };

  const rows: NormalizedAwardRow[] =
    winners.length === 0
      ? [{ ...base, winner: null, winnerNif: null, value, currency, biddersCount }]
      : winners.map((winner, i) => ({
          ...base,
          winner,
          winnerNif: winners.length === 1 ? winnerNif : null,
          // Notice-level totals are only attributable with a single winner.
          value: winners.length === 1 ? value : null,
          currency: winners.length === 1 ? currency : null,
          biddersCount: winners.length === 1 ? biddersCount : null,
          sourceRef: winners.length === 1 ? sourceRef : `${sourceRef}#${i}`,
        }));
  return rows;
}

// ---------------------------------------------------------------------------
// Contract derivation (SPEC §8: duration → end_date; framework LCSP 48m cap)
// ---------------------------------------------------------------------------

export const FRAMEWORK_MAX_MONTHS = 48; // LCSP art. 29: frameworks capped at 4 years
export const RENEWAL_WINDOW_DAYS = 90;

export interface DerivedContractDates {
  startDate: string | null;
  endDate: string | null;
  renewalWindowStart: string | null;
  renewalWindowEnd: string | null;
}

export function deriveContractDates(row: {
  framework: boolean;
  durationMonths: number | null;
  startDate: string | null;
  endDate: string | null; // explicit
  awardDate: string | null;
}): DerivedContractDates {
  const startDate = row.startDate ?? row.awardDate;
  if (row.endDate) {
    return {
      startDate,
      endDate: row.endDate,
      renewalWindowStart: row.framework ? addDaysIso(row.endDate, -RENEWAL_WINDOW_DAYS) : null,
      renewalWindowEnd: row.framework ? addDaysIso(row.endDate, RENEWAL_WINDOW_DAYS) : null,
    };
  }
  if (!startDate) {
    return { startDate: null, endDate: null, renewalWindowStart: null, renewalWindowEnd: null };
  }
  let months = row.durationMonths;
  if (row.framework) {
    // LCSP 4-year cap applies when there is no explicit end date.
    months = months === null ? FRAMEWORK_MAX_MONTHS : Math.min(months, FRAMEWORK_MAX_MONTHS);
  }
  const endDate = months === null ? null : addMonthsIso(startDate, months);
  return {
    startDate,
    endDate,
    renewalWindowStart: row.framework && endDate ? addDaysIso(endDate, -RENEWAL_WINDOW_DAYS) : null,
    renewalWindowEnd: row.framework && endDate ? addDaysIso(endDate, RENEWAL_WINDOW_DAYS) : null,
  };
}

// ---------------------------------------------------------------------------
// SQL builders (pure → unit-testable without a database)
// ---------------------------------------------------------------------------

export function buildSourceSelect(code: string): Sql {
  return { text: 'SELECT id FROM sources WHERE code = $1', values: [code] };
}

export function buildSourceInsert(code: string, name: string, baseUrl: string): Sql {
  return {
    text: `INSERT INTO sources(code, name, base_url) VALUES ($1, $2, $3)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    values: [code, name, baseUrl],
  };
}

export function buildCpvInsert(code: string): Sql {
  // Labels stay null (SPEC: insert cpv rows with code only, labels nullable).
  return { text: 'INSERT INTO cpvs(code) VALUES ($1) ON CONFLICT (code) DO NOTHING', values: [code] };
}

export function buildBuyerUpsert(b: {
  sourceId: number;
  sourceRef: string;
  name: string;
  nameNorm: string;
  country: string | null;
  nuts: string | null;
  raw: unknown;
}): Sql {
  return {
    text: `INSERT INTO buyers(source_id, source_ref, name, name_norm, country, nuts, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (source_id, source_ref) DO UPDATE SET
             name = EXCLUDED.name, name_norm = EXCLUDED.name_norm,
             country = EXCLUDED.country, nuts = EXCLUDED.nuts, raw = EXCLUDED.raw
           RETURNING id`,
    values: [b.sourceId, b.sourceRef, b.name, b.nameNorm, b.country, b.nuts, JSON.stringify(b.raw ?? null)],
  };
}

export function buildCompanyUpsert(c: {
  sourceId: number;
  sourceRef: string;
  name: string;
  nameNorm: string;
  country: string | null;
  nif: string | null;
  raw: unknown;
}): Sql {
  return {
    text: `INSERT INTO companies(source_id, source_ref, name, name_norm, country, nif, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (source_id, source_ref) DO UPDATE SET
             name = EXCLUDED.name, name_norm = EXCLUDED.name_norm,
             country = EXCLUDED.country,
             nif = COALESCE(EXCLUDED.nif, companies.nif), raw = EXCLUDED.raw
           RETURNING id`,
    values: [c.sourceId, c.sourceRef, c.name, c.nameNorm, c.country, c.nif, JSON.stringify(c.raw ?? null)],
  };
}

export function buildTenderUpsert(t: {
  sourceId: number;
  sourceRef: string;
  noticeType: string | null;
  publicationDate: string | null;
  buyerId: number;
  title: string | null;
  description: string | null;
  cpvMain: string | null;
  cpvAll: string[];
  nuts: string | null;
  url: string | null;
  raw: unknown;
}): Sql {
  return {
    text: `INSERT INTO tenders(source_id, source_ref, notice_type, publication_date, buyer_id,
               title, description, cpv_main, cpv_all, nuts, url, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (source_id, source_ref) DO UPDATE SET
             notice_type = EXCLUDED.notice_type, publication_date = EXCLUDED.publication_date,
             buyer_id = EXCLUDED.buyer_id, title = EXCLUDED.title, description = EXCLUDED.description,
             cpv_main = EXCLUDED.cpv_main, cpv_all = EXCLUDED.cpv_all, nuts = EXCLUDED.nuts,
             url = EXCLUDED.url, raw = EXCLUDED.raw
           RETURNING id`,
    values: [
      t.sourceId,
      t.sourceRef,
      t.noticeType,
      t.publicationDate,
      t.buyerId,
      t.title,
      t.description,
      t.cpvMain,
      t.cpvAll,
      t.nuts,
      t.url,
      JSON.stringify(t.raw ?? null),
    ],
  };
}

// Awards: the dedupe key is UNIQUE INDEX uq_awards_dedup ON
// awards(tender_id, COALESCE(lot,''), source_ref). A plain ON CONFLICT cannot
// target the expression portably (and pg-mem lacks expression arbiters), so
// the award upsert is SELECT-first + UPDATE/INSERT. Single-threaded ingest
// makes this race-free.
export function buildAwardSelect(tenderId: number, lot: string | null, sourceRef: string): Sql {
  return {
    text: `SELECT id FROM awards
           WHERE tender_id = $1 AND COALESCE(lot, '') = COALESCE($2, '') AND source_ref = $3`,
    values: [tenderId, lot, sourceRef],
  };
}

export function buildAwardInsert(a: {
  tenderId: number;
  sourceRef: string;
  awardDate: string | null;
  winnerCompanyId: number | null;
  lot: string | null;
  value: number | null;
  currency: string | null;
  biddersCount: number | null;
  framework: boolean;
  durationMonths: number | null;
  startDate: string | null;
  endDate: string | null;
  raw: unknown;
}): Sql {
  return {
    text: `INSERT INTO awards(tender_id, source_ref, award_date, winner_company_id, lot, value,
               currency, bidders_count, framework, duration_months, start_date, end_date, raw)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id`,
    values: [
      a.tenderId,
      a.sourceRef,
      a.awardDate,
      a.winnerCompanyId,
      a.lot,
      a.value,
      a.currency,
      a.biddersCount,
      a.framework,
      a.durationMonths,
      a.startDate,
      a.endDate,
      JSON.stringify(a.raw ?? null),
    ],
  };
}

export function buildAwardUpdate(
  id: number,
  a: Omit<Parameters<typeof buildAwardInsert>[0], 'tenderId' | 'sourceRef' | 'lot'>,
): Sql {
  return {
    text: `UPDATE awards SET award_date = $2, winner_company_id = $3, value = $4, currency = $5,
             bidders_count = $6, framework = $7, duration_months = $8,
             start_date = $9, end_date = $10, raw = $11
           WHERE id = $1 RETURNING id`,
    values: [
      id,
      a.awardDate,
      a.winnerCompanyId,
      a.value,
      a.currency,
      a.biddersCount,
      a.framework,
      a.durationMonths,
      a.startDate,
      a.endDate,
      JSON.stringify(a.raw ?? null),
    ],
  };
}

export function buildContractUpsert(c: {
  awardId: number;
  buyerId: number | null;
  companyId: number | null;
  cpv: string | null;
  title: string | null;
  value: number | null;
  currency: string | null;
  startDate: string | null;
  endDate: string | null;
  durationMonths: number | null;
  framework: boolean;
  renewalWindowStart: string | null;
  renewalWindowEnd: string | null;
  status: string;
}): Sql {
  return {
    text: `INSERT INTO contracts(award_id, buyer_id, company_id, cpv, title, value, currency,
               start_date, end_date, duration_months, framework,
               renewal_window_start, renewal_window_end, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           ON CONFLICT (award_id) DO UPDATE SET
             buyer_id = EXCLUDED.buyer_id, company_id = EXCLUDED.company_id, cpv = EXCLUDED.cpv,
             title = EXCLUDED.title, value = EXCLUDED.value, currency = EXCLUDED.currency,
             start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
             duration_months = EXCLUDED.duration_months, framework = EXCLUDED.framework,
             renewal_window_start = EXCLUDED.renewal_window_start,
             renewal_window_end = EXCLUDED.renewal_window_end, status = EXCLUDED.status
           RETURNING id`,
    values: [
      c.awardId,
      c.buyerId,
      c.companyId,
      c.cpv,
      c.title,
      c.value,
      c.currency,
      c.startDate,
      c.endDate,
      c.durationMonths,
      c.framework,
      c.renewalWindowStart,
      c.renewalWindowEnd,
      c.status,
    ],
  };
}

export function buildContractEventsDelete(contractId: number): Sql {
  // Events are deterministic from the award; delete+reinsert keeps re-ingest idempotent.
  return { text: 'DELETE FROM contract_events WHERE contract_id = $1', values: [contractId] };
}

export function buildContractEventInsert(e: {
  contractId: number;
  eventType: 'award' | 'expiry';
  eventDate: string;
  details: unknown;
  sourceRef: string;
}): Sql {
  return {
    text: `INSERT INTO contract_events(contract_id, event_type, event_date, details, source_ref)
           VALUES ($1, $2, $3, $4, $5)`,
    values: [e.contractId, e.eventType, e.eventDate, JSON.stringify(e.details ?? null), e.sourceRef],
  };
}

// ---------------------------------------------------------------------------
// Persistence (per notice, one transaction; every row carries provenance via
// source_id/source_ref and the original payload in raw jsonb)
// ---------------------------------------------------------------------------

export interface PersistCounts {
  buyers: number;
  companies: number;
  tenders: number;
  awards: number;
  contracts: number;
}

export async function ensureSource(db: Db, code = 'ted'): Promise<number> {
  const found = await db.query(buildSourceSelect(code).text, buildSourceSelect(code).values);
  if (found.rows[0]) return found.rows[0].id as number;
  const ins = buildSourceInsert(
    code,
    'Tenders Electronic Daily (EU)',
    'https://ted.europa.eu',
  );
  const res = await db.query(ins.text, ins.values);
  return res.rows[0].id as number;
}

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export async function persistNotice(
  db: Db,
  sourceId: number,
  notice: TedNotice,
): Promise<PersistCounts> {
  const rows = parseTedNotice(notice);
  const counts: PersistCounts = { buyers: 0, companies: 0, tenders: 0, awards: 0, contracts: 0 };
  if (rows.length === 0) return counts;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const q = client as unknown as Queryable;
    const run = async (s: Sql): Promise<Record<string, unknown>[]> =>
      (await q.query(s.text, s.values)).rows;

    const first = rows[0];

    for (const code of first.cpvs) await run(buildCpvInsert(code));
    const cpvMain = first.cpvs.find((c) => c.startsWith('72') || c.startsWith('48')) ?? first.cpvs[0] ?? null;

    const buyerRows = await run(
      buildBuyerUpsert({
        sourceId,
        sourceRef: first.buyer.sourceRef,
        name: first.buyer.name,
        nameNorm: normalizeName(first.buyer.name),
        country: first.buyer.country,
        nuts: first.buyer.nuts,
        raw: {
          'buyer-name': notice['buyer-name'],
          'buyer-identifier': notice['buyer-identifier'],
          'buyer-country': notice['buyer-country'],
          source: 'ted',
          source_ref: first.sourceRef,
        },
      }),
    );
    const buyerId = buyerRows[0].id as number;
    counts.buyers += 1;

    const tenderRows = await run(
      buildTenderUpsert({
        sourceId,
        sourceRef: first.sourceRef,
        noticeType: first.noticeType,
        publicationDate: first.publicationDate,
        buyerId,
        title: first.title,
        description: first.description,
        cpvMain,
        cpvAll: first.cpvs,
        nuts: first.buyer.nuts,
        url: first.url,
        raw: notice,
      }),
    );
    const tenderId = tenderRows[0].id as number;
    counts.tenders += 1;

    for (const row of rows) {
      let winnerCompanyId: number | null = null;
      if (row.winner) {
        const companyRows = await run(
          buildCompanyUpsert({
            sourceId,
            sourceRef: row.winner.sourceRef,
            name: row.winner.name,
            nameNorm: normalizeName(row.winner.name),
            country: row.winner.country,
            nif: row.winnerNif,
            raw: {
              'winner-name': notice['winner-name'],
              'winner-identifier': notice['winner-identifier'],
              'winner-country': notice['winner-country'],
              source: 'ted',
              source_ref: row.sourceRef,
            },
          }),
        );
        winnerCompanyId = companyRows[0].id as number;
        counts.companies += 1;
      }

      const derived = deriveContractDates(row);
      const awardPayload = {
        sourceRef: row.sourceRef,
        awardDate: row.awardDate,
        winnerCompanyId,
        lot: null as string | null,
        value: row.value,
        currency: row.currency,
        biddersCount: row.biddersCount,
        framework: row.framework,
        durationMonths: row.durationMonths,
        startDate: derived.startDate,
        endDate: row.endDate, // awards.end_date = explicit only; derivation lives on contracts
        raw: notice,
      };
      const existing = await run(buildAwardSelect(tenderId, null, row.sourceRef));
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
          title: row.title,
          value: row.value,
          currency: row.currency,
          startDate: derived.startDate,
          endDate: derived.endDate,
          durationMonths: row.durationMonths,
          framework: row.framework,
          renewalWindowStart: derived.renewalWindowStart,
          renewalWindowEnd: derived.renewalWindowEnd,
          status,
        }),
      );
      const contractId = contractRows[0].id as number;
      counts.contracts += 1;

      await run(buildContractEventsDelete(contractId));
      const provenance = { source: 'ted', source_ref: row.sourceRef, url: row.url };
      const awardEventDate = row.awardDate ?? derived.startDate;
      if (awardEventDate) {
        await run(
          buildContractEventInsert({
            contractId,
            eventType: 'award',
            eventDate: awardEventDate,
            details: provenance,
            sourceRef: row.sourceRef,
          }),
        );
      }
      if (derived.endDate) {
        await run(
          buildContractEventInsert({
            contractId,
            eventType: 'expiry',
            eventDate: derived.endDate,
            details: { ...provenance, derived: row.endDate === null },
            sourceRef: row.sourceRef,
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

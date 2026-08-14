// GET /v1/buyers/:id/history — buyer profile + awards + supplier concentration + recurrence (SPEC §5).
//
// The SQL below is the SINGLE source for buyer queries: the MCP get_buyer_history
// tool (src/mcp/server.ts) imports these constants instead of replicating them.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { idParamSchema } from '../validate.js';
import {
  dateStr,
  envelope,
  notFound,
  num,
  provenanceFor,
  tedUrl,
  validate,
  type RouteCtx,
} from './common.js';
import { mapAwardRow } from './tenders.js';

export const buyerIdValidation = validate(idParamSchema, 'params');

export const BUYER_SQL = `
SELECT b.*, s.code AS source_code
FROM buyers b
JOIN sources s ON s.id = b.source_id
WHERE b.id = $1
`;

export const BUYER_AWARDS_SQL = `
SELECT a.*, c.id AS c_id, c.name AS c_name,
       t.id AS t_id, t.title AS t_title, t.cpv_main AS t_cpv, t.source_ref AS t_ref,
       count(*) OVER() AS total_count
FROM awards a
JOIN tenders t ON t.id = a.tender_id
LEFT JOIN companies c ON c.id = a.winner_company_id
WHERE t.buyer_id = $1
ORDER BY a.award_date DESC NULLS LAST, a.id
LIMIT 50
`;

export const BUYER_SUPPLIERS_SQL = `
SELECT a.winner_company_id AS id, c.name,
       count(*)::int AS wins, sum(a.value) AS total_value
FROM awards a
JOIN tenders t ON t.id = a.tender_id
LEFT JOIN companies c ON c.id = a.winner_company_id
WHERE t.buyer_id = $1 AND a.winner_company_id IS NOT NULL
GROUP BY a.winner_company_id, c.name
ORDER BY wins DESC, a.winner_company_id
`;

export const BUYER_AWARD_DATES_SQL = `
SELECT left(t.cpv_main, 2) AS division, a.award_date
FROM awards a
JOIN tenders t ON t.id = a.tender_id
WHERE t.buyer_id = $1 AND a.award_date IS NOT NULL AND t.cpv_main IS NOT NULL
ORDER BY division, a.award_date
`;

// --- pure aggregation helpers (unit-tested) ---------------------------------------

export interface SupplierRow {
  id: number;
  name: string;
  wins: number;
  total_value: number | null;
}

export interface Concentration {
  suppliers: SupplierRow[];
  distinct_suppliers: number;
  /** share of awards count won by the top-3 suppliers (0..1) */
  top3_share_by_count: number | null;
  /** share of awarded value won by the top-3 suppliers (0..1, null if no values known) */
  top3_share_by_value: number | null;
}

export function computeConcentration(rows: SupplierRow[]): Concentration {
  const sorted = [...rows].sort((a, b) => b.wins - a.wins || a.id - b.id);
  const totalWins = sorted.reduce((s, r) => s + r.wins, 0);
  const top3 = sorted.slice(0, 3);
  const top3Wins = top3.reduce((s, r) => s + r.wins, 0);

  const withValue = sorted.filter((r) => r.total_value !== null);
  const totalValue = withValue.reduce((s, r) => s + (r.total_value ?? 0), 0);
  const top3Value = top3
    .filter((r) => r.total_value !== null)
    .reduce((s, r) => s + (r.total_value ?? 0), 0);

  return {
    suppliers: sorted.slice(0, 10),
    distinct_suppliers: sorted.length,
    top3_share_by_count: totalWins > 0 ? round4(top3Wins / totalWins) : null,
    top3_share_by_value:
      withValue.length > 0 && totalValue > 0 ? round4(top3Value / totalValue) : null,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export interface RecurrenceEntry {
  cpv_division: string;
  awards: number;
  /** median months between consecutive awards in this CPV division */
  median_months_between_awards: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375;

/** rows: {division, award_date} — award_date Date or YYYY-MM-DD string. */
export function computeRecurrence(
  rows: Array<{ division: string; award_date: Date | string }>,
): RecurrenceEntry[] {
  const byDiv = new Map<string, number[]>();
  for (const r of rows) {
    const t =
      r.award_date instanceof Date
        ? r.award_date.getTime()
        : new Date(`${String(r.award_date).slice(0, 10)}T00:00:00Z`).getTime();
    if (Number.isNaN(t)) continue;
    const arr = byDiv.get(r.division) ?? [];
    arr.push(t);
    byDiv.set(r.division, arr);
  }
  const out: RecurrenceEntry[] = [];
  for (const [division, times] of byDiv) {
    times.sort((a, b) => a - b);
    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) {
      intervals.push((times[i] - times[i - 1]) / MS_PER_MONTH);
    }
    const med = median(intervals);
    out.push({
      cpv_division: division,
      awards: times.length,
      median_months_between_awards: med === null ? null : round4(med),
    });
  }
  return out.sort((a, b) => a.cpv_division.localeCompare(b.cpv_division));
}

// --- handler -------------------------------------------------------------------------

export function buyerHistoryHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(req.params);
    const bRes = await ctx.db.query(BUYER_SQL, [id]);
    if (bRes.rows.length === 0) throw notFound(`Buyer ${id}`);
    const b = bRes.rows[0];

    const [awardsRes, suppliersRes, datesRes] = await Promise.all([
      ctx.db.query(BUYER_AWARDS_SQL, [id]),
      ctx.db.query(BUYER_SUPPLIERS_SQL, [id]),
      ctx.db.query(BUYER_AWARD_DATES_SQL, [id]),
    ]);

    const totalAwards = awardsRes.rows.length > 0 ? Number(awardsRes.rows[0].total_count) : 0;
    const supplierRows: SupplierRow[] = suppliersRes.rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      wins: Number(r.wins),
      total_value: num(r.total_value),
    }));

    const data = {
      id: Number(b.id),
      source_ref: (b.source_ref as string) ?? null,
      name: String(b.name),
      country: (b.country as string) ?? null,
      nuts: (b.nuts as string) ?? null,
      org_type: (b.org_type as string) ?? null,
      awards: awardsRes.rows.map((r) => ({
        ...mapAwardRow(r),
        tender: {
          id: r.t_id != null ? Number(r.t_id) : null,
          source_ref: (r.t_ref as string) ?? null,
          title: (r.t_title as string) ?? null,
          cpv_main: (r.t_cpv as string) ?? null,
        },
      })),
      awards_total: totalAwards,
      awards_returned: awardsRes.rows.length,
      supplier_concentration: computeConcentration(supplierRows),
      recurrence: computeRecurrence(
        datesRes.rows.map((r) => ({ division: String(r.division), award_date: r.award_date })),
      ),
    };

    return reply.send(
      envelope(req, data, {
        provenance: provenanceFor(
          b.source_code as string,
          (b.source_ref as string) ?? null,
          tedUrl(b.source_ref as string | null),
        ),
      }),
    );
  };
}

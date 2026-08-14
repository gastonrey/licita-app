// Forecast signals (SPEC §8): deterministic, SQL + pure functions, no LLM.
//
// signal types:
// - duration_expiry  : non-framework contract with an end_date → end ± 90d.
//                      confidence medium when the award carried an explicit
//                      end date, low when it was derived from duration.
// - framework_expiry : framework contract. Explicit end → end ± 90d (medium);
//                      otherwise LCSP 48-month cap from award date ± 90d (low).
// - recurrence       : same buyer + same CPV division (first 2 digits) with
//                      >= 2 dated awards → window = last award + median
//                      interval ± 25%. Confidence by evidence count:
//                      2 → medium, >= 3 → high (1 → low, n/a for recurrence).
//
// Recompute strategy per SPEC: delete all forecast_signals, then rebuild.
// Date arithmetic is done in JS (keeps this correct on Postgres and pg-mem).
// Every signal's `basis` jsonb carries the full evidence trail (basis_version: 1)
// so consumers can audit exactly why a signal exists and why its confidence
// is low/medium/high — heuristic evidence, never a calibrated probability.

import type { Db } from '../db/client.js';
import {
  FRAMEWORK_MAX_MONTHS,
  RENEWAL_WINDOW_DAYS,
  addDaysIso,
  addMonthsIso,
} from '../ingest/normalize.js';

export type Confidence = 'low' | 'medium' | 'high';
export type SignalType = 'duration_expiry' | 'framework_expiry' | 'recurrence';

export interface SignalInsert {
  buyer_id: number | null;
  cpv: string | null;
  incumbent_company_id: number | null;
  contract_id: number | null;
  signal_type: SignalType;
  window_start: string;
  window_end: string;
  confidence: Confidence;
  basis: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without a database)
// ---------------------------------------------------------------------------

export function confidenceForEvidence(count: number): Confidence {
  if (count >= 3) return 'high';
  if (count === 2) return 'medium';
  return 'low';
}

/** DB date → "YYYY-MM-DD". node-pg returns DATE as local-midnight Date,
 *  pg-mem as UTC-midnight Date; both are detected via UTC time-of-day. */
export function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    const utc = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0;
    const y = utc ? v.getUTCFullYear() : v.getFullYear();
    const m = (utc ? v.getUTCMonth() : v.getMonth()) + 1;
    const d = utc ? v.getUTCDate() : v.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function daysBetween(aIso: string, bIso: string): number {
  return Math.round((Date.parse(`${bIso}T00:00:00Z`) - Date.parse(`${aIso}T00:00:00Z`)) / 86_400_000);
}

/** Median interval (days) between consecutive sorted award dates. */
export function intervalDays(sortedDates: string[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < sortedDates.length; i += 1) {
    gaps.push(daysBetween(sortedDates[i - 1], sortedDates[i]));
  }
  return gaps;
}

export function medianIntervalDays(sortedDates: string[]): number | null {
  if (sortedDates.length < 2) return null;
  return median(intervalDays(sortedDates));
}

/** Rule string recorded in recurrence basis so the window is auditable. */
export const RECURRENCE_WINDOW_RULE = 'last_award + median_interval ± 25%';

/** last award + median interval, ±25%. */
export function recurrenceWindow(
  lastAwardIso: string,
  medianDays: number,
): { windowStart: string; windowEnd: string; predictedDate: string } {
  const predicted = Date.parse(`${lastAwardIso}T00:00:00Z`) + medianDays * 86_400_000;
  const start = new Date(predicted - medianDays * 0.25 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(predicted + medianDays * 0.25 * 86_400_000).toISOString().slice(0, 10);
  return {
    windowStart: start,
    windowEnd: end,
    predictedDate: new Date(predicted).toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Signal derivation from contract/award rows (pure)
// ---------------------------------------------------------------------------

/** Version of the basis jsonb contract; bump on any shape change. */
export const BASIS_VERSION = 1;

export interface ContractSignalRow {
  contract_id: number;
  buyer_id: number | null;
  company_id: number | null;
  cpv: string | null;
  framework: boolean;
  end_date: string | null; // derived end on contracts
  award_date: string | null;
  explicit_end_date: string | null; // awards.end_date (from the notice)
  start_date: string | null; // contracts.start_date
  duration_months: number | null; // contracts.duration_months
  source_ref: string; // award notice ref
  tender_source_ref: string | null; // tender publication ref
}

function contractBasis(
  row: ContractSignalRow,
  rule: string,
  endDate: string,
  confidenceRule: string,
): Record<string, unknown> {
  return {
    basis_version: BASIS_VERSION,
    rule,
    confidence_rule: confidenceRule,
    end_date: endDate,
    award_date: row.award_date,
    start_date: row.start_date,
    duration_months: row.duration_months,
    framework: row.framework,
    buyer_id: row.buyer_id,
    cpv: row.cpv,
    incumbent_company_id: row.company_id,
    source_ref: row.source_ref,
    tender_source_ref: row.tender_source_ref,
  };
}

const CONFIDENCE_RULES = {
  explicit_end_date: 'medium: the award notice carried an explicit end date',
  derived_from_duration:
    'low: end date derived from contract duration; the notice had no explicit end date',
  lcsp_cap:
    `low: LCSP ${FRAMEWORK_MAX_MONTHS}-month framework cap from award date; ` +
    'the notice had no explicit end date',
} as const;

export function contractSignals(row: ContractSignalRow): SignalInsert[] {
  const out: SignalInsert[] = [];
  const base = {
    buyer_id: row.buyer_id,
    cpv: row.cpv,
    incumbent_company_id: row.company_id,
    contract_id: row.contract_id,
  };
  if (row.framework) {
    if (row.end_date) {
      const explicit = row.explicit_end_date !== null;
      out.push({
        ...base,
        signal_type: 'framework_expiry',
        window_start: addDaysIso(row.end_date, -RENEWAL_WINDOW_DAYS),
        window_end: addDaysIso(row.end_date, RENEWAL_WINDOW_DAYS),
        confidence: explicit ? 'medium' : 'low',
        basis: contractBasis(
          row,
          explicit ? 'explicit_end_date' : `lcsp_${FRAMEWORK_MAX_MONTHS}m_cap`,
          row.end_date,
          explicit ? CONFIDENCE_RULES.explicit_end_date : CONFIDENCE_RULES.lcsp_cap,
        ),
      });
    } else if (row.award_date) {
      const end = addMonthsIso(row.award_date, FRAMEWORK_MAX_MONTHS);
      out.push({
        ...base,
        signal_type: 'framework_expiry',
        window_start: addDaysIso(end, -RENEWAL_WINDOW_DAYS),
        window_end: addDaysIso(end, RENEWAL_WINDOW_DAYS),
        confidence: 'low',
        basis: contractBasis(
          row,
          `lcsp_${FRAMEWORK_MAX_MONTHS}m_cap`,
          end,
          CONFIDENCE_RULES.lcsp_cap,
        ),
      });
    }
    return out;
  }
  if (row.end_date) {
    const explicit = row.explicit_end_date !== null;
    out.push({
      ...base,
      signal_type: 'duration_expiry',
      window_start: addDaysIso(row.end_date, -RENEWAL_WINDOW_DAYS),
      window_end: addDaysIso(row.end_date, RENEWAL_WINDOW_DAYS),
      confidence: explicit ? 'medium' : 'low',
      basis: contractBasis(
        row,
        explicit ? 'explicit_end_date' : 'derived_from_duration',
        row.end_date,
        explicit ? CONFIDENCE_RULES.explicit_end_date : CONFIDENCE_RULES.derived_from_duration,
      ),
    });
  }
  return out;
}

export interface RecurrenceAwardRow {
  buyer_id: number;
  cpv_main: string;
  award_date: string;
  winner_company_id: number | null;
  contract_id: number | null;
  source_ref: string;
}

export function recurrenceSignals(rows: RecurrenceAwardRow[]): SignalInsert[] {
  const groups = new Map<string, RecurrenceAwardRow[]>();
  for (const r of rows) {
    const key = `${r.buyer_id}|${r.cpv_main.slice(0, 2)}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }
  const out: SignalInsert[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.award_date.localeCompare(b.award_date));
    const dates = sorted.map((r) => r.award_date);
    const gaps = intervalDays(dates);
    const medianDays = median(gaps);
    if (medianDays === null || medianDays <= 0) continue;
    const last = sorted[sorted.length - 1];
    const confidence = confidenceForEvidence(sorted.length);
    const { windowStart, windowEnd, predictedDate } = recurrenceWindow(last.award_date, medianDays);
    out.push({
      buyer_id: last.buyer_id,
      cpv: last.cpv_main.slice(0, 2),
      incumbent_company_id: last.winner_company_id,
      contract_id: last.contract_id,
      signal_type: 'recurrence',
      window_start: windowStart,
      window_end: windowEnd,
      confidence,
      basis: {
        basis_version: BASIS_VERSION,
        evidence_count: sorted.length,
        confidence_rule:
          `${confidence}: ${sorted.length} dated awards for this buyer + CPV division ` +
          '(2 → medium, ≥ 3 → high)',
        window_rule: RECURRENCE_WINDOW_RULE,
        predicted_date: predictedDate,
        median_interval_days: medianDays,
        intervals_days: gaps,
        last_award_date: last.award_date,
        award_refs: sorted.map((r) => r.source_ref),
        award_history: sorted.map((r) => ({
          source_ref: r.source_ref,
          award_date: r.award_date,
        })),
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// DB recompute
// ---------------------------------------------------------------------------

export interface RecomputeResult {
  total: number;
  byType: Record<SignalType, number>;
}

export async function recomputeSignals(db: Db): Promise<RecomputeResult> {
  await db.query('DELETE FROM forecast_signals');

  const contractRows = (
    (
      await db.query(
        `SELECT c.id AS contract_id, c.buyer_id, c.company_id, c.cpv, c.framework,
                c.end_date, c.start_date, c.duration_months,
                a.award_date, a.end_date AS explicit_end_date, a.source_ref,
                t.source_ref AS tender_source_ref
         FROM contracts c
         JOIN awards a ON a.id = c.award_id
         JOIN tenders t ON t.id = a.tender_id`,
      )
    ).rows as Array<Record<string, unknown>>
  ).map((r) => ({
    contract_id: r.contract_id as number,
    buyer_id: (r.buyer_id as number | null) ?? null,
    company_id: (r.company_id as number | null) ?? null,
    cpv: (r.cpv as string | null) ?? null,
    framework: Boolean(r.framework),
    end_date: toIsoDate(r.end_date),
    award_date: toIsoDate(r.award_date),
    explicit_end_date: toIsoDate(r.explicit_end_date),
    start_date: toIsoDate(r.start_date),
    duration_months:
      r.duration_months === null || r.duration_months === undefined
        ? null
        : Number(r.duration_months),
    source_ref: String(r.source_ref),
    tender_source_ref: (r.tender_source_ref as string | null) ?? null,
  })) as ContractSignalRow[];

  const recurrenceRows = (
    (
      await db.query(
        `SELECT t.buyer_id, t.cpv_main, a.award_date,
                a.winner_company_id, c.id AS contract_id, a.source_ref
         FROM awards a
         JOIN tenders t ON t.id = a.tender_id
         LEFT JOIN contracts c ON c.award_id = a.id
         WHERE a.award_date IS NOT NULL AND t.buyer_id IS NOT NULL AND t.cpv_main IS NOT NULL
         ORDER BY t.buyer_id, t.cpv_main, a.award_date`,
      )
    ).rows as Array<Record<string, unknown>>
  ).map((r) => ({
    buyer_id: r.buyer_id as number,
    cpv_main: r.cpv_main as string,
    award_date: toIsoDate(r.award_date) as string,
    winner_company_id: (r.winner_company_id as number | null) ?? null,
    contract_id: (r.contract_id as number | null) ?? null,
    source_ref: String(r.source_ref),
  })) as RecurrenceAwardRow[];

  const signals: SignalInsert[] = [
    ...contractRows.flatMap(contractSignals),
    ...recurrenceSignals(recurrenceRows),
  ];

  const byType: Record<SignalType, number> = {
    duration_expiry: 0,
    framework_expiry: 0,
    recurrence: 0,
  };
  for (const s of signals) {
    await db.query(
      `INSERT INTO forecast_signals(buyer_id, cpv, incumbent_company_id, contract_id,
         signal_type, window_start, window_end, confidence, basis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        s.buyer_id,
        s.cpv,
        s.incumbent_company_id,
        s.contract_id,
        s.signal_type,
        s.window_start,
        s.window_end,
        s.confidence,
        JSON.stringify(s.basis),
      ],
    );
    byType[s.signal_type] += 1;
  }
  return { total: signals.length, byType };
}

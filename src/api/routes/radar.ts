// GET /v1/radar/preview — free, capped sample of the live index for the
// public radar and the homepage table.
//
// Scope is intentional and narrow: CPV 48 (software packages) and 72 (IT
// services, which is where cybersecurity services are classified). Rows are
// real database records. Missing values stay null. The calculation string is
// assembled only from fields already stored in forecast_signals.basis — it is
// not a generated narrative. The paid GET /v1/renewals contract is unchanged.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Provenance } from '../../domain/types.js';
import type { Db } from '../../db/client.js';
import { dateStr, envelope, num, Params, tedUrl, validate, type RouteCtx } from './common.js';
import { RENEWALS_METHODOLOGY, openWindowSql, renewalHorizonIso, SIGNAL_ORDER_SQL } from './renewals.js';

export const RADAR_PREVIEW_LIMIT = 8;
export const RADAR_NOTE =
  'Free public sample of the Relicita index for CPV 48 (software) and 72 (IT services, including cybersecurity). ' +
  'At most 8 renewal signals and 8 recent tenders. Values are real rows; null means the source did not report it. ' +
  'The calculation cites stored basis fields and is not a model narrative. ' +
  'The full feed remains GET /v1/renewals.';

const cpvSchema = z
  .string()
  .regex(/^(48|72)\d{0,6}$/, 'cpv must be a 48 or 72 prefix (software or IT services)')
  .optional();

export const radarPreviewQuerySchema = z.object({
  cpv: cpvSchema,
  buyer: z.string().trim().max(80).optional(),
  region: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{2,5}$/, 'region must be a 2–5 character NUTS prefix')
    .optional(),
  window_months: z.coerce
    .number()
    .int()
    .refine((n) => n === 6 || n === 12, 'window_months must be 6 or 12')
    .default(12),
});

export type RadarPreviewQuery = z.infer<typeof radarPreviewQuerySchema>;
export const radarPreviewValidation = validate(radarPreviewQuerySchema, 'query');

/** @deprecated use renewalHorizonIso. Kept as the name the preview filter reports. */
export function windowCutoffIso(months: number, now = new Date()): string {
  return renewalHorizonIso(months, now);
}

const BASIS_KEYS = [
  'rule',
  'window_rule',
  'confidence_rule',
  'end_date',
  'predicted_date',
  'median_interval_days',
  'evidence_count',
  'last_award_date',
] as const;

/**
 * Audit line for a signal. Only stored basis fields are quoted.
 * Returns null when the row has no usable basis — callers must not invent one.
 */
export function calculationFromBasis(basis: unknown): string | null {
  if (!basis || typeof basis !== 'object' || Array.isArray(basis)) return null;
  const record = basis as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of BASIS_KEYS) {
    const value = record[key];
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number') parts.push(`${key}=${value}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function prefixesFor(cpv: string | undefined): string[] {
  return cpv ? [cpv] : ['48', '72'];
}

function likeClause(column: string, prefixes: string[], p: Params): string {
  return `(${prefixes.map((prefix) => `${column} LIKE ${p.push(`${prefix}%`)}`).join(' OR ')})`;
}

export function buildRenewalPreviewQuery(q: RadarPreviewQuery): { text: string; values: unknown[] } {
  const p = new Params();
  const prefixes = prefixesFor(q.cpv);
  const where = [
    openWindowSql(p.push(renewalHorizonIso(q.window_months))),
    likeClause('fs.cpv', prefixes, p),
    `(${p.push(q.buyer ?? '')} = '' OR lower(coalesce(b.name, '')) LIKE '%' || lower(${p.push(q.buyer ?? '')}) || '%')`,
    `(${p.push(q.region ?? '')} = '' OR coalesce(b.nuts, '') ILIKE ${p.push(q.region ?? '')} || '%')`,
  ];
  const text = `
SELECT
  fs.id, fs.signal_type, fs.cpv, fs.window_start, fs.window_end, fs.confidence, fs.basis,
  b.name AS buyer_name,
  c.name AS incumbent_name,
  ct.title AS contract_title, ct.value AS contract_value, ct.currency AS contract_currency,
  ct.end_date AS contract_end,
  s.code AS source_code, t.source_ref AS tender_source_ref
FROM forecast_signals fs
LEFT JOIN buyers b ON b.id = fs.buyer_id
LEFT JOIN companies c ON c.id = fs.incumbent_company_id
LEFT JOIN contracts ct ON ct.id = fs.contract_id
LEFT JOIN awards a ON a.id = ct.award_id
LEFT JOIN tenders t ON t.id = a.tender_id
LEFT JOIN sources s ON s.id = t.source_id
WHERE ${where.join('\n  AND ')}
${SIGNAL_ORDER_SQL}
LIMIT ${RADAR_PREVIEW_LIMIT}
`;
  return { text, values: p.values };
}

export function buildRenewalCountQuery(q: RadarPreviewQuery): { text: string; values: unknown[] } {
  const p = new Params();
  const prefixes = prefixesFor(q.cpv);
  const where = [
    openWindowSql(p.push(renewalHorizonIso(q.window_months))),
    likeClause('fs.cpv', prefixes, p),
    `(${p.push(q.buyer ?? '')} = '' OR lower(coalesce(b.name, '')) LIKE '%' || lower(${p.push(q.buyer ?? '')}) || '%')`,
    `(${p.push(q.region ?? '')} = '' OR coalesce(b.nuts, '') ILIKE ${p.push(q.region ?? '')} || '%')`,
  ];
  const text = `
SELECT count(*)::int AS n
FROM forecast_signals fs
LEFT JOIN buyers b ON b.id = fs.buyer_id
WHERE ${where.join('\n  AND ')}
`;
  return { text, values: p.values };
}

export function buildOpportunityPreviewQuery(q: RadarPreviewQuery): { text: string; values: unknown[] } {
  const p = new Params();
  const prefixes = prefixesFor(q.cpv);
  const where = [
    likeClause('t.cpv_main', prefixes, p),
    `(${p.push(q.buyer ?? '')} = '' OR lower(coalesce(b.name, '')) LIKE '%' || lower(${p.push(q.buyer ?? '')}) || '%')`,
    `(${p.push(q.region ?? '')} = '' OR coalesce(t.nuts, '') ILIKE ${p.push(q.region ?? '')} || '%' OR coalesce(b.nuts, '') ILIKE ${p.push(q.region ?? '')} || '%')`,
  ];
  const text = `
SELECT
  t.id, t.title, t.cpv_main, t.estimated_value, t.currency, t.publication_date, t.deadline,
  t.nuts, t.source_ref,
  s.code AS source_code,
  b.name AS buyer_name
FROM tenders t
JOIN sources s ON s.id = t.source_id
LEFT JOIN buyers b ON b.id = t.buyer_id
WHERE ${where.join('\n  AND ')}
ORDER BY t.publication_date DESC, t.id DESC
LIMIT ${RADAR_PREVIEW_LIMIT}
`;
  return { text, values: p.values };
}

export function buildOpportunityCountQuery(q: RadarPreviewQuery): { text: string; values: unknown[] } {
  const p = new Params();
  const prefixes = prefixesFor(q.cpv);
  const where = [
    likeClause('t.cpv_main', prefixes, p),
    `(${p.push(q.buyer ?? '')} = '' OR lower(coalesce(b.name, '')) LIKE '%' || lower(${p.push(q.buyer ?? '')}) || '%')`,
    `(${p.push(q.region ?? '')} = '' OR coalesce(t.nuts, '') ILIKE ${p.push(q.region ?? '')} || '%' OR coalesce(b.nuts, '') ILIKE ${p.push(q.region ?? '')} || '%')`,
  ];
  const text = `
SELECT count(*)::int AS n
FROM tenders t
LEFT JOIN buyers b ON b.id = t.buyer_id
WHERE ${where.join('\n  AND ')}
`;
  return { text, values: p.values };
}

function sourceUrl(code: string | null, sourceRef: string | null): string | null {
  if (code === 'ted' && sourceRef) return tedUrl(sourceRef) ?? null;
  return null;
}

function mapRenewal(row: Record<string, unknown>): Record<string, unknown> {
  const source = (row.source_code as string) ?? null;
  const sourceRef = (row.tender_source_ref as string) ?? null;
  return {
    sample: true,
    id: Number(row.id),
    signal_type: String(row.signal_type),
    cpv: (row.cpv as string) ?? null,
    window_start: dateStr(row.window_start),
    window_end: dateStr(row.window_end),
    confidence: (row.confidence as string) ?? null,
    buyer: row.buyer_name != null ? { name: String(row.buyer_name) } : null,
    incumbent: row.incumbent_name != null ? { name: String(row.incumbent_name) } : null,
    contract:
      row.contract_title != null || row.contract_value != null || row.contract_end != null
        ? {
            title: (row.contract_title as string) ?? null,
            value: num(row.contract_value),
            currency: (row.contract_currency as string) ?? null,
            end_date: dateStr(row.contract_end),
          }
        : null,
    source,
    source_ref: sourceRef,
    url: sourceUrl(source, sourceRef),
    basis: row.basis ?? null,
    calculation: calculationFromBasis(row.basis),
  };
}

function mapOpportunity(row: Record<string, unknown>): Record<string, unknown> {
  const source = String(row.source_code);
  const sourceRef = (row.source_ref as string) ?? null;
  return {
    sample: true,
    id: Number(row.id),
    title: (row.title as string) ?? null,
    cpv: (row.cpv_main as string) ?? null,
    buyer: row.buyer_name != null ? { name: String(row.buyer_name) } : null,
    estimated_value: num(row.estimated_value),
    currency: (row.currency as string) ?? null,
    published_at: dateStr(row.publication_date),
    deadline: row.deadline ? new Date(row.deadline as string).toISOString() : null,
    region: (row.nuts as string) ?? null,
    source,
    source_ref: sourceRef,
    url: sourceUrl(source, sourceRef),
  };
}

export async function radarPreviewData(db: Db, q: RadarPreviewQuery): Promise<Record<string, unknown>> {
  const renewalsQuery = buildRenewalPreviewQuery(q);
  const renewalCount = buildRenewalCountQuery(q);
  const opportunitiesQuery = buildOpportunityPreviewQuery(q);
  const opportunityCount = buildOpportunityCountQuery(q);
  const [renewals, renewalTotal, opportunities, opportunityTotal] = await Promise.all([
    db.query(renewalsQuery.text, renewalsQuery.values),
    db.query(renewalCount.text, renewalCount.values),
    db.query(opportunitiesQuery.text, opportunitiesQuery.values),
    db.query(opportunityCount.text, opportunityCount.values),
  ]);
  const renewalRows = renewals.rows.map((row) => mapRenewal(row as Record<string, unknown>));
  const opportunityRows = opportunities.rows.map((row) => mapOpportunity(row as Record<string, unknown>));
  return {
    note: RADAR_NOTE,
    filters: {
      cpv: q.cpv ?? null,
      cpv_prefixes: prefixesFor(q.cpv),
      buyer: q.buyer ?? null,
      region: q.region ?? null,
      window_months: q.window_months,
      window_end: windowCutoffIso(q.window_months),
    },
    renewals: {
      rows: renewalRows,
      shown: renewalRows.length,
      total: Number(renewalTotal.rows[0]?.n ?? 0),
    },
    opportunities: {
      rows: opportunityRows,
      shown: opportunityRows.length,
      total: Number(opportunityTotal.rows[0]?.n ?? 0),
    },
    methodology: RENEWALS_METHODOLOGY,
  };
}

function provenanceOf(data: Record<string, unknown>): Provenance[] {
  const out: Provenance[] = [];
  const take = (rows: Array<{ source?: string | null; source_ref?: string | null }>) => {
    for (const row of rows) {
      if (out.length >= 10) return;
      if (row.source && row.source_ref) out.push({ source: row.source, source_ref: row.source_ref });
    }
  };
  const renewals = data.renewals as { rows: Array<{ source?: string | null; source_ref?: string | null }> };
  const opportunities = data.opportunities as { rows: Array<{ source?: string | null; source_ref?: string | null }> };
  take(renewals.rows);
  take(opportunities.rows);
  return out;
}

export function radarPreviewHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const q = radarPreviewQuerySchema.parse(req.query);
    const data = await radarPreviewData(ctx.db, q);
    const renewals = data.renewals as { total: number };
    const opportunities = data.opportunities as { total: number };
    req.zeroResult = renewals.total === 0 && opportunities.total === 0;
    return reply.send(
      envelope(req, data, {
        provenance: provenanceOf(data),
        meta: { methodology: RENEWALS_METHODOLOGY, generated_at: new Date().toISOString(), sample: true },
      }),
    );
  };
}

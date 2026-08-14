// GET /v1/renewals — forecast signals joined with contracts/buyers/companies (SPEC §5).

import type { FastifyReply, FastifyRequest } from 'fastify';
import { CONFIDENCE_RANK, renewalsQuerySchema, type RenewalsQuery } from '../validate.js';
import { dateStr, envelope, limitOffset, num, Params, validate, type RouteCtx } from './common.js';

export const renewalsValidation = validate(renewalsQuerySchema, 'query');

/**
 * Short machine+human-readable framing for renewals: deterministic heuristic,
 * NOT a calibrated probability. Every signal exposes its evidence in `basis`.
 */
export const RENEWALS_METHODOLOGY =
  'Deterministic heuristic over historical awards and contract dates ' +
  '(explicit end dates, contract durations, the LCSP 48-month framework cap, ' +
  'and award recurrence medians); NOT a calibrated probability. ' +
  "Each signal's evidence and confidence rule are exposed in its basis.";

/** The only confidence labels the API emits. */
export const CONFIDENCE_SCALE = ['low', 'medium', 'high'] as const;

// --- pure SQL builder -------------------------------------------------------------

export function buildRenewalsQuery(q: RenewalsQuery): { text: string; values: unknown[] } {
  const p = new Params();
  const where: string[] = [];

  // window: signals whose renewal window starts within the next window_months
  where.push(`fs.window_start <= CURRENT_DATE + make_interval(months => ${p.push(q.window_months)})`);
  if (q.cpv) where.push(`fs.cpv LIKE ${p.push(`${q.cpv}%`)}`);
  if (q.buyer) {
    where.push(`b.name_norm LIKE '%' || lower(unaccent(${p.push(q.buyer.trim().toLowerCase())})) || '%'`);
  }
  where.push(
    `CASE fs.confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END >= ${p.push(
      CONFIDENCE_RANK[q.min_confidence] ?? 1,
    )}`,
  );

  const text = `
SELECT
  fs.id, fs.signal_type, fs.cpv, fs.window_start, fs.window_end, fs.confidence, fs.basis, fs.computed_at,
  b.id AS buyer_id, b.name AS buyer_name,
  c.id AS incumbent_id, c.name AS incumbent_name,
  ct.id AS contract_id, ct.title AS contract_title, ct.value AS contract_value,
  ct.currency AS contract_currency, ct.start_date AS contract_start, ct.end_date AS contract_end,
  count(*) OVER() AS total_count
FROM forecast_signals fs
LEFT JOIN buyers b ON b.id = fs.buyer_id
LEFT JOIN companies c ON c.id = fs.incumbent_company_id
LEFT JOIN contracts ct ON ct.id = fs.contract_id
WHERE ${where.join('\nAND ')}
ORDER BY fs.window_start ASC NULLS LAST, fs.id ASC
${limitOffset(p, q.page, q.size)}
`;
  return { text, values: p.values };
}

export function mapRenewalRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: Number(r.id),
    signal_type: String(r.signal_type),
    cpv: (r.cpv as string) ?? null,
    window_start: dateStr(r.window_start),
    window_end: dateStr(r.window_end),
    confidence: (r.confidence as string) ?? null,
    basis: r.basis ?? null,
    computed_at: r.computed_at ? new Date(r.computed_at as string).toISOString() : null,
    buyer: r.buyer_id != null ? { id: Number(r.buyer_id), name: String(r.buyer_name) } : null,
    incumbent:
      r.incumbent_id != null ? { id: Number(r.incumbent_id), name: String(r.incumbent_name) } : null,
    contract:
      r.contract_id != null
        ? {
            id: Number(r.contract_id),
            title: (r.contract_title as string) ?? null,
            value: num(r.contract_value),
            currency: (r.contract_currency as string) ?? null,
            start_date: dateStr(r.contract_start),
            end_date: dateStr(r.contract_end),
          }
        : null,
  };
}

export function renewalsHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const q = renewalsQuerySchema.parse(req.query);
    const { text, values } = buildRenewalsQuery(q);
    const res = await ctx.db.query(text, values);
    const total = res.rows.length > 0 ? Number(res.rows[0].total_count) : 0;
    req.zeroResult = total === 0;
    return reply.send(
      envelope(req, res.rows.map(mapRenewalRow), {
        page: q.page,
        total,
        meta: { methodology: RENEWALS_METHODOLOGY, confidence_scale: [...CONFIDENCE_SCALE] },
      }),
    );
  };
}

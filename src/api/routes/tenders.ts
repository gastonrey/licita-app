// GET /v1/tenders/:id — full tender + awards + provenance (SPEC §5).

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

export const tenderIdValidation = validate(idParamSchema, 'params');

export const TENDER_SQL = `
SELECT t.*, s.code AS source_code,
       b.id AS b_id, b.name AS b_name, b.country AS b_country, b.nuts AS b_nuts, b.org_type AS b_org_type
FROM tenders t
JOIN sources s ON s.id = t.source_id
LEFT JOIN buyers b ON b.id = t.buyer_id
WHERE t.id = $1
`;

export const TENDER_AWARDS_SQL = `
SELECT a.*, c.id AS c_id, c.name AS c_name, c.country AS c_country, c.nif AS c_nif
FROM awards a
LEFT JOIN companies c ON c.id = a.winner_company_id
WHERE a.tender_id = $1
ORDER BY a.award_date DESC NULLS LAST, a.id
`;

export function mapAwardRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: Number(r.id),
    source_ref: (r.source_ref as string) ?? null,
    award_date: dateStr(r.award_date),
    lot: (r.lot as string) ?? null,
    winner: r.c_id != null ? { id: Number(r.c_id), name: String(r.c_name) } : null,
    value: num(r.value),
    currency: (r.currency as string) ?? null,
    bidders_count: r.bidders_count != null ? Number(r.bidders_count) : null,
    framework: r.framework === true,
    duration_months: num(r.duration_months),
    start_date: dateStr(r.start_date),
    end_date: dateStr(r.end_date),
  };
}

export function tenderHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(req.params);
    const tRes = await ctx.db.query(TENDER_SQL, [id]);
    if (tRes.rows.length === 0) throw notFound(`Tender ${id}`);
    const t = tRes.rows[0];

    const aRes = await ctx.db.query(TENDER_AWARDS_SQL, [id]);

    const provenance = provenanceFor(
      t.source_code as string,
      (t.source_ref as string) ?? null,
      tedUrl(t.source_ref as string | null, t.url as string | null),
    );

    const data = {
      id: Number(t.id),
      source_ref: (t.source_ref as string) ?? null,
      notice_type: (t.notice_type as string) ?? null,
      publication_date: dateStr(t.publication_date),
      title: (t.title as string) ?? null,
      description: (t.description as string) ?? null,
      cpv_main: (t.cpv_main as string) ?? null,
      cpv_all: (t.cpv_all as string[]) ?? [],
      procedure_type: (t.procedure_type as string) ?? null,
      deadline: t.deadline ? new Date(t.deadline as string).toISOString() : null,
      estimated_value: num(t.estimated_value),
      currency: (t.currency as string) ?? null,
      nuts: (t.nuts as string) ?? null,
      url: tedUrl(t.source_ref as string | null, t.url as string | null) ?? null,
      buyer:
        t.b_id != null
          ? {
              id: Number(t.b_id),
              name: String(t.b_name),
              country: (t.b_country as string) ?? null,
              nuts: (t.b_nuts as string) ?? null,
              org_type: (t.b_org_type as string) ?? null,
            }
          : null,
      awards: aRes.rows.map(mapAwardRow),
    };

    return reply.send(envelope(req, data, { provenance }));
  };
}

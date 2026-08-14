// GET /v1/companies/:id, /v1/companies/:id/awards, /v1/companies/:id/opportunities (SPEC §5).
//
// The SQL below is the SINGLE source for company queries: the MCP tools
// (src/mcp/server.ts) import these constants and companyProfileData() instead
// of replicating statements — keep any change here reflected there.

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../../db/client.js';
import { awardsQuerySchema, idParamSchema, opportunitiesQuerySchema } from '../validate.js';
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

export const companyIdValidation = validate(idParamSchema, 'params');
export const companyAwardsValidation = validate(awardsQuerySchema, 'query');
export const opportunitiesValidation = validate(opportunitiesQuerySchema, 'query');

/** Framework values in TED are ceiling amounts, not actual spend (SPEC §5). */
export const FRAMEWORK_CAVEAT =
  'Framework agreement values are ceiling amounts (maximum possible spend), not actual expenditure.';

export const COMPANY_SQL = `
SELECT c.*, s.code AS source_code
FROM companies c
JOIN sources s ON s.id = c.source_id
WHERE c.id = $1
`;

export const COMPANY_AGG_SQL = `
SELECT count(*)::int AS wins, sum(a.value) AS total_value
FROM awards a
WHERE a.winner_company_id = $1
`;

export const COMPANY_TOP_CPVS_SQL = `
SELECT t.cpv_main AS code, cp.label_en, cp.label_es, count(*)::int AS wins, sum(a.value) AS total_value
FROM awards a
JOIN tenders t ON t.id = a.tender_id
LEFT JOIN cpvs cp ON cp.code = t.cpv_main
WHERE a.winner_company_id = $1 AND t.cpv_main IS NOT NULL
GROUP BY t.cpv_main, cp.label_en, cp.label_es
ORDER BY wins DESC, t.cpv_main
LIMIT 5
`;

export const COMPANY_TOP_BUYERS_SQL = `
SELECT t.buyer_id AS id, b.name, count(*)::int AS wins, sum(a.value) AS total_value
FROM awards a
JOIN tenders t ON t.id = a.tender_id
LEFT JOIN buyers b ON b.id = t.buyer_id
WHERE a.winner_company_id = $1 AND t.buyer_id IS NOT NULL
GROUP BY t.buyer_id, b.name
ORDER BY wins DESC, t.buyer_id
LIMIT 5
`;

export const COMPANY_AWARDS_SQL = `
SELECT a.*, c.id AS c_id, c.name AS c_name,
       t.id AS t_id, t.source_ref AS t_ref, t.title AS t_title, t.cpv_main AS t_cpv, t.publication_date AS t_pubdate,
       t.buyer_id AS t_buyer_id, b.name AS t_buyer_name,
       count(*) OVER() AS total_count
FROM awards a
JOIN tenders t ON t.id = a.tender_id
LEFT JOIN companies c ON c.id = a.winner_company_id
LEFT JOIN buyers b ON b.id = t.buyer_id
WHERE a.winner_company_id = $1
ORDER BY a.award_date DESC NULLS LAST, a.id
LIMIT $2 OFFSET $3
`;

/** Alternative names observed for the company in source payloads (P0.4). */
export const COMPANY_ALIASES_SQL = `
SELECT alias FROM company_aliases WHERE company_id = $1 ORDER BY alias
`;

/** Cross-source identity backbone: nif + per-source identifiers (P0.4). */
export const COMPANY_IDENTIFIERS_SQL = `
SELECT scheme, value FROM company_identifiers WHERE company_id = $1 ORDER BY scheme, value
`;

/** Company row (with source_code) or null — shared by REST and MCP. */
export async function loadCompany(db: Db, id: number): Promise<Record<string, unknown> | null> {
  const res = await db.query(COMPANY_SQL, [id]);
  return res.rows.length > 0 ? (res.rows[0] as Record<string, unknown>) : null;
}

/**
 * Full company profile payload (id/source_ref/name/country/nif + aliases +
 * identifiers + aggregate stats) — the exact `data` shape of
 * GET /v1/companies/:id, shared with the MCP get_company tool.
 */
export async function companyProfileData(
  db: Db,
  c: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = Number(c.id);
  const [agg, topCpvs, topBuyers, aliases, identifiers] = await Promise.all([
    db.query(COMPANY_AGG_SQL, [id]),
    db.query(COMPANY_TOP_CPVS_SQL, [id]),
    db.query(COMPANY_TOP_BUYERS_SQL, [id]),
    db.query(COMPANY_ALIASES_SQL, [id]),
    db.query(COMPANY_IDENTIFIERS_SQL, [id]),
  ]);
  const a = agg.rows[0];
  return {
    id,
    source_ref: (c.source_ref as string) ?? null,
    name: String(c.name),
    country: (c.country as string) ?? null,
    nif: (c.nif as string) ?? null,
    aliases: aliases.rows.map((r) => String(r.alias)),
    identifiers: identifiers.rows.map((r) => ({
      scheme: String(r.scheme),
      value: String(r.value),
    })),
    stats: {
      wins: Number(a.wins),
      total_awarded_value: num(a.total_value),
      top_cpvs: topCpvs.rows.map((r) => ({
        code: String(r.code),
        label_en: (r.label_en as string) ?? null,
        label_es: (r.label_es as string) ?? null,
        wins: Number(r.wins),
        total_value: num(r.total_value),
      })),
      top_buyers: topBuyers.rows.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        wins: Number(r.wins),
        total_value: num(r.total_value),
      })),
    },
  };
}

// --- GET /v1/companies/:id ------------------------------------------------------

export function companyProfileHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(req.params);
    const c = await loadCompany(ctx.db, id);
    if (!c) throw notFound(`Company ${id}`);
    const data = await companyProfileData(ctx.db, c);
    return reply.send(
      envelope(req, data, {
        provenance: provenanceFor(
          c.source_code as string,
          (c.source_ref as string) ?? null,
          tedUrl(c.source_ref as string | null),
        ),
        meta: { caveats: [FRAMEWORK_CAVEAT] },
      }),
    );
  };
}

// --- GET /v1/companies/:id/awards ------------------------------------------------

export function companyAwardsHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(req.params);
    const { page, size } = awardsQuerySchema.parse(req.query);
    if (!(await loadCompany(ctx.db, id))) throw notFound(`Company ${id}`);
    const res = await ctx.db.query(COMPANY_AWARDS_SQL, [id, size, (page - 1) * size]);
    const total = res.rows.length > 0 ? Number(res.rows[0].total_count) : 0;
    req.zeroResult = total === 0;
    const rows = res.rows.map((r) => ({
      ...mapAwardRow(r),
      tender: {
        id: r.t_id != null ? Number(r.t_id) : null,
        source_ref: (r.t_ref as string) ?? null,
        title: (r.t_title as string) ?? null,
        cpv_main: (r.t_cpv as string) ?? null,
        publication_date: dateStr(r.t_pubdate),
        buyer: r.t_buyer_id != null ? { id: Number(r.t_buyer_id), name: String(r.t_buyer_name) } : null,
      },
    }));
    return reply.send(envelope(req, rows, { page, total }));
  };
}

// --- GET /v1/companies/:id/opportunities ------------------------------------------

/**
 * Deterministic similarity ranking (explained in meta.score_explanation):
 *   +2 tender buyer == a buyer this company has won from before
 *   +1 tender CPV division (first 2 digits of cpv_main) matches any historical award CPV division
 * Ties broken by publication_date DESC NULLS LAST, then id ASC.
 */
export const SCORE_EXPLANATION =
  'score = 2*(same buyer as a past win) + 1*(same CPV division, first 2 digits of cpv_main, as a past win); ties: publication_date desc, id asc. Candidates: tenders published in the last 90 days or with a future deadline that share cpv_main or buyer with the company\'s award history. Deterministic heuristic over the company\'s award history; NOT a probability estimate.';

export const OPPORTUNITIES_SQL = `
WITH hist AS (
  SELECT DISTINCT t.buyer_id, t.cpv_main, left(t.cpv_main, 2) AS div
  FROM awards a
  JOIN tenders t ON t.id = a.tender_id
  WHERE a.winner_company_id = $1
),
scored AS (
  SELECT t.id, t.source_ref, t.title, t.publication_date, t.deadline,
         t.cpv_main, t.estimated_value, t.currency, t.nuts, t.url,
         t.buyer_id, b.name AS buyer_name,
         ((t.buyer_id IN (SELECT buyer_id FROM hist))::int * 2
          + (left(t.cpv_main, 2) IN (SELECT div FROM hist))::int) AS score,
         (t.buyer_id IN (SELECT buyer_id FROM hist)) AS same_buyer,
         (t.cpv_main IN (SELECT cpv_main FROM hist)) AS same_cpv
  FROM tenders t
  LEFT JOIN buyers b ON b.id = t.buyer_id
  WHERE (t.publication_date >= CURRENT_DATE - INTERVAL '90 days' OR t.deadline > now())
    AND (t.buyer_id IN (SELECT buyer_id FROM hist) OR t.cpv_main IN (SELECT cpv_main FROM hist))
)
SELECT *, count(*) OVER() AS total_count
FROM scored
ORDER BY score DESC, publication_date DESC NULLS LAST, id ASC
LIMIT $2 OFFSET $3
`;

export function opportunitiesHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParamSchema.parse(req.params);
    const { page, size } = opportunitiesQuerySchema.parse(req.query);
    if (!(await loadCompany(ctx.db, id))) throw notFound(`Company ${id}`);
    const res = await ctx.db.query(OPPORTUNITIES_SQL, [id, size, (page - 1) * size]);
    const total = res.rows.length > 0 ? Number(res.rows[0].total_count) : 0;
    req.zeroResult = total === 0;
    const rows = res.rows.map((r) => ({
      id: Number(r.id),
      source_ref: (r.source_ref as string) ?? null,
      title: (r.title as string) ?? null,
      publication_date: dateStr(r.publication_date),
      deadline: r.deadline ? new Date(r.deadline as string).toISOString() : null,
      cpv_main: (r.cpv_main as string) ?? null,
      estimated_value: num(r.estimated_value),
      currency: (r.currency as string) ?? null,
      nuts: (r.nuts as string) ?? null,
      url: tedUrl(r.source_ref as string | null, r.url as string | null) ?? null,
      buyer: r.buyer_id != null ? { id: Number(r.buyer_id), name: String(r.buyer_name) } : null,
      score: Number(r.score),
      same_buyer: r.same_buyer === true,
      same_cpv: r.same_cpv === true,
    }));
    return reply.send(
      envelope(req, rows, { page, total, meta: { score_explanation: SCORE_EXPLANATION } }),
    );
  };
}

// GET /v1/search — FTS + filters over awards/tenders/contracts (SPEC §5).

import type { FastifyReply, FastifyRequest } from 'fastify';
import { searchQuerySchema, type SearchQuery } from '../validate.js';
import {
  envelope,
  limitOffset,
  num,
  dateStr,
  Params,
  validate,
  type RouteCtx,
} from './common.js';

export const searchValidation = validate(searchQuerySchema, 'query');

// --- pure SQL builder ---------------------------------------------------------

interface TypeConfig {
  from: string;
  dateCol: string;
  cpvCol: string;
  nutsCol: string;
  idCol: string;
  refCol: string;
  valueCol: string;
  currencyCol: string;
  /** how the winner/company is reachable for this row type */
  companyMode: 'direct' | 'exists';
}

const TYPE_CONFIG: Record<SearchQuery['type'], TypeConfig> = {
  award: {
    from: `FROM awards a
JOIN tenders t ON t.id = a.tender_id
LEFT JOIN buyers b ON b.id = t.buyer_id
LEFT JOIN companies c ON c.id = a.winner_company_id`,
    dateCol: 'a.award_date',
    cpvCol: 't.cpv_main',
    nutsCol: 't.nuts',
    idCol: 'a.id',
    refCol: 'a.source_ref',
    valueCol: 'a.value',
    currencyCol: 'a.currency',
    companyMode: 'direct',
  },
  tender: {
    from: `FROM tenders t
LEFT JOIN buyers b ON b.id = t.buyer_id`,
    dateCol: 't.publication_date',
    cpvCol: 't.cpv_main',
    nutsCol: 't.nuts',
    idCol: 't.id',
    refCol: 't.source_ref',
    valueCol: 't.estimated_value',
    currencyCol: 't.currency',
    companyMode: 'exists',
  },
  contract: {
    from: `FROM contracts ct
JOIN awards a ON a.id = ct.award_id
JOIN tenders t ON t.id = a.tender_id
LEFT JOIN buyers b ON b.id = ct.buyer_id
LEFT JOIN companies c ON c.id = ct.company_id`,
    dateCol: 'ct.start_date',
    cpvCol: 'ct.cpv',
    nutsCol: 't.nuts',
    idCol: 'ct.id',
    refCol: 'a.source_ref',
    valueCol: 'ct.value',
    currencyCol: 'ct.currency',
    companyMode: 'direct',
  },
};

const nameLike = (p: Params, col: string, fragment: string): string =>
  `${col} LIKE '%' || lower(unaccent(${p.push(fragment.trim().toLowerCase())})) || '%'`;

export function buildSearchQuery(q: SearchQuery): { text: string; values: unknown[] } {
  const cfg = TYPE_CONFIG[q.type];
  const p = new Params();
  const where: string[] = [];

  if (q.q) where.push(`t.fts @@ plainto_tsquery('spanish', ${p.push(q.q)})`);
  if (q.cpv) where.push(`${cfg.cpvCol} LIKE ${p.push(`${q.cpv}%`)}`);
  if (q.buyer) where.push(nameLike(p, 'b.name_norm', q.buyer));
  if (q.company) {
    if (cfg.companyMode === 'direct') {
      where.push(nameLike(p, 'c.name_norm', q.company));
    } else {
      where.push(
        `EXISTS (SELECT 1 FROM awards ax JOIN companies cx ON cx.id = ax.winner_company_id
         WHERE ax.tender_id = t.id AND ${nameLike(p, 'cx.name_norm', q.company)})`,
      );
    }
  }
  if (q.region) where.push(`${cfg.nutsCol} LIKE ${p.push(`${q.region}%`)}`);
  if (q.from) where.push(`${cfg.dateCol} >= ${p.push(q.from)}::date`);
  if (q.to) where.push(`${cfg.dateCol} <= ${p.push(q.to)}::date`);

  const companyCols =
    cfg.companyMode === 'direct'
      ? 'c.id AS company_id, c.name AS company_name'
      : 'NULL::bigint AS company_id, NULL::text AS company_name';

  const text = `
SELECT
  ${cfg.idCol} AS row_id,
  ${cfg.refCol} AS source_ref,
  t.id AS tender_id,
  t.source_ref AS tender_source_ref,
  t.title,
  ${cfg.dateCol} AS row_date,
  b.id AS buyer_id,
  b.name AS buyer_name,
  ${companyCols},
  ${cfg.valueCol} AS value,
  ${cfg.currencyCol} AS currency,
  ${cfg.cpvCol} AS cpv,
  count(*) OVER() AS total_count
${cfg.from}
${where.length ? `WHERE ${where.join('\nAND ')}` : ''}
ORDER BY ${cfg.dateCol} DESC NULLS LAST, ${cfg.idCol}
${limitOffset(p, q.page, q.size)}
`;
  return { text, values: p.values };
}

// --- row mapper (pure) ---------------------------------------------------------

export interface SearchRow {
  kind: SearchQuery['type'];
  id: number;
  source_ref: string | null;
  title: string | null;
  date: string | null;
  buyer: { id: number; name: string } | null;
  company: { id: number; name: string } | null;
  value: number | null;
  currency: string | null;
  cpv: string | null;
  /** tender this row belongs to (award/contract rows; equals id for tender rows) */
  tender_id: number | null;
  tender_source_ref: string | null;
}

export function mapSearchRow(kind: SearchQuery['type'], r: Record<string, unknown>): SearchRow {
  return {
    kind,
    id: Number(r.row_id),
    source_ref: (r.source_ref as string) ?? null,
    title: (r.title as string) ?? null,
    date: dateStr(r.row_date),
    buyer: r.buyer_id != null ? { id: Number(r.buyer_id), name: String(r.buyer_name) } : null,
    company: r.company_id != null ? { id: Number(r.company_id), name: String(r.company_name) } : null,
    value: num(r.value),
    currency: (r.currency as string) ?? null,
    cpv: (r.cpv as string) ?? null,
    tender_id: r.tender_id != null ? Number(r.tender_id) : null,
    tender_source_ref: (r.tender_source_ref as string) ?? null,
  };
}

// --- handler -------------------------------------------------------------------

export function searchHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const q = searchQuerySchema.parse(req.query);
    const { text, values } = buildSearchQuery(q);
    const res = await ctx.db.query(text, values);
    const total = res.rows.length > 0 ? Number(res.rows[0].total_count) : 0;
    req.zeroResult = total === 0;
    ctx.metrics.inc('api_requests', { endpoint: 'GET /v1/search', type: q.type });
    return reply.send(
      envelope(
        req,
        res.rows.map((r) => mapSearchRow(q.type, r)),
        { page: q.page, total },
      ),
    );
  };
}

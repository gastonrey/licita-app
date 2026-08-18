// POST /v1/research — deterministic high-level EU procurement intelligence.
// NO LLM, NO external APIs: every finding comes from the local database through
// the same builders/mappers as the raw endpoints, and confidence is an
// evidence-strength heuristic over the findings themselves (see
// computeResearchConfidence). Shared by the REST handler and the MCP `research`
// tool via researchData().

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Provenance } from '../../domain/types.js';
import type { Db } from '../../db/client.js';
import {
  dateStr,
  envelope,
  num,
  tedUrl,
  validate,
  type RouteCtx,
} from './common.js';
import { buildSearchQuery, mapSearchRow } from './search.js';
import { buildRenewalsQuery, mapRenewalRow } from './renewals.js';
import { COMPANY_AGG_SQL, OPPORTUNITIES_SQL, SCORE_EXPLANATION } from './companies.js';
import { searchQuerySchema, renewalsQuerySchema } from '../validate.js';

export const researchBodySchema = z.object({
  query: z.string().trim().min(1, 'query is required').max(200, 'query must be at most 200 characters'),
  limit: z.coerce.number().int().min(1, 'limit must be ≥ 1').max(10, 'limit must be ≤ 10').default(5),
});

export type ResearchBody = z.infer<typeof researchBodySchema>;

export const researchBodyValidation = validate(researchBodySchema, 'body');

/** How recent a tender must be to count as evidence for confidence. */
export const TENDERS_WINDOW_DAYS = 90;
/** Renewal signals are looked at within this forward window (matches /v1/renewals). */
export const RENEWALS_WINDOW_DAYS = 365;

export const RESEARCH_METHODOLOGY =
  'Deterministic high-level EU procurement intelligence over the licita database: ' +
  'tenders (full-text match on title/description, published within the last 90 days), ' +
  'renewal signals (forecast_signals in a 12-month window, relevance-filtered on incumbent/buyer/contract), ' +
  'company opportunities (similarity-ranked tenders for companies whose name matches the topic), ' +
  'and active buyers (award activity for buyers whose name matches the topic). ' +
  'Confidence is an evidence-strength heuristic over distinct finding types with recent data — NOT a probability estimate.';

// --- shared shapes -------------------------------------------------------------

export interface ResearchFinding {
  type: 'tender' | 'renewal' | 'opportunity' | 'buyer';
  title: string;
  detail: string;
  source: string;
  source_ref: string;
  timestamp: string;
  evidence: string[];
}

export interface ResearchData {
  topic: string;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  findings: ResearchFinding[];
  windows: { tenders_days: number; renewals_days: number };
}

// --- pure helpers ---------------------------------------------------------------

/**
 * Evidence-strength confidence: count distinct finding types with at least one
 * finding whose timestamp falls within the last 90 days. ≥2 types → high,
 * exactly 1 → medium, else low. Deterministic and explainable; NOT a
 * probability.
 */
export function computeResearchConfidence(
  findings: ResearchFinding[],
  now: Date = new Date(),
): 'low' | 'medium' | 'high' {
  const cutoff = new Date(now.getTime() - TENDERS_WINDOW_DAYS * 86_400_000);
  const recentTypes = new Set<string>();
  for (const f of findings) {
    if (!f.timestamp) continue;
    const t = new Date(f.timestamp);
    if (Number.isNaN(t.getTime()) || t < cutoff) continue;
    recentTypes.add(f.type);
  }
  if (recentTypes.size >= 2) return 'high';
  if (recentTypes.size === 1) return 'medium';
  return 'low';
}

/** Days between `now` and the oldest observed tender timestamp, capped at the
 *  configured window. Used so the summary's "in the last N days" reflects real
 *  data, never a fabricated number. */
export function tenderWindowDays(
  timestamps: string[],
  now: Date,
  maxDays: number = TENDERS_WINDOW_DAYS,
): number {
  const times = timestamps.map((t) => new Date(t).getTime()).filter((t) => Number.isFinite(t));
  if (times.length === 0) return maxDays;
  const oldest = Math.min(...times);
  const days = Math.max(1, Math.ceil((now.getTime() - oldest) / 86_400_000));
  return Math.min(days, maxDays);
}

/** Renewal relevance filter: does the signal mention the topic in incumbent,
 *  buyer or contract title? Pure and unit-testable. */
export function renewalRelevant(row: Record<string, unknown>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const incumbent = row.incumbent as { name?: string | null } | null;
  const buyer = row.buyer as { name?: string | null } | null;
  const contract = row.contract as { title?: string | null } | null;
  const haystacks = [incumbent?.name, buyer?.name, contract?.title].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  return haystacks.some((s) => s.toLowerCase().includes(q));
}

export function buildResearchSummary(
  topic: string,
  counts: { tenders: number; renewals: number; opportunities: number; buyers: number },
  tenderDays: number,
  findings: ResearchFinding[],
): string {
  const header =
    `Recent EU procurement activity for "${topic}": ${counts.tenders} tender(s) published in the last ` +
    `${tenderDays} day(s), ${counts.renewals} renewal signal(s), ${counts.opportunities} company opportunity, ` +
    `${counts.buyers} active buyer(s).`;
  if (findings.length === 0) {
    return `${header} No recent matches were found; try a different topic.`;
  }
  const bullets = findings.slice(0, 3).map((f) => `- [${f.type}] ${f.title}`);
  return [header, ...bullets].join('\n');
}

export function provenanceFromFindings(findings: ResearchFinding[]): Provenance[] {
  const seen = new Map<string, Provenance>();
  for (const f of findings) {
    const key = `${f.source}|${f.source_ref}`;
    if (!seen.has(key)) seen.set(key, { source: f.source, source_ref: f.source_ref });
  }
  return [...seen.values()].slice(0, 10);
}

// --- data legs ------------------------------------------------------------------

/** Look up tender source codes + stored URLs for a batch of tender ids. */
async function tenderSources(
  db: Db,
  ids: number[],
): Promise<Map<number, { source_code: string; url: string | null }>> {
  if (ids.length === 0) return new Map();
  const res = await db.query(
    `SELECT t.id, s.code AS source_code, t.url
     FROM tenders t
     JOIN sources s ON s.id = t.source_id
     WHERE t.id = ANY($1::bigint[])`,
    [ids],
  );
  const m = new Map<number, { source_code: string; url: string | null }>();
  for (const r of res.rows) {
    m.set(Number(r.id), { source_code: String(r.source_code), url: (r.url as string) ?? null });
  }
  return m;
}

async function loadTenderFindings(
  db: Db,
  query: string,
  limit: number,
): Promise<ResearchFinding[]> {
  const q = searchQuerySchema.parse({ type: 'tender', q: query, page: 1, size: limit });
  const { text, values } = buildSearchQuery(q);
  const res = await db.query(text, values);
  if (res.rows.length === 0) return [];
  const rows = res.rows.map((r) => mapSearchRow('tender', r));
  const ids = rows.map((r) => r.tender_id ?? r.id);
  const srcs = await tenderSources(db, ids);
  return rows.map((r) => {
    const s = srcs.get(r.tender_id ?? r.id);
    const ref = r.source_ref ?? r.tender_source_ref ?? null;
    const url = tedUrl(ref, (s?.url ?? null) as string | null);
    return {
      type: 'tender' as const,
      title: r.title ?? `Tender ${r.id}`,
      detail:
        `Tender ${r.id}: ${r.cpv ?? 'no CPV code'}; ` +
        `${r.value != null ? `estimated value ${r.currency ?? 'EUR'} ${r.value}` : 'value not disclosed'}.`,
      source: s?.source_code ?? 'ted',
      source_ref: url ?? ref ?? String(r.id),
      timestamp: r.date ?? '',
      evidence: [`tender: ${r.title ?? r.id}`],
    };
  });
}

async function loadRenewalFindings(db: Db, query: string, limit: number): Promise<ResearchFinding[]> {
  const q = renewalsQuerySchema.parse({ page: 1, size: 20, min_confidence: 'low' });
  const { text, values } = buildRenewalsQuery(q);
  const res = await db.query(text, values);
  const rows = res.rows.map(mapRenewalRow).filter((r) => renewalRelevant(r, query));
  return rows.slice(0, limit).map((r) => {
    const basis = (r.basis as Record<string, unknown> | null) ?? {};
    const incumbent = r.incumbent as { name?: string | null } | null;
    const buyer = r.buyer as { name?: string | null } | null;
    const contract = r.contract as { title?: string | null } | null;
    const tenderRef = basis.tender_source_ref as string | undefined;
    const awardRef = basis.source_ref as string | undefined;
    const ref = tenderRef ?? awardRef;
    return {
      type: 'renewal' as const,
      title: `Renewal signal: ${contract?.title ?? incumbent?.name ?? buyer?.name ?? `signal ${r.id}`}`,
      detail:
        `${String(r.signal_type)}; renewal window ${r.window_start} to ${r.window_end}; ` +
        `incumbent ${incumbent?.name ?? 'unknown'}; buyer ${buyer?.name ?? 'unknown'}.`,
      source: 'signal',
      source_ref: ref ? (tedUrl(ref) ?? ref) : `signal-${r.id}`,
      timestamp: (String(r.computed_at ?? r.window_start ?? '')).slice(0, 10),
      evidence: [`confidence: ${r.confidence}`, `basis: ${JSON.stringify(basis)}`],
    };
  });
}

/** Companies whose normalized name contains the topic (case-insensitive). */
async function matchCompanies(
  db: Db,
  query: string,
): Promise<Array<{ id: number; name: string; country: string | null }>> {
  const res = await db.query(
    `SELECT c.id, c.name, c.country
     FROM companies c
     WHERE c.name_norm LIKE '%' || lower(unaccent($1)) || '%'
     ORDER BY c.id
     LIMIT 3`,
    [query.trim().toLowerCase()],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    country: (r.country as string) ?? null,
  }));
}

async function loadOpportunityFindings(db: Db, query: string, limit: number): Promise<ResearchFinding[]> {
  const companies = await matchCompanies(db, query);
  if (companies.length === 0) return [];
  const ctxs: Array<{
    row: Record<string, unknown>;
    company: { name: string };
    wins: number;
    total_value: number | null;
  }> = [];
  for (const c of companies) {
    const [oppRes, aggRes] = await Promise.all([
      db.query(OPPORTUNITIES_SQL, [c.id, 2, 0]),
      db.query(COMPANY_AGG_SQL, [c.id]),
    ]);
    const agg = aggRes.rows[0];
    const wins = Number(agg?.wins ?? 0);
    const totalValue = num(agg?.total_value);
    for (const r of oppRes.rows) {
      ctxs.push({ row: r, company: c, wins, total_value: totalValue });
    }
  }
  if (ctxs.length === 0) return [];
  const srcs = await tenderSources(
    db,
    ctxs.map((x) => Number(x.row.id)),
  );
  return ctxs.slice(0, limit).map((x) => {
    const r = x.row;
    const s = srcs.get(Number(r.id));
    const ref = (r.source_ref as string) ?? null;
    const url = tedUrl(ref, (r.url as string | null) ?? null);
    return {
      type: 'opportunity' as const,
      title: (r.title as string) ?? `Opportunity ${r.id}`,
      detail: `Opportunity for ${x.company.name} matching its historical CPV/buyer profile.`,
      source: s?.source_code ?? 'ted',
      source_ref: url ?? ref ?? String(r.id),
      timestamp: dateStr(r.publication_date) ?? '',
      evidence: [
        `company: ${x.company.name}`,
        `wins: ${x.wins}`,
        `total_value: ${x.total_value ?? 'unknown'}`,
        `score: ${String(r.score)} (${SCORE_EXPLANATION})`,
      ],
    };
  });
}

async function loadBuyerFindings(db: Db, query: string, limit: number): Promise<ResearchFinding[]> {
  const res = await db.query(
    `SELECT b.id, b.name, b.country, b.source_ref, s.code AS source_code,
            (SELECT count(*)::int FROM awards a JOIN tenders t2 ON t2.id = a.tender_id WHERE t2.buyer_id = b.id) AS awards_total,
            (SELECT max(a2.award_date) FROM awards a2 JOIN tenders t3 ON t3.id = a2.tender_id WHERE t3.buyer_id = b.id) AS last_award_date
     FROM buyers b
     JOIN sources s ON s.id = b.source_id
     WHERE b.name_norm LIKE '%' || lower(unaccent($1)) || '%'
     ORDER BY b.id
     LIMIT 3`,
    [query.trim().toLowerCase()],
  );
  return res.rows.slice(0, limit).map((r) => ({
    type: 'buyer' as const,
    title: `Active buyer: ${String(r.name)}`,
    detail: `${String(r.name)}${r.country ? ` (${String(r.country)})` : ''} has ${Number(r.awards_total ?? 0)} recorded award(s).`,
    source: String(r.source_code),
    source_ref: (r.source_ref as string) ?? `buyer-${Number(r.id)}`,
    timestamp: dateStr(r.last_award_date) ?? '',
    evidence: [
      `buyer: ${String(r.name)}`,
      `awards_total: ${Number(r.awards_total ?? 0)}`,
      `country: ${(r.country as string) ?? 'unknown'}`,
    ],
  }));
}

// --- orchestration ---------------------------------------------------------------

/**
 * The shared research pipeline (REST handler + MCP tool). Runs the four legs in
 * parallel, computes confidence over the FULL findings set, then caps the
 * returned array at `limit`. Counts in the summary come from real leg results.
 */
export async function researchData(
  db: Db,
  query: string,
  limit: number,
  now: Date = new Date(),
): Promise<ResearchData> {
  const topic = query.trim();
  const [tenders, renewals, opportunities, buyers] = await Promise.all([
    loadTenderFindings(db, topic, limit),
    loadRenewalFindings(db, topic, limit),
    loadOpportunityFindings(db, topic, limit),
    loadBuyerFindings(db, topic, limit),
  ]);
  const all = [...tenders, ...renewals, ...opportunities, ...buyers];
  const counts = {
    tenders: tenders.length,
    renewals: renewals.length,
    opportunities: opportunities.length,
    buyers: buyers.length,
  };
  return {
    topic,
    confidence: computeResearchConfidence(all, now),
    summary: buildResearchSummary(
      topic,
      counts,
      tenderWindowDays(tenders.map((f) => f.timestamp), now),
      all,
    ),
    findings: all.slice(0, limit),
    windows: { tenders_days: TENDERS_WINDOW_DAYS, renewals_days: RENEWALS_WINDOW_DAYS },
  };
}

// --- REST handler ----------------------------------------------------------------

export function researchHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const { query, limit } = researchBodySchema.parse(req.body);
    const now = new Date();
    const data = await researchData(ctx.db, query, limit, now);
    req.zeroResult = data.findings.length === 0;
    ctx.metrics.inc('api_requests', { endpoint: 'POST /v1/research' });
    return reply.send(
      envelope(req, data, {
        provenance: provenanceFromFindings(data.findings),
        meta: { generated_at: now.toISOString(), methodology: RESEARCH_METHODOLOGY },
      }),
    );
  };
}
// GET /v1/demo — a free, zero-cost sample of what the paid API returns (P0.4).
// Shows the single most recent tender and the single most recent renewal
// signal, each under an explicit `sample: true` marker, plus the list of
// currently priced endpoints so agents can see what costs what before paying.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENDPOINT_PRICES, type Provenance } from '../../domain/types.js';
import type { Db } from '../../db/client.js';
import { priceOverrides } from '../../pay/prices.js';
import { dateStr, envelope, num, tedUrl, type RouteCtx, validate } from './common.js';
import { z } from 'zod';

export const demoRequestSchema = z.object({ email: z.string().trim().toLowerCase().email('invalid email') });
export const demoRequestValidation = validate(demoRequestSchema, 'body');

export function channelFor(query: Record<string, unknown>, referer?: string): string {
  const source = typeof query.source === 'string' ? query.source.trim() : '';
  if (source.length > 0 && source.length <= 64) return source;
  return referer ? 'web' : 'direct';
}

export function demoRequestHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { email: string };
    const query = (req.query ?? {}) as Record<string, unknown>;
    const referer = typeof req.headers.referer === 'string' ? req.headers.referer : undefined;
    const sourceUrl = req.url.includes('?') ? req.url : referer ?? null;
    await ctx.db.query("DELETE FROM demo_requests WHERE status IN ('new', 'contacted') AND created_at < now() - interval '30 days'");
    const result = await ctx.db.query(
      `INSERT INTO demo_requests (email, channel, source_url) VALUES ($1, $2, $3)
       RETURNING id, email, channel, source_url, status, created_at`,
      [body.email, channelFor(query, referer), sourceUrl],
    );
    if (String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
      return reply.code(303).header('location', '/?demo=success').send();
    }
    return reply.code(201).send(envelope(req, result.rows[0], { meta: { price_usd: '0.00', paid: false } }));
  };
}

export const DEMO_TENDER_SQL = `
SELECT t.id, t.source_ref, t.title, t.cpv_main, t.estimated_value, t.currency,
       t.publication_date, s.code AS source_code,
       b.id AS buyer_id, b.name AS buyer_name, b.country AS buyer_country
FROM tenders t
JOIN sources s ON s.id = t.source_id
LEFT JOIN buyers b ON b.id = t.buyer_id
ORDER BY t.publication_date DESC NULLS LAST, t.id DESC
LIMIT 1
`;

export const DEMO_RENEWAL_SQL = `
SELECT fs.id, fs.signal_type, fs.cpv, fs.window_start, fs.window_end, fs.confidence, fs.basis,
       c.name AS incumbent_name,
       ct.title AS contract_title, ct.end_date AS contract_end,
       s.code AS source_code, t.source_ref AS tender_source_ref
FROM forecast_signals fs
LEFT JOIN companies c ON c.id = fs.incumbent_company_id
LEFT JOIN contracts ct ON ct.id = fs.contract_id
LEFT JOIN awards a ON a.id = ct.award_id
LEFT JOIN tenders t ON t.id = a.tender_id
LEFT JOIN sources s ON s.id = t.source_id
ORDER BY fs.computed_at DESC NULLS LAST, fs.id DESC
LIMIT 1
`;

export const DEMO_SOURCE_SQL = `
SELECT s.code AS source, COUNT(t.id)::int AS records,
       MIN(t.publication_date) AS first_published, MAX(t.publication_date) AS last_published
FROM sources s LEFT JOIN tenders t ON t.source_id = s.id
GROUP BY s.code ORDER BY s.code
`;

/** The priced (non-free) endpoints, merged with config overrides, sorted. Pure. */
export function pricedEndpoints(
  overrides: Record<string, string>,
): Array<{ endpoint: string; price_usd: string }> {
  const merged = { ...ENDPOINT_PRICES, ...overrides };
  return Object.entries(merged)
    .filter(([, price]) => price !== '0.00')
    .map(([endpoint, price_usd]) => ({ endpoint, price_usd }))
    .sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

/** The demo payload: note + priced endpoints + single samples (or null when
 *  the database is empty). No fabricated numbers — every value is a real row. */
export async function demoData(
  db: Db,
  overrides: Record<string, string>,
  placspEnabled = false,
): Promise<Record<string, unknown>> {
  const [t, r, sources] = await Promise.all([db.query(DEMO_TENDER_SQL), db.query(DEMO_RENEWAL_SQL), db.query(DEMO_SOURCE_SQL)]);
  const tender = t.rows[0];
  const renewal = r.rows[0];
  return {
    note:
      'Free sample of Licita data. Paid endpoints require a payment token per call; see GET /v1/pricing for full prices.',
    priced_endpoints: pricedEndpoints(overrides),
    tender: tender
      ? {
          sample: true,
          title: (tender.title as string) ?? null,
          buyer:
            tender.buyer_id != null
              ? { name: String(tender.buyer_name), country: (tender.buyer_country as string) ?? null }
              : null,
          cpv_main: (tender.cpv_main as string) ?? null,
          estimated_value: num(tender.estimated_value),
          currency: (tender.currency as string) ?? null,
          published_at: dateStr(tender.publication_date),
          source: String(tender.source_code),
          source_ref: (tender.source_ref as string) ?? null,
          evidence: [`Tender title: ${String(tender.title ?? 'Not reported')}`, `Publication reference: ${String(tender.source_ref ?? 'Not reported')}`],
          url: tender.source_code === 'ted' ? tedUrl((tender.source_ref as string) ?? null) : undefined,
        }
      : null,
    renewal: renewal
      ? {
          sample: true,
          signal_type: String(renewal.signal_type),
          incumbent: (renewal.incumbent_name as string) ?? null,
          contract: {
            title: (renewal.contract_title as string) ?? null,
            end_date: dateStr(renewal.contract_end),
          },
          confidence: (renewal.confidence as string) ?? null,
          basis: renewal.basis ?? null,
          source: String(renewal.source_code ?? 'signal'),
          source_ref: (renewal.tender_source_ref as string) ?? null,
          evidence: [`Signal type: ${String(renewal.signal_type ?? 'Not reported')}`, `Confidence basis: ${String(renewal.confidence ?? 'Not reported')}`],
          url: renewal.source_code === 'ted' ? tedUrl((renewal.tender_source_ref as string) ?? null) : undefined,
        }
      : null,
    source_metadata: sources.rows.map((row) => ({
      source: String(row.source), enabled: row.source === 'placsp' ? placspEnabled : row.source === 'ted',
      records: row.source === 'placsp' && !placspEnabled ? null : Number(row.records),
      indexed_from: row.source === 'placsp' && !placspEnabled ? null : dateStr(row.first_published),
      indexed_to: row.source === 'placsp' && !placspEnabled ? null : dateStr(row.last_published),
      last_ingestion: null,
    })),
  };
}

export function demoHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const data = await demoData(ctx.db, priceOverrides(ctx.config), ctx.config.placsp.enabled);
    const provenance: Provenance[] = [];
    const t = data.tender as { source?: string; source_ref?: string | null } | null;
    const r = data.renewal as { source?: string; source_ref?: string | null } | null;
    if (t?.source && t.source_ref) provenance.push({ source: t.source, source_ref: t.source_ref });
    if (r?.source && r.source_ref) provenance.push({ source: r.source, source_ref: r.source_ref });
    return reply.send(
      envelope(req, data, {
        provenance,
        meta: { generated_at: new Date().toISOString() },
      }),
    );
  };
}

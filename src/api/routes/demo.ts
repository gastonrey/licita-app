// GET /v1/demo — a free, zero-cost sample of what the paid API returns (P0.4).
// Shows the single most recent tender and the single most recent renewal
// signal, each under an explicit `sample: true` marker, plus the list of
// currently priced endpoints so agents can see what costs what before paying.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENDPOINT_PRICES, type Provenance } from '../../domain/types.js';
import type { Db } from '../../db/client.js';
import { priceOverrides } from '../../pay/prices.js';
import { dateStr, envelope, num, type RouteCtx } from './common.js';

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
): Promise<Record<string, unknown>> {
  const [t, r] = await Promise.all([db.query(DEMO_TENDER_SQL), db.query(DEMO_RENEWAL_SQL)]);
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
        }
      : null,
  };
}

export function demoHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const data = await demoData(ctx.db, priceOverrides(ctx.config));
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
import { describe, expect, it } from 'vitest';
import { buildSearchQuery, mapSearchRow } from '../../src/api/routes/search.js';
import {
  CONFIDENCE_SCALE,
  RENEWALS_METHODOLOGY,
  buildRenewalsQuery,
  mapRenewalRow,
  renewalsHandler,
} from '../../src/api/routes/renewals.js';
import { searchQuerySchema, renewalsQuerySchema } from '../../src/api/validate.js';

describe('buildSearchQuery', () => {
  it('defaults to awards with spanish FTS and pagination', () => {
    const q = searchQuerySchema.parse({ q: 'software', size: '10', page: '2' });
    const { text, values } = buildSearchQuery(q);
    expect(text).toContain('FROM awards a');
    expect(text).toContain("plainto_tsquery('spanish', $1)");
    expect(text).toContain('LIMIT $2 OFFSET $3');
    expect(values).toEqual(['software', 10, 10]);
    expect(text).toContain('count(*) OVER()');
  });

  it('applies cpv prefix, buyer/company fragments, region prefix and date range', () => {
    const q = searchQuerySchema.parse({
      cpv: '72',
      buyer: 'Junta',
      company: 'Indra',
      region: 'es61',
      from: '2025-01-01',
      to: '2025-12-31',
    });
    const { text, values } = buildSearchQuery(q);
    expect(text).toContain('t.cpv_main LIKE $1');
    expect(text).toContain("b.name_norm LIKE '%' || lower(unaccent($2)) || '%'");
    expect(text).toContain("c.name_norm LIKE '%' || lower(unaccent($3)) || '%'");
    expect(text).toContain('t.nuts LIKE $4');
    expect(text).toContain('a.award_date >= $5::date');
    expect(text).toContain('a.award_date <= $6::date');
    expect(values.slice(0, 6)).toEqual(['72%', 'junta', 'indra', 'ES61%', '2025-01-01', '2025-12-31']);
  });

  it('tender type searches tenders with EXISTS subquery for company', () => {
    const q = searchQuerySchema.parse({ type: 'tender', company: 'Telefonica' });
    const { text, values } = buildSearchQuery(q);
    expect(text).toContain('FROM tenders t');
    expect(text).toContain('EXISTS (SELECT 1 FROM awards ax JOIN companies cx');
    expect(text).toContain('t.estimated_value AS value');
    expect(values[0]).toBe('telefonica');
  });

  it('contract type joins through awards to tenders', () => {
    const q = searchQuerySchema.parse({ type: 'contract', q: 'cloud' });
    const { text } = buildSearchQuery(q);
    expect(text).toContain('FROM contracts ct');
    expect(text).toContain('JOIN awards a ON a.id = ct.award_id');
    expect(text).toContain('ct.cpv AS cpv');
    expect(text).toContain('ct.start_date AS row_date');
  });

  it('mapSearchRow maps compact rows with nullable company and tender link', () => {
    const row = mapSearchRow('award', {
      row_id: '7',
      source_ref: '123-2026',
      tender_id: '3',
      tender_source_ref: '9000-2025',
      title: 'Soporte',
      row_date: new Date('2026-01-15T00:00:00Z'),
      buyer_id: '3',
      buyer_name: 'Ayuntamiento',
      company_id: null,
      company_name: null,
      value: '1000.50',
      currency: 'EUR',
      cpv: '72000000',
    });
    expect(row).toEqual({
      kind: 'award',
      id: 7,
      source_ref: '123-2026',
      tender_id: 3,
      tender_source_ref: '9000-2025',
      title: 'Soporte',
      date: '2026-01-15',
      buyer: { id: 3, name: 'Ayuntamiento' },
      company: null,
      value: 1000.5,
      currency: 'EUR',
      cpv: '72000000',
    });
  });

  it('award search rows expose the linked tender id and publication ref', () => {
    const q = searchQuerySchema.parse({ type: 'award', q: 'cyber' });
    const { text } = buildSearchQuery(q);
    expect(text).toContain('t.id AS tender_id');
    expect(text).toContain('t.source_ref AS tender_source_ref');
  });
});

describe('buildRenewalsQuery', () => {
  it('applies window, cpv prefix, buyer and min_confidence filters', () => {
    const q = renewalsQuerySchema.parse({ cpv: '72', buyer: 'Madrid', window_months: '24', min_confidence: 'high' });
    const { text, values } = buildRenewalsQuery(q);
    expect(text).toContain('FROM forecast_signals fs');
    expect(text).toContain('make_interval(months => $1)');
    expect(text).toContain('fs.cpv LIKE $2');
    expect(text).toContain("b.name_norm LIKE '%' || lower(unaccent($3)) || '%'");
    expect(text).toContain("CASE fs.confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END >= $4");
    expect(values).toEqual([24, '72%', 'madrid', 3, 20, 0]);
  });

  it('defaults: 12 months, low confidence, no cpv/buyer filters', () => {
    const q = renewalsQuerySchema.parse({});
    const { text, values } = buildRenewalsQuery(q);
    expect(values[0]).toBe(12);
    expect(values[1]).toBe(1);
    expect(text).not.toContain('fs.cpv LIKE');
    expect(text).not.toContain('b.name_norm');
  });

  it('mapRenewalRow joins buyer/incumbent/contract', () => {
    const r = mapRenewalRow({
      id: 1,
      signal_type: 'framework_expiry',
      cpv: '72000000',
      window_start: '2026-06-01',
      window_end: '2026-08-30',
      confidence: 'high',
      basis: { awards: 3 },
      computed_at: '2026-01-01T00:00:00Z',
      buyer_id: 5,
      buyer_name: 'Xunta',
      incumbent_id: 9,
      incumbent_name: 'ACME',
      contract_id: 2,
      contract_title: 'Soporte',
      contract_value: '5000',
      contract_currency: 'EUR',
      contract_start: '2024-06-01',
      contract_end: '2026-06-01',
    });
    expect(r).toMatchObject({
      id: 1,
      signal_type: 'framework_expiry',
      buyer: { id: 5, name: 'Xunta' },
      incumbent: { id: 9, name: 'ACME' },
      contract: { id: 2, value: 5000, currency: 'EUR', end_date: '2026-06-01' },
    });
  });

  it('honesty framing: methodology is a heuristic (no probability claims) and the confidence scale is fixed', () => {
    expect(CONFIDENCE_SCALE).toEqual(['low', 'medium', 'high']);
    expect(RENEWALS_METHODOLOGY).toContain('NOT a calibrated probability');
    expect(RENEWALS_METHODOLOGY.toLowerCase()).not.toContain('probability that');
  });

  it('GET /v1/renewals response meta exposes methodology and confidence_scale', async () => {
    const db = {
      query: async () => ({
        rows: [
          {
            id: 1,
            signal_type: 'recurrence',
            cpv: '72',
            window_start: '2026-01-01',
            window_end: '2026-03-01',
            confidence: 'high',
            basis: { evidence_count: 3 },
            computed_at: '2026-01-01T00:00:00Z',
            buyer_id: null,
            buyer_name: null,
            incumbent_id: null,
            incumbent_name: null,
            contract_id: null,
            contract_title: null,
            contract_value: null,
            contract_currency: null,
            contract_start: null,
            contract_end: null,
            total_count: 1,
          },
        ],
      }),
    };
    const reply = { send: (body: unknown) => body };
    const body = (await renewalsHandler({ db } as never)(
      { id: 'req-1', query: {}, payment: { paid: false, priceUsd: '0.25' } } as never,
      reply as never,
    )) as { data: unknown[]; meta: Record<string, unknown> };
    expect(body.data).toHaveLength(1);
    expect(body.meta.methodology).toBe(RENEWALS_METHODOLOGY);
    expect(body.meta.confidence_scale).toEqual(['low', 'medium', 'high']);
    expect((body.data[0] as Record<string, unknown>).basis).toEqual({ evidence_count: 3 });
  });
});

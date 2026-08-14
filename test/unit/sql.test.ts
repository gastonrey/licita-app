import { describe, expect, it } from 'vitest';
import { buildSearchQuery, mapSearchRow } from '../../src/api/routes/search.js';
import { buildRenewalsQuery, mapRenewalRow } from '../../src/api/routes/renewals.js';
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

  it('mapSearchRow maps compact rows with nullable company', () => {
    const row = mapSearchRow('award', {
      row_id: '7',
      source_ref: '123-2026',
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
      title: 'Soporte',
      date: '2026-01-15',
      buyer: { id: 3, name: 'Ayuntamiento' },
      company: null,
      value: 1000.5,
      currency: 'EUR',
      cpv: '72000000',
    });
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
});

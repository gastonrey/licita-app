import { describe, expect, it } from 'vitest';
import {
  dateStr,
  envelope,
  errorEnvelope,
  HttpError,
  num,
  Params,
  provenanceFor,
  tedUrl,
} from '../../src/api/routes/common.js';
import { computeConcentration, computeRecurrence } from '../../src/api/routes/buyers.js';
import { buildPricing } from '../../src/api/routes/pricing.js';
import { ENDPOINT_PRICES } from '../../src/domain/types.js';
import type { FastifyRequest } from 'fastify';

function fakeReq(payment?: { paid: boolean; priceUsd: string; clientKey?: string }): FastifyRequest {
  return { id: 'req-uuid-1', payment } as unknown as FastifyRequest;
}

describe('envelope builder', () => {
  it('builds the SPEC §5 envelope', () => {
    const env = envelope(fakeReq({ paid: true, priceUsd: '0.05' }), { hello: 'world' }, {
      provenance: [{ source: 'ted', source_ref: '1-2026' }],
      page: 2,
      total: 42,
    });
    expect(env.data).toEqual({ hello: 'world' });
    expect(env.meta).toEqual({
      request_id: 'req-uuid-1',
      price_usd: '0.05',
      paid: true,
      provenance: [{ source: 'ted', source_ref: '1-2026' }],
      page: 2,
      total: 42,
    });
  });

  it('defaults to free/unpaid without payment, supports extra meta', () => {
    const env = envelope(fakeReq(), [], { meta: { caveats: ['c'] } });
    expect(env.meta.price_usd).toBe('0.00');
    expect(env.meta.paid).toBe(false);
    expect(env.meta.provenance).toEqual([]);
    expect((env.meta as Record<string, unknown>).caveats).toEqual(['c']);
    expect('page' in env.meta).toBe(false);
  });
});

describe('error envelope', () => {
  it('matches SPEC §5 error shape', () => {
    expect(errorEnvelope('rate_limited', 'slow down', 'retry later')).toEqual({
      error: { code: 'rate_limited', message: 'slow down', hint: 'retry later' },
    });
    expect(errorEnvelope('internal', 'boom')).toEqual({ error: { code: 'internal', message: 'boom' } });
  });
  it('HttpError carries status/code/hint', () => {
    const e = new HttpError(404, 'not_found', 'nope', 'hint');
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe('not_found');
  });
});

describe('helpers', () => {
  it('num normalizes pg numerics', () => {
    expect(num('123.45')).toBe(123.45);
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num('not-a-number')).toBeNull();
  });
  it('dateStr normalizes dates', () => {
    expect(dateStr(new Date('2026-03-05T12:00:00Z'))).toBe('2026-03-05');
    expect(dateStr('2026-03-05')).toBe('2026-03-05');
    expect(dateStr(null)).toBeNull();
  });
  it('tedUrl prefers stored url, falls back to canonical pattern', () => {
    expect(tedUrl('123-2026', 'https://stored.example/x')).toBe('https://stored.example/x');
    expect(tedUrl('123-2026')).toBe('https://ted.europa.eu/udl?uri=TED:NOTICE:123-2026:TEXT:EN:HTML');
    expect(tedUrl(null)).toBeUndefined();
  });
  it('provenanceFor builds provenance list', () => {
    expect(provenanceFor('ted', '1-2026', 'http://x')).toEqual([
      { source: 'ted', source_ref: '1-2026', url: 'http://x' },
    ]);
    expect(provenanceFor('ted', null)).toEqual([]);
  });
  it('Params numbers placeholders sequentially', () => {
    const p = new Params();
    expect(p.push('a')).toBe('$1');
    expect(p.push(2)).toBe('$2');
    expect(p.values).toEqual(['a', 2]);
  });
});

describe('computeConcentration', () => {
  it('computes top-3 shares by count and value', () => {
    const c = computeConcentration([
      { id: 1, name: 'A', wins: 5, total_value: 500 },
      { id: 2, name: 'B', wins: 3, total_value: 300 },
      { id: 3, name: 'C', wins: 1, total_value: 100 },
      { id: 4, name: 'D', wins: 1, total_value: 100 },
    ]);
    expect(c.distinct_suppliers).toBe(4);
    expect(c.top3_share_by_count).toBeCloseTo(0.9);
    expect(c.top3_share_by_value).toBeCloseTo(0.9);
    expect(c.suppliers).toHaveLength(4);
  });
  it('handles null values and empty input', () => {
    const c = computeConcentration([{ id: 1, name: 'A', wins: 2, total_value: null }]);
    expect(c.top3_share_by_value).toBeNull();
    expect(c.top3_share_by_count).toBe(1);
    expect(computeConcentration([]).top3_share_by_count).toBeNull();
  });
});

describe('computeRecurrence', () => {
  it('computes median months between awards per CPV division', () => {
    const r = computeRecurrence([
      { division: '72', award_date: '2024-01-01' },
      { division: '72', award_date: '2024-07-01' },
      { division: '72', award_date: '2025-01-01' },
      { division: '48', award_date: '2024-01-01' },
    ]);
    const div72 = r.find((x) => x.cpv_division === '72');
    expect(div72?.awards).toBe(3);
    expect(div72?.median_months_between_awards).toBeCloseTo(6, 0);
    const div48 = r.find((x) => x.cpv_division === '48');
    expect(div48?.median_months_between_awards).toBeNull();
  });
});

describe('buildPricing', () => {
  it('mirrors ENDPOINT_PRICES exactly', () => {
    const p = buildPricing('dev');
    expect(p.currency).toBe('USD');
    expect(p.endpoints).toHaveLength(Object.keys(ENDPOINT_PRICES).length);
    for (const e of p.endpoints) {
      expect(e.price_usd).toBe(ENDPOINT_PRICES[e.endpoint]);
      expect(e.free).toBe(e.price_usd === '0.00');
    }
    expect(p.payment_flow.protocol).toBe('x402');
    expect(p.payment_flow.version).toBe(2);
    expect(p.payment_flow.required_header).toBe('PAYMENT-REQUIRED');
    expect(p.payment_flow.signature_header).toBe('PAYMENT-SIGNATURE');
    expect(p.payment_flow.steps.join(' ')).toContain('PAYMENT-REQUIRED');
    expect(p.payment_flow.steps.join(' ')).toContain('PAYMENT-SIGNATURE');
    expect(p.payment_flow.header).toBe('X-PAYMENT');
    expect(p.payment_flow.faucet).toContain('/v1/dev-faucet');
  });
});

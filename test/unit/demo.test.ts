// GET /v1/demo — free sample: pricedEndpoints merge, demoData shape over a
// canned fake db, and the REST flow through buildServer (always free).

import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client.js';
import { ENDPOINT_PRICES } from '../../src/domain/types.js';
import { demoData, demoHandler, pricedEndpoints } from '../../src/api/routes/demo.js';
import { makeTestConfig } from './testconfig.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { buildServer } from '../../src/api/server.js';

const TENDER_SAMPLE = {
  id: 1,
  source_ref: '111-2026',
  title: 'Suministro de software',
  cpv_main: '72000000',
  estimated_value: '50000',
  currency: 'EUR',
  publication_date: '2026-08-01',
  source_code: 'ted',
  buyer_id: 1,
  buyer_name: 'Junta de Test',
  buyer_country: 'ES',
};

const RENEWAL_SAMPLE = {
  id: 5,
  signal_type: 'contractSignal',
  cpv: '72000000',
  window_start: '2026-11-01',
  window_end: '2027-05-01',
  confidence: 'medium',
  basis: { source_ref: '222-2026', tender_source_ref: '222-2026' },
  incumbent_name: 'ACME S.A.',
  contract_title: 'Mantenimiento software',
  contract_end: '2027-01-01',
  source_code: 'ted',
  tender_source_ref: '222-2026',
};

function makeDemoDb(): Db {
  return {
    query: async (text: string) => {
      const t = text.replace(/\s+/g, ' ');
      if (t.includes('FROM forecast_signals fs')) return { rows: [RENEWAL_SAMPLE] };
      return { rows: [TENDER_SAMPLE] };
    },
  } as unknown as Db;
}

describe('pricedEndpoints', () => {
  it('merges overrides, drops free endpoints and sorts', () => {
    const list = pricedEndpoints({ 'POST /v1/research': '0.50' });
    expect(list).toEqual(
      Object.entries({ ...ENDPOINT_PRICES, 'POST /v1/research': '0.50' })
        .filter(([, p]) => p !== '0.00')
        .map(([endpoint, price_usd]) => ({ endpoint, price_usd }))
        .sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
    );
    const keys = list.map((e) => e.endpoint);
    expect(keys).toContain('POST /v1/research');
    expect(keys).not.toContain('GET /v1/demo');
    expect(keys).not.toContain('GET /v1/pricing');
    expect(list.find((e) => e.endpoint === 'POST /v1/research')?.price_usd).toBe('0.50');
  });
});

describe('demoData', () => {
  it('returns the free sample shape with sample markers and provenance fields', async () => {
    const data = await demoData(makeDemoDb(), { 'POST /v1/research': '0.50' });
    const tender = data.tender as Record<string, unknown>;
    const renewal = data.renewal as Record<string, unknown>;
    expect(tender.sample).toBe(true);
    expect(tender.title).toBe('Suministro de software');
    expect(tender.buyer).toEqual({ name: 'Junta de Test', country: 'ES' });
    expect(tender.evidence).toEqual(['Tender title: Suministro de software', 'Publication reference: 111-2026']);
    expect(tender.url).toContain('ted.europa.eu');
    expect(renewal.sample).toBe(true);
    expect(renewal.signal_type).toBe('contractSignal');
    expect(renewal.incumbent).toBe('ACME S.A.');
    expect(renewal.source_ref).toBe('222-2026');
    expect(data.note).toContain('Free sample');
    expect(data.source_metadata).toBeInstanceOf(Array);
    expect((data.priced_endpoints as unknown[]).length).toBeGreaterThan(0);
  });

  it('returns nulls when the database is empty', async () => {
    const empty = { query: async () => ({ rows: [] }) } as unknown as Db;
    const data = await demoData(empty, { 'POST /v1/research': '0.50' });
    expect(data.tender).toBeNull();
    expect(data.renewal).toBeNull();
  });
});

describe('GET /v1/demo REST', () => {
  it('is free (no payment header) and returns a paid envelope at $0.00', async () => {
    resetPayments();
    const config = makeTestConfig();
    const app = await buildServer(config, makeDemoDb());
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/demo' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.meta).toMatchObject({ price_usd: '0.00', paid: true });
      expect(body.data.tender.sample).toBe(true);
      expect(body.meta.provenance).toHaveLength(2);
    } finally {
      await app.close();
      resetPayments();
    }
  });

  it('is registered as a free endpoint in ENDPOINT_PRICES', () => {
    expect(ENDPOINT_PRICES['GET /v1/demo']).toBe('0.00');
  });
});

// demoHandler is exercised via buildServer above; keep a direct sanity test of
// the handler factory signature for route wiring.
it('demoHandler returns a callable route factory', () => {
  expect(typeof demoHandler({} as never)).toBe('function');
});

// POST /v1/research: pure confidence/summary/relevance helpers + researchData
// orchestration over a canned fake db + the REST flow through buildServer
// (payment 402 → dev token → paid envelope at the config-driven price).

import { describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import {
  RENEWALS_WINDOW_DAYS,
  TENDERS_WINDOW_DAYS,
  buildResearchSummary,
  computeResearchConfidence,
  provenanceFromFindings,
  renewalRelevant,
  researchData,
  researchBodySchema,
  tenderWindowDays,
  type ResearchFinding,
} from '../../src/api/routes/research.js';
import { buildServer } from '../../src/api/server.js';
import { DevPaymentProvider } from '../../src/pay/devProvider.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { makeTestConfig } from './testconfig.js';

const SECRET = 'research-test-secret';
const DAY = 86_400_000;
const daysAgo = (n: number): string =>
  new Date(Date.now() - n * DAY).toISOString().slice(0, 10);

const finding = (type: ResearchFinding['type'], timestamp: string, source = 'ted'): ResearchFinding => ({
  type,
  title: `${type} title`,
  detail: 'detail',
  source,
  source_ref: `${type}-1`,
  timestamp,
  evidence: ['x'],
});

// --- pure helpers -----------------------------------------------------------------

describe('computeResearchConfidence', () => {
  const now = new Date('2026-08-18T00:00:00Z');
  it('high when ≥2 finding types are recent (within 90 days)', () => {
    const f = [
      finding('tender', '2026-08-01'),
      finding('renewal', '2026-07-01'),
    ];
    expect(computeResearchConfidence(f, now)).toBe('high');
  });
  it('medium when exactly 1 finding type is recent', () => {
    const f = [
      finding('tender', '2026-08-01'),
      finding('buyer', '2025-01-01'),
      finding('buyer', '2025-01-02', 'ted'),
    ];
    expect(computeResearchConfidence(f, now)).toBe('medium');
  });
  it('low when nothing is recent or there are no findings', () => {
    expect(computeResearchConfidence([], now)).toBe('low');
    expect(computeResearchConfidence([finding('tender', '2025-01-01')], now)).toBe('low');
    expect(computeResearchConfidence([finding('tender', 'not-a-date')], now)).toBe('low');
  });
});

describe('tenderWindowDays', () => {
  const now = new Date('2026-08-18T00:00:00Z');
  it('defaults to the configured window when there is no data', () => {
    expect(tenderWindowDays([], now)).toBe(TENDERS_WINDOW_DAYS);
  });
  it('returns the observed span, capped at the window', () => {
    expect(tenderWindowDays(['2026-08-17', '2026-08-01'], now)).toBe(17);
    expect(tenderWindowDays(['2024-01-01'], now)).toBe(TENDERS_WINDOW_DAYS);
  });
});

describe('renewalRelevant', () => {
  const row = {
    incumbent: { name: 'ACME S.A.' },
    buyer: { name: 'Ministerio de Salud' },
    contract: { title: 'Mantenimiento de software' },
  };
  it('matches on incumbent, buyer or contract title', () => {
    expect(renewalRelevant(row, 'acme')).toBe(true);
    expect(renewalRelevant(row, 'salud')).toBe(true);
    expect(renewalRelevant(row, 'software')).toBe(true);
    expect(renewalRelevant(row, 'energia')).toBe(false);
  });
});

describe('buildResearchSummary', () => {
  it('is honest and complete for zero results', () => {
    const s = buildResearchSummary('nada', { tenders: 0, renewals: 0, opportunities: 0, buyers: 0 }, 90, []);
    expect(s).toContain('0 tender(s) published in the last 90 day(s)');
    expect(s).toContain('0 renewal signal(s)');
    expect(s).toContain('No recent matches');
  });
  it('derives counts and bullet lines from real findings', () => {
    const s = buildResearchSummary(
      'software',
      { tenders: 1, renewals: 1, opportunities: 0, buyers: 1 },
      12,
      [finding('tender', '2026-08-01'), finding('renewal', '2026-08-01')],
    );
    expect(s).toContain('Recent EU procurement activity for "software"');
    expect(s).toContain('1 tender(s) published in the last 12 day(s)');
    expect(s).toContain('- [tender] tender title');
    expect(s).toContain('- [renewal] renewal title');
  });
});

describe('provenanceFromFindings', () => {
  it('dedupes by source|source_ref and keeps distinct refs', () => {
    const a: ResearchFinding = {
      type: 'tender',
      title: 'x',
      detail: 'd',
      source: 'ted',
      source_ref: 'same',
      timestamp: '2026-08-01',
      evidence: [],
    };
    const b: ResearchFinding = { ...a, type: 'renewal' };
    const c: ResearchFinding = { ...a, source_ref: 'other' };
    expect(provenanceFromFindings([a, b, c])).toEqual([
      { source: 'ted', source_ref: 'same' },
      { source: 'ted', source_ref: 'other' },
    ]);
  });
});

describe('researchBodySchema', () => {
  it('trims query, coerces + bounds limit, defaults to 5', () => {
    expect(researchBodySchema.parse({ query: '  cyber  ' })).toEqual({ query: 'cyber', limit: 5 });
    expect(researchBodySchema.parse({ query: 'x', limit: '3' })).toEqual({ query: 'x', limit: 3 });
    expect(() => researchBodySchema.parse({})).toThrow();
    expect(() => researchBodySchema.parse({ query: '', limit: 11 })).toThrow();
  });
});

// --- researchData orchestration ----------------------------------------------------

const TENDER_ROW = {
  row_id: 1,
  source_ref: '111-2026',
  tender_id: 1,
  tender_source_ref: '111-2026',
  title: 'Suministro de software',
  row_date: daysAgo(5),
  buyer_id: 1,
  buyer_name: 'Junta de Test',
  company_id: null,
  company_name: null,
  value: '50000',
  currency: 'EUR',
  cpv: '72000000',
  total_count: 1,
};

const RENEWAL_ROW = {
  id: 5,
  signal_type: 'contractSignal',
  cpv: '72000000',
  window_start: daysAgo(0),
  window_end: '2027-05-01',
  confidence: 'medium',
  basis: { source_ref: '222-2026', tender_source_ref: '222-2026' },
  computed_at: new Date(Date.now() - DAY).toISOString(),
  buyer_id: 2,
  buyer_name: 'Ministerio X',
  incumbent_id: 3,
  incumbent_name: 'ACME S.A.',
  contract_id: 9,
  contract_title: 'Mantenimiento software ACME',
  contract_value: '100000',
  contract_currency: 'EUR',
  contract_start: '2024-01-01',
  contract_end: '2027-01-01',
  total_count: 1,
};

const COMPANY_ROW = { id: 3, name: 'ACME S.A.', country: 'ESP' };

const OPPORTUNITY_ROW = {
  id: 4,
  source_ref: '333-2026',
  title: 'Ciberseguridad ACME',
  publication_date: daysAgo(10),
  deadline: null,
  cpv_main: '72000000',
  estimated_value: '20000',
  currency: 'EUR',
  nuts: 'ES61',
  url: null,
  buyer_id: 1,
  buyer_name: 'Junta de Test',
  score: 2,
  same_buyer: true,
  same_cpv: true,
  total_count: 1,
};

const BUYER_ROW = {
  id: 1,
  name: 'Junta de Test',
  country: 'ES',
  source_ref: 'buyer-1',
  source_code: 'ted',
  awards_total: 3,
  last_award_date: daysAgo(3),
};

/**
 * Canned fake db for research: pg-mem only for the payments replay table;
 * data legs return the rows above keyed on their distinct SQL markers.
 */
async function makeResearchDb(): Promise<Db> {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const payments = new Pool() as unknown as Db;
  await payments.query(PAYMENTS_DDL);
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      const t = text.replace(/\s+/g, ' ');
      if (t.includes('INSERT INTO payments')) return payments.query(text, values);
      if (t.includes('FROM tenders t JOIN sources s')) return { rows: [{ id: 1, source_code: 'ted', url: null }] };
      if (t.includes('plainto_tsquery')) return { rows: [TENDER_ROW] };
      if (t.includes('FROM forecast_signals fs')) return { rows: [RENEWAL_ROW] };
      if (t.includes('c.name_norm LIKE')) return { rows: [COMPANY_ROW] };
      if (t.includes('WITH hist AS')) return { rows: [OPPORTUNITY_ROW] };
      if (t.includes('FROM awards a WHERE a.winner_company_id')) return { rows: [{ wins: 1, total_value: '1000' }] };
      if (t.includes('FROM buyers b JOIN sources s')) return { rows: [BUYER_ROW] };
      return { rows: [] };
    },
  } as unknown as Db;
  return db;
}

const PAYMENTS_DDL = `
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint,
  endpoint text NOT NULL, amount_usd numeric NOT NULL,
  provider text NOT NULL, proof text UNIQUE NOT NULL, status text NOT NULL
);
`;

describe('researchData', () => {
  it('runs all four legs and caps findings at limit', async () => {
    const db = await makeResearchDb();
    const data = await researchData(db, 'software', 5);
    expect(data.topic).toBe('software');
    expect(data.findings).toHaveLength(4);
    expect(data.findings.map((f) => f.type).sort()).toEqual(['buyer', 'opportunity', 'renewal', 'tender']);
    expect(data.confidence).toBe('high');
    expect(data.windows).toEqual({ tenders_days: TENDERS_WINDOW_DAYS, renewals_days: RENEWALS_WINDOW_DAYS });
    expect(data.summary).toContain('1 tender(s)');
    expect(data.summary).toContain('1 renewal signal(s)');
  });

  it('caps findings at a small limit but keeps full counts in the summary', async () => {
    const db = await makeResearchDb();
    const data = await researchData(db, 'software', 2);
    expect(data.findings).toHaveLength(2);
    expect(data.summary).toContain('1 tender(s)');
    expect(data.summary).toContain('1 renewal signal(s)');
  });

  it('returning zero results → low confidence + honest summary', async () => {
    const db = {
      query: async () => ({ rows: [] }),
    } as unknown as Db;
    const data = await researchData(db, 'nada', 5);
    expect(data.findings).toEqual([]);
    expect(data.confidence).toBe('low');
    expect(data.summary).toContain('No recent matches');
  });

  it('renewal findings carry evidence from confidence + basis', async () => {
    const db = await makeResearchDb();
    const data = await researchData(db, 'software', 5);
    const renewal = data.findings.find((f) => f.type === 'renewal');
    expect(renewal).toBeDefined();
    expect(renewal!.evidence).toContain('confidence: medium');
    expect(renewal!.evidence.some((e) => e.startsWith('basis:'))).toBe(true);
    expect(renewal!.source_ref).toContain('https://ted.europa.eu');
  });
});

// --- REST flow ----------------------------------------------------------------------

describe('POST /v1/research REST', () => {
  it('requires payment and serves a paid envelope at the config price', async () => {
    resetPayments();
    const config = makeTestConfig({ payHmacSecret: SECRET, researchPriceUsd: '0.50' });
    const db = await makeResearchDb();
    const app = await buildServer(config, db);

    try {
      // 1. no payment → 402 with the config-driven price
      const unpaid = await app.inject({
        method: 'POST',
        url: '/v1/research',
        payload: { query: 'software' },
      });
      expect(unpaid.statusCode).toBe(402);
      expect(unpaid.json().accepts[0].amount).toBe('0.50');
      expect(unpaid.json().error.message).toContain('$0.50');

      // 2. valid dev token → paid envelope with meta
      const provider = new DevPaymentProvider({
        secret: SECRET,
        db,
        prices: { 'POST /v1/research': '0.50' },
      });
      const { token } = provider.createToken('POST /v1/research');
      const paid = await app.inject({
        method: 'POST',
        url: '/v1/research',
        headers: { 'x-payment': token },
        payload: { query: 'software', limit: 2 },
      });
      expect(paid.statusCode).toBe(200);
      const body = paid.json();
      expect(body.meta).toMatchObject({ price_usd: '0.50', paid: true });
      expect(body.meta.generated_at).toBeDefined();
      expect(body.meta.methodology).toContain('NOT a probability');
      expect(body.data.topic).toBe('software');
      expect(body.data.confidence).toBe('high');
      expect(body.data.findings).toHaveLength(2);
      expect(body.meta.provenance.length).toBeGreaterThan(0);
    } finally {
      await app.close();
      resetPayments();
    }
  });

  it('rejects an invalid body with the standard 400 envelope', async () => {
    resetPayments();
    const config = makeTestConfig({ payHmacSecret: SECRET, researchPriceUsd: '0.50' });
    const db = await makeResearchDb();
    const app = await buildServer(config, db);
    try {
      const provider = new DevPaymentProvider({ secret: SECRET, db, prices: { 'POST /v1/research': '0.50' } });
      const { token } = provider.createToken('POST /v1/research');
      const res = await app.inject({
        method: 'POST',
        url: '/v1/research',
        headers: { 'x-payment': token },
        payload: { query: '' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: 'invalid_query' });
    } finally {
      await app.close();
      resetPayments();
    }
  });
});
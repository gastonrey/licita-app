// Server wiring smoke test (no real DB; payment middleware stubbed via alias config).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import type { AppConfig } from '../../src/config.js';
import type { Db } from '../../src/db/client.js';
import { makeTestConfig } from '../unit/testconfig.js';

const config: AppConfig = makeTestConfig({ payHmacSecret: 'test', operatorKey: 'operator-secret' });

interface QueryCall {
  text: string;
  values: unknown[];
}

function fakeDb(): { db: Db; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      const t = text.replace(/\s+/g, ' ');
      if (t.includes('INSERT INTO request_logs')) return { rows: [] };
      if (t.includes('FROM tenders t JOIN sources s')) {
        return {
          rows: [
            {
              id: 1,
              source_ref: '123-2026',
              source_code: 'ted',
              notice_type: 'can-standard',
              publication_date: '2026-01-10',
              title: 'Servicio de ciberseguridad',
              description: null,
              cpv_main: '72000000',
              cpv_all: ['72000000'],
              procedure_type: 'open',
              deadline: null,
              estimated_value: '100000',
              currency: 'EUR',
              nuts: 'ES61',
              url: null,
              b_id: 5,
              b_name: 'Ayuntamiento de X',
              b_country: 'ESP',
              b_nuts: 'ES61',
              b_org_type: null,
            },
          ],
        };
      }
      if (t.includes('FROM awards a LEFT JOIN companies c ON c.id = a.winner_company_id WHERE a.tender_id')) {
        return { rows: [] };
      }
      if (t.includes('FROM companies c JOIN sources s')) {
        return {
          rows: [
            {
              id: 7,
              source_ref: 'acme s.a.|ESP',
              source_code: 'ted',
              name: 'ACME S.A.',
              country: 'ESP',
              nif: 'A12345674',
            },
          ],
        };
      }
      if (t.includes('FROM awards a WHERE a.winner_company_id'))
        return { rows: [{ wins: 2, total_value: '80000' }] };
      if (t.includes('FROM company_aliases')) return { rows: [{ alias: 'ACME SA' }] };
      if (t.includes('FROM company_identifiers'))
        return { rows: [{ scheme: 'nif', value: 'A12345674' }] };
      if (t.includes('FROM awards a') && t.includes('count(*) OVER()')) {
        return {
          rows: [
            {
              row_id: 9,
              source_ref: '123-2026',
              title: 'Servicio de ciberseguridad',
              row_date: '2026-01-15',
              buyer_id: 5,
              buyer_name: 'Ayuntamiento de X',
              company_id: 7,
              company_name: 'ACME S.A.',
              value: '80000',
              currency: 'EUR',
              cpv: '72000000',
              total_count: 1,
            },
          ],
        };
      }
      if (t.includes('count(DISTINCT client_key)')) return { rows: [{ n: 3 }] };
      if (t.includes('FROM request_logs GROUP BY endpoint'))
        return { rows: [{ endpoint: 'GET /v1/search', requests: 10, paid_requests: 4 }] };
      if (t.includes('FROM payments GROUP BY status'))
        return { rows: [{ status: 'success', n: 4, amount: '0.20' }] };
      if (t.includes('FROM request_logs WHERE cpv IS NOT NULL')) return { rows: [{ value: '72', n: 6 }] };
      if (t.includes('FROM request_logs WHERE buyer IS NOT NULL')) return { rows: [] };
      if (t.includes('FROM request_logs WHERE company IS NOT NULL')) return { rows: [] };
      if (t.includes('status >= 400 OR error IS NOT NULL')) return { rows: [{ n: 2 }] };
      if (t.includes('FROM awards') && t.includes('value_null'))
        return { rows: [{ awards_total: 10, value_null: 3, winner_null: 1 }] };
      return { rows: [] };
    },
    on: () => undefined,
    end: async () => undefined,
  };
  return { db: db as unknown as Db, calls };
}

const PAY = { 'x-payment': 'test-proof' };

describe('buildServer wiring (stubbed payment, fake db)', () => {
  let app: FastifyInstance;
  let calls: QueryCall[];

  beforeAll(async () => {
    const f = fakeDb();
    calls = f.calls;
    app = await buildServer(config, f.db);
  });
  afterAll(async () => {
    await app.close();
  });

  it('402 x402-shaped body without payment', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/search?q=test' });
    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.x402Version).toBe(1);
    expect(body.accepts[0].amount).toBe('0.02');
    expect(body.accepts[0].resource).toBe('GET /v1/search');
  });

  it('200 envelope with meta when paid', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/search?q=test', headers: PAY });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ kind: 'award', id: 9, cpv: '72000000', value: 80000 });
    expect(body.meta.price_usd).toBe('0.02');
    expect(body.meta.paid).toBe(true);
    expect(body.meta.total).toBe(1);
    expect(typeof body.meta.request_id).toBe('string');
  });

  it('400 invalid_query envelope on bad params', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/search?size=101', headers: PAY });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('invalid_query');
    expect(typeof body.error.hint).toBe('string');
  });

  it('404 not_found envelope on unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('GET /v1/tenders/:id returns tender with provenance incl. TED url', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tenders/1', headers: PAY });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe(1);
    expect(body.data.buyer.name).toBe('Ayuntamiento de X');
    expect(body.meta.provenance[0]).toMatchObject({
      source: 'ted',
      source_ref: '123-2026',
      url: 'https://ted.europa.eu/udl?uri=TED:NOTICE:123-2026:TEXT:EN:HTML',
    });
    expect(body.meta.price_usd).toBe('0.02');
  });

  it('GET /v1/companies/:id returns profile with identity aliases/identifiers', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/companies/7', headers: PAY });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({
      id: 7,
      name: 'ACME S.A.',
      nif: 'A12345674',
      aliases: ['ACME SA'],
      identifiers: [{ scheme: 'nif', value: 'A12345674' }],
    });
    expect(body.data.stats.wins).toBe(2);
    expect(body.meta.caveats[0]).toContain('Framework agreement values');
  });

  it('GET /v1/pricing is free and machine-readable', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/pricing' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.paid).toBe(false);
    expect(body.meta.price_usd).toBe('0.00');
    const renewals = body.data.endpoints.find((e: { endpoint: string }) => e.endpoint === 'GET /v1/renewals');
    expect(renewals.price_usd).toBe('0.25');
  });

  it('GET /v1/stats requires operator key', async () => {
    const unauth = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.json().error.code).toBeDefined();

    const ok = await app.inject({
      method: 'GET',
      url: '/v1/stats',
      headers: { 'x-operator-key': 'operator-secret' },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.data.unique_clients).toBe(3);
    expect(body.data.payments).toMatchObject({ attempts: 4, successes: 4, revenue_usd: 0.2 });
    expect(body.data.failed_queries).toBe(2);
    expect(body.data.data_null_rates.award_value_null_rate).toBeCloseTo(0.3);
  });

  it('serves /openapi.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toBe('3.1.0');
  });

  it('writes request_logs rows asynchronously (fire-and-forget)', async () => {
    await new Promise((r) => setImmediate(r));
    const inserts = calls.filter((c) => c.text.includes('INSERT INTO request_logs'));
    expect(inserts.length).toBeGreaterThanOrEqual(8);
    const searchLogs = inserts.filter((c) => c.values[1] === 'GET /v1/search' && c.values[2] === 'GET');
    expect(searchLogs.length).toBeGreaterThanOrEqual(3); // 402, 200 paid, 400 invalid
    expect(searchLogs.some((c) => c.values[9] === true)).toBe(true); // paid flag on the paid request
    expect(searchLogs.some((c) => c.values[9] === false)).toBe(true); // unpaid 402 request also logged
  });
});

describe('rate limiting', () => {
  it('returns 429 rate_limited envelope after 60 req/min per client', async () => {
    const f = fakeDb();
    const app2 = await buildServer(config, f.db);
    let last = 0;
    let body: { error?: { code?: string } } = {};
    for (let i = 0; i < 61; i++) {
      const res = await app2.inject({ method: 'GET', url: '/v1/pricing' });
      last = res.statusCode;
      body = res.json();
    }
    expect(last).toBe(429);
    expect(body.error?.code).toBe('rate_limited');
    await app2.close();
  });
});

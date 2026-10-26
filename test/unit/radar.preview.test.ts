// GET /v1/radar/preview — free capped sample. Real rows only, IT/software
// CPV vertical, explicit nulls, calculation quoted from stored basis.

import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { ENDPOINT_PRICES } from '../../src/domain/types.js';
import { calculationFromBasis, radarPreviewData, type RadarPreviewQuery } from '../../src/api/routes/radar.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { makeTestConfig } from './testconfig.js';
import { makeTestDb } from './testdb.js';

const baseQuery: RadarPreviewQuery = { window_months: 12 };

function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seed(db: Awaited<ReturnType<typeof makeTestDb>>): Promise<void> {
  await db.query(`INSERT INTO sources (id, code, name) VALUES (1, 'ted', 'TED'), (2, 'placsp', 'PLACSP')`);
  await db.query(
    `INSERT INTO buyers (id, source_id, source_ref, name, name_norm, nuts) VALUES
      (1, 1, 'b1', 'Ayuntamiento de Test', 'ayuntamiento de test', 'ES511'),
      (2, 1, 'b2', 'Ministerio de Obras', 'ministerio de obras', 'ES300')`,
  );
  await db.query(
    `INSERT INTO companies (id, source_id, source_ref, name, name_norm) VALUES
      (1, 1, 'c1', 'Soft SL', 'soft sl')`,
  );
  await db.query(
    `INSERT INTO tenders (id, source_id, source_ref, title, cpv_main, publication_date, buyer_id, estimated_value, currency, nuts, url) VALUES
      (1, 1, '111-2026', 'Servicios de ciberseguridad', '72000000', $1, 1, 180000, 'EUR', 'ES511', NULL),
      (2, 1, '222-2026', 'Obra civil', '45000000', $1, 2, 900000, 'EUR', 'ES300', NULL),
      (3, 2, '333-2026', 'Licencias de software', '48000000', $1, 2, NULL, NULL, 'ES300', 'https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=abc')`,
    [isoInDays(-10)],
  );
  await db.query(
    `INSERT INTO awards (id, tender_id, source_ref, award_date) VALUES (1, 1, 'a1', $1)`,
    [isoInDays(-400)],
  );
  await db.query(
    `INSERT INTO contracts (id, award_id, buyer_id, company_id, cpv, title, value, currency, end_date) VALUES
      (1, 1, 1, 1, '72000000', 'Mantenimiento ciber', 120000, 'EUR', $1)`,
    [isoInDays(80)],
  );
  await db.query(
    `INSERT INTO forecast_signals (id, buyer_id, cpv, incumbent_company_id, contract_id, signal_type, window_start, window_end, confidence, basis) VALUES
      (1, 1, '72000000', 1, 1, 'duration_expiry', $1, $2, 'medium', $3::jsonb),
      (2, 2, '45000000', NULL, NULL, 'duration_expiry', $1, $2, 'low', '{"rule":"explicit_end_date"}'::jsonb),
      (3, 1, '48000000', NULL, NULL, 'recurrence', $4, $5, 'high', '{"window_rule":"last_award + median_interval ± 25%","evidence_count":3}'::jsonb)`,
    [
      isoInDays(30),
      isoInDays(120),
      JSON.stringify({
        rule: 'explicit_end_date',
        confidence_rule: 'medium: the award notice carried an explicit end date',
        end_date: isoInDays(80),
      }),
      isoInDays(900),
      isoInDays(1000),
    ],
  );
}

describe('calculationFromBasis', () => {
  it('quotes stored fields and returns null when there is nothing to cite', () => {
    expect(calculationFromBasis(null)).toBeNull();
    expect(calculationFromBasis({})).toBeNull();
    expect(calculationFromBasis({ rule: 'explicit_end_date', end_date: '2027-01-01' })).toBe(
      'rule=explicit_end_date · end_date=2027-01-01',
    );
    expect(calculationFromBasis({ narrative: 'invented confidence 99%' })).toBeNull();
  });
});

describe('radarPreviewData', () => {
  it('returns only in-window IT/software rows and never invents a calculation', async () => {
    const db = await makeTestDb();
    await seed(db);
    const data = await radarPreviewData(db, baseQuery);
    const renewals = data.renewals as { rows: Array<Record<string, unknown>>; shown: number; total: number };
    const opportunities = data.opportunities as { rows: Array<Record<string, unknown>>; total: number };

    expect(renewals.total).toBe(1);
    expect(renewals.shown).toBe(1);
    expect(renewals.rows[0]).toMatchObject({
      sample: true,
      signal_type: 'duration_expiry',
      cpv: '72000000',
      confidence: 'medium',
      buyer: { name: 'Ayuntamiento de Test' },
      incumbent: { name: 'Soft SL' },
      source: 'ted',
      source_ref: '111-2026',
    });
    expect(renewals.rows[0].calculation).toContain('rule=explicit_end_date');
    expect(String(renewals.rows[0].calculation)).not.toMatch(/probability|invented/i);
    expect(renewals.rows[0].url).toBe('https://ted.europa.eu/udl?uri=TED:NOTICE:111-2026:TEXT:EN:HTML');
    expect(renewals.rows.map((row) => row.cpv)).not.toContain('45000000');

    const titles = opportunities.rows.map((row) => row.title);
    expect(titles).toContain('Servicios de ciberseguridad');
    expect(titles).toContain('Licencias de software');
    expect(titles).not.toContain('Obra civil');
    const software = opportunities.rows.find((row) => row.title === 'Licencias de software');
    expect(software).toMatchObject({
      estimated_value: null,
      currency: null,
      source: 'placsp',
      source_ref: '333-2026',
      url: 'https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=abc',
    });
    expect(opportunities.total).toBe(2);
    expect(JSON.stringify(data)).not.toMatch(/\/null/);
    await db.end();
  });

  it('applies buyer and cpv filters and stays empty instead of backfilling', async () => {
    const db = await makeTestDb();
    await seed(db);
    const filtered = await radarPreviewData(db, { ...baseQuery, buyer: 'Ayuntamiento', cpv: '72' });
    const renewals = filtered.renewals as { total: number; rows: Array<{ cpv: string }> };
    expect(renewals.total).toBe(1);
    expect(renewals.rows[0].cpv?.startsWith('72')).toBe(true);

    const none = await radarPreviewData(db, { ...baseQuery, buyer: 'nadie-con-este-nombre' });
    expect((none.renewals as { total: number; rows: unknown[] }).total).toBe(0);
    expect((none.renewals as { rows: unknown[] }).rows).toEqual([]);
    expect((none.opportunities as { rows: unknown[] }).rows).toEqual([]);
    await db.end();
  });

  it('does not turn a missing or literal null notice url into /null', async () => {
    const db = await makeTestDb();
    await seed(db);
    await db.query(`UPDATE tenders SET url = 'null' WHERE source_id = 1`);
    await db.query(`UPDATE tenders SET url = NULL WHERE source_id = 2`);
    const data = await radarPreviewData(db, baseQuery);
    const renewals = data.renewals as { rows: Array<{ url: string | null }> };
    const opportunities = data.opportunities as { rows: Array<{ source: string; url: string | null }> };
    expect(renewals.rows[0].url).toBe('https://ted.europa.eu/udl?uri=TED:NOTICE:111-2026:TEXT:EN:HTML');
    const placsp = opportunities.rows.find((row) => row.source === 'placsp');
    expect(placsp?.url).toBeNull();
    const ted = opportunities.rows.find((row) => row.source === 'ted');
    expect(ted?.url).toBe('https://ted.europa.eu/udl?uri=TED:NOTICE:111-2026:TEXT:EN:HTML');
    const encoded = JSON.stringify(data);
    expect(encoded).not.toMatch(/\/null/);
    expect(encoded).not.toContain('"url":"null"');
    await db.end();
  });
});

describe('GET /v1/radar/preview', () => {
  it('is free and rejects a CPV outside software and IT services', async () => {
    expect(ENDPOINT_PRICES['GET /v1/radar/preview']).toBe('0.00');
    resetPayments();
    const db = await makeTestDb();
    const app = await buildServer(makeTestConfig(), db);
    try {
      const ok = await app.inject({ method: 'GET', url: '/v1/radar/preview' });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().meta).toMatchObject({ price_usd: '0.00', paid: true, sample: true });
      expect(ok.json().data.renewals.rows).toEqual([]);

      const bad = await app.inject({ method: 'GET', url: '/v1/radar/preview?cpv=45' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('invalid_query');
    } finally {
      await app.close();
      await db.end();
      resetPayments();
    }
  });
});

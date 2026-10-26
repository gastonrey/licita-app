// Future renewal window: window_end is still open and window_start falls on
// or before today + window_months. Expired rows must not lead the public
// sample just because their window_start is the oldest date.

import { describe, expect, it } from 'vitest';
import { buildRenewalPreviewQuery, radarPreviewData } from '../../src/api/routes/radar.js';
import { buildRenewalsQuery } from '../../src/api/routes/renewals.js';
import { demoData, DEMO_RENEWAL_SQL, DEMO_TENDER_SQL } from '../../src/api/routes/demo.js';
import { renewalsQuerySchema } from '../../src/api/validate.js';
import { makeTestDb } from './testdb.js';

function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seed(db: Awaited<ReturnType<typeof makeTestDb>>): Promise<void> {
  await db.query(`INSERT INTO sources (id, code, name) VALUES (1, 'ted', 'TED')`);
  await db.query(
    `INSERT INTO buyers (id, source_id, source_ref, name, name_norm, nuts, country) VALUES
      (1, 1, 'b1', 'Ayuntamiento de Madrid', 'ayuntamiento de madrid', 'ES300', 'ES'),
      (2, 1, 'b2', 'Xunta', 'xunta', 'ES11', 'ES')`,
  );
  await db.query(
    `INSERT INTO tenders (id, source_id, source_ref, title, cpv_main, publication_date, buyer_id) VALUES
      (1, 1, 'old-soft', 'Software viejo', '48000000', $1, 1),
      (2, 1, 'bull', 'Festejos taurinos', '92331100', $2, 1),
      (3, 1, 'new-soft', 'Ciberseguridad reciente', '72200000', $3, 2)`,
    [isoInDays(-400), isoInDays(-1), isoInDays(-20)],
  );
  await db.query(
    `INSERT INTO forecast_signals (id, buyer_id, cpv, signal_type, window_start, window_end, confidence) VALUES
      (1, 1, '72000000', 'duration_expiry', $1, $2, 'low'),
      (2, 1, '72000000', 'duration_expiry', $3, $4, 'high'),
      (3, 1, '72000000', 'duration_expiry', $5, $6, 'medium'),
      (4, 2, '48000000', 'duration_expiry', $7, $8, 'medium'),
      (5, 1, '72000000', 'duration_expiry', $9, $10, 'high'),
      (6, 1, '45000000', 'duration_expiry', $3, $4, 'high'),
      (7, 2, '72200000', 'recurrence', $11, $12, 'low')`,
    [
      isoInDays(-2000), isoInDays(-1800), // expired, would sort first under the old query
      isoInDays(200), isoInDays(260), // high, further away
      isoInDays(15), isoInDays(40), // medium, close
      isoInDays(-30), isoInDays(20), // medium, already open, closer than +15
      isoInDays(400), isoInDays(460), // high, beyond 12 months
      isoInDays(10), isoInDays(40), // low, inside 6 months, other region
    ],
  );
}

describe('future renewal window', () => {
  it('drops expired signals and ranks confidence, then closeness of window_start', async () => {
    const db = await makeTestDb();
    await seed(db);
    const data = await radarPreviewData(db, { window_months: 12 });
    const renewals = data.renewals as { total: number; rows: Array<{ id: number; confidence: string }> };
    expect(renewals.rows.map((row) => row.id)).not.toContain(1);
    expect(renewals.rows.map((row) => row.id)).not.toContain(5);
    expect(renewals.rows.map((row) => row.id)).not.toContain(6);
    expect(renewals.total).toBe(4);
    expect(renewals.rows.map((row) => row.confidence)).toEqual(['high', 'medium', 'medium', 'low']);
    expect(new Set(renewals.rows.map((row) => row.id))).toEqual(new Set([2, 3, 4, 7]));
    expect(buildRenewalPreviewQuery({ window_months: 12 }).text).toContain('CURRENT_DATE::date - fs.window_start::date');
    await db.end();
  });

  it('honours window_months, CPV prefix and region', async () => {
    const db = await makeTestDb();
    await seed(db);
    const six = await radarPreviewData(db, { window_months: 6 });
    const sixIds = (six.renewals as { rows: Array<{ id: number }> }).rows.map((row) => row.id);
    expect(sixIds).not.toContain(2);
    expect(new Set(sixIds)).toEqual(new Set([3, 4, 7]));
    expect((six.renewals as { rows: Array<{ confidence: string }> }).rows.map((row) => row.confidence)).toEqual(['medium', 'medium', 'low']);

    const cpv = await radarPreviewData(db, { window_months: 12, cpv: '48' });
    expect((cpv.renewals as { rows: Array<{ id: number }> }).rows.map((row) => row.id)).toEqual([4]);

    const region = await radarPreviewData(db, { window_months: 12, region: 'ES11' });
    expect((region.renewals as { rows: Array<{ id: number }> }).rows.map((row) => row.id)).toEqual([4, 7]);
    await db.end();
  });

  it('applies the same open-window predicate on GET /v1/renewals', async () => {
    const db = await makeTestDb();
    await seed(db);
    const q = renewalsQuerySchema.parse({ window_months: 12, cpv: '72', page: 1, size: 20 });
    const built = buildRenewalsQuery(q);
    expect(built.text).toContain('fs.window_end >= CURRENT_DATE');
    expect(built.text).toContain('CAST($1 AS date)');
    expect(built.text).toContain('CURRENT_DATE::date - fs.window_start::date');
    const executable = built.text.replace('count(*) OVER() AS total_count', '0 AS total_count');
    const res = await db.query(executable, built.values);
    const ids = res.rows.map((row) => Number(row.id));
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(5);
    expect(ids).not.toContain(4);
    expect(new Set(ids)).toEqual(new Set([2, 3, 7]));
    expect(res.rows.map((row) => String(row.confidence))).toEqual(['high', 'medium', 'low']);
    await db.end();
  });
});

describe('demo CPV 48/72 sample', () => {
  it('picks a recent software tender and an open renewal, never a newer unrelated CPV', async () => {
    expect(DEMO_TENDER_SQL).toContain("LIKE '48%'");
    expect(DEMO_TENDER_SQL).toContain("LIKE '72%'");
    expect(DEMO_RENEWAL_SQL).toContain('fs.window_end >= CURRENT_DATE');
    const db = await makeTestDb();
    await seed(db);
    const data = await demoData(db, {});
    expect(data.tender).toMatchObject({ title: 'Ciberseguridad reciente', cpv_main: '72200000' });
    expect(data.renewal).toMatchObject({ confidence: 'high', cpv: '72000000' });
    await db.end();
  });

  it('returns null samples when the index has no CPV 48/72 row', async () => {
    const db = await makeTestDb();
    await db.query(`INSERT INTO sources (id, code, name) VALUES (1, 'ted', 'TED')`);
    await db.query(
      `INSERT INTO tenders (id, source_id, source_ref, title, cpv_main, publication_date) VALUES
        (1, 1, 'bull', 'Festejos taurinos', '92331100', $1)`,
      [isoInDays(-1)],
    );
    const data = await demoData(db, {});
    expect(data.tender).toBeNull();
    expect(data.renewal).toBeNull();
    expect(String(data.note)).toContain('null');
    await db.end();
  });
});

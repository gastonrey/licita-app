// Forecast signal tests: pure helpers + pg-mem recompute end to end (SPEC §8).
import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  addMonthsIso,
} from '../../src/ingest/normalize.js';
import {
  BASIS_VERSION,
  confidenceForEvidence,
  contractSignals,
  intervalDays,
  median,
  medianIntervalDays,
  RECURRENCE_WINDOW_RULE,
  recomputeSignals,
  recurrenceSignals,
  recurrenceWindow,
  toIsoDate,
  type ContractSignalRow,
  type RecurrenceAwardRow,
} from '../../src/forecast/signals.js';
import { makeTestDb } from './testdb.js';
import type { Db } from '../../src/db/client.js';

describe('pure signal helpers', () => {
  it('median', () => {
    expect(median([1])).toBe(1);
    expect(median([1, 3])).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });

  it('medianIntervalDays between consecutive award dates', () => {
    expect(medianIntervalDays(['2024-01-01'])).toBeNull();
    expect(medianIntervalDays(['2024-01-01', '2025-01-01'])).toBe(366);
    expect(medianIntervalDays(['2024-01-01', '2025-01-01', '2026-01-01'])).toBe(365.5);
  });

  it('recurrenceWindow = last + median ± 25%', () => {
    const w = recurrenceWindow('2026-01-01', 400);
    // predicted = 2026-01-01 + 400d = 2027-02-05; window ±100d
    expect(w.windowStart).toBe('2026-10-28');
    expect(w.windowEnd).toBe('2027-05-16');
    expect(w.predictedDate).toBe('2027-02-05');
  });

  it('intervalDays lists the gaps between consecutive dates', () => {
    expect(intervalDays(['2024-01-01', '2025-01-01', '2025-02-01'])).toEqual([366, 31]);
    expect(intervalDays(['2024-01-01'])).toEqual([]);
  });

  it('confidence by evidence count: 1 low, 2 medium, >=3 high', () => {
    expect(confidenceForEvidence(1)).toBe('low');
    expect(confidenceForEvidence(2)).toBe('medium');
    expect(confidenceForEvidence(3)).toBe('high');
    expect(confidenceForEvidence(10)).toBe('high');
  });

  it('toIsoDate handles strings and local/UTC midnight Dates', () => {
    expect(toIsoDate('2026-07-01')).toBe('2026-07-01');
    expect(toIsoDate(new Date(Date.UTC(2026, 6, 1)))).toBe('2026-07-01');
    expect(toIsoDate(new Date(2026, 6, 1))).toBe('2026-07-01'); // local midnight
    expect(toIsoDate(null)).toBeNull();
  });
});

describe('contractSignals', () => {
  const mk = (over: Partial<ContractSignalRow>): ContractSignalRow => ({
    contract_id: 1,
    buyer_id: 1,
    company_id: 2,
    cpv: '72000000',
    framework: false,
    end_date: '2027-01-15',
    award_date: '2026-01-15',
    explicit_end_date: '2027-01-15',
    start_date: '2026-01-15',
    duration_months: 12,
    source_ref: '1-2026',
    tender_source_ref: '99-2026',
    ...over,
  });

  it('duration_expiry: explicit end → medium, ±90d window', () => {
    const s = contractSignals(mk({}));
    expect(s).toHaveLength(1);
    expect(s[0].signal_type).toBe('duration_expiry');
    expect(s[0].confidence).toBe('medium');
    expect(s[0].window_start).toBe('2026-10-17');
    expect(s[0].window_end).toBe('2027-04-15');
  });

  it('duration_expiry basis: full evidence trail + basis_version', () => {
    const s = contractSignals(mk({}));
    expect(s[0].basis).toEqual({
      basis_version: BASIS_VERSION,
      rule: 'explicit_end_date',
      confidence_rule: 'medium: the award notice carried an explicit end date',
      end_date: '2027-01-15',
      award_date: '2026-01-15',
      start_date: '2026-01-15',
      duration_months: 12,
      framework: false,
      buyer_id: 1,
      cpv: '72000000',
      incumbent_company_id: 2,
      source_ref: '1-2026',
      tender_source_ref: '99-2026',
    });
  });

  it('duration_expiry: derived end (no explicit) → low, rule auditable', () => {
    const s = contractSignals(
      mk({
        end_date: '2028-07-24',
        award_date: '2026-07-24',
        explicit_end_date: null,
        source_ref: '2-2026',
      }),
    );
    expect(s[0].signal_type).toBe('duration_expiry');
    expect(s[0].confidence).toBe('low');
    expect(s[0].basis.rule).toBe('derived_from_duration');
    expect(String(s[0].basis.confidence_rule)).toContain('low:');
  });

  it('framework_expiry: no explicit end → award_date + 48m ± 90d, low', () => {
    const s = contractSignals(
      mk({
        framework: true,
        end_date: null,
        award_date: '2026-01-15',
        explicit_end_date: null,
        duration_months: null,
        source_ref: '3-2026',
      }),
    );
    expect(s).toHaveLength(1);
    expect(s[0].signal_type).toBe('framework_expiry');
    expect(s[0].confidence).toBe('low');
    const expectedEnd = addMonthsIso('2026-01-15', 48);
    expect(s[0].window_start).toBe(addDaysIso(expectedEnd, -90));
    expect(s[0].window_end).toBe(addDaysIso(expectedEnd, 90));
    expect(s[0].basis.rule).toBe('lcsp_48m_cap');
    expect(s[0].basis.end_date).toBe(expectedEnd);
    expect(s[0].basis.framework).toBe(true);
    expect(s[0].basis.basis_version).toBe(BASIS_VERSION);
  });

  it('framework_expiry: explicit end → medium', () => {
    const s = contractSignals(
      mk({
        framework: true,
        end_date: '2026-12-31',
        award_date: '2026-05-27',
        explicit_end_date: '2026-12-31',
        source_ref: '4-2026',
      }),
    );
    expect(s[0].signal_type).toBe('framework_expiry');
    expect(s[0].confidence).toBe('medium');
    expect(s[0].basis.rule).toBe('explicit_end_date');
  });
});

describe('recurrenceSignals', () => {
  const mk = (date: string, ref: string, buyer = 1, cpv = '72200000'): RecurrenceAwardRow => ({
    buyer_id: buyer,
    cpv_main: cpv,
    award_date: date,
    winner_company_id: 9,
    contract_id: null,
    source_ref: ref,
  });

  it('needs >= 2 awards in same buyer + cpv division', () => {
    expect(recurrenceSignals([mk('2026-01-01', 'a')])).toEqual([]);
    // different divisions do not group
    expect(
      recurrenceSignals([mk('2024-01-01', 'a'), mk('2025-01-01', 'b', 1, '48200000')]),
    ).toEqual([]);
  });

  it('groups by cpv division (first 2 digits), 2 awards → medium', () => {
    const s = recurrenceSignals([
      mk('2024-01-01', 'a', 1, '72200000'),
      mk('2025-06-15', 'b', 1, '72500000'), // same division 72
    ]);
    expect(s).toHaveLength(1);
    expect(s[0].signal_type).toBe('recurrence');
    expect(s[0].cpv).toBe('72');
    expect(s[0].confidence).toBe('medium');
    expect(s[0].incumbent_company_id).toBe(9);
    expect(s[0].basis.evidence_count).toBe(2);
  });

  it('3 awards → high, window from median interval', () => {
    const s = recurrenceSignals([
      mk('2023-01-01', 'a'),
      mk('2024-01-01', 'b'),
      mk('2025-01-01', 'c'),
    ]);
    expect(s[0].confidence).toBe('high');
    // gaps 365d and 366d → median 365.5
    const { windowStart, windowEnd } = recurrenceWindow('2025-01-01', 365.5);
    expect(s[0].window_start).toBe(windowStart);
    expect(s[0].window_end).toBe(windowEnd);
  });

  it('recurrence basis exposes the full dated evidence trail', () => {
    const s = recurrenceSignals([
      mk('2023-01-01', 'a'),
      mk('2024-01-01', 'b'),
      mk('2025-01-01', 'c'),
    ]);
    expect(s[0].basis).toEqual({
      basis_version: BASIS_VERSION,
      evidence_count: 3,
      confidence_rule: 'high: 3 dated awards for this buyer + CPV division (2 → medium, ≥ 3 → high)',
      window_rule: RECURRENCE_WINDOW_RULE,
      predicted_date: recurrenceWindow('2025-01-01', 365.5).predictedDate,
      median_interval_days: 365.5,
      intervals_days: [365, 366],
      last_award_date: '2025-01-01',
      award_refs: ['a', 'b', 'c'],
      award_history: [
        { source_ref: 'a', award_date: '2023-01-01' },
        { source_ref: 'b', award_date: '2024-01-01' },
        { source_ref: 'c', award_date: '2025-01-01' },
      ],
    });
  });
});

// --- pg-mem end-to-end: recomputeSignals deletes then rebuilds -------------
async function seed(db: Db): Promise<void> {
  await db.query(`INSERT INTO sources(id, code, name) VALUES (1, 'ted', 'TED')`);
  await db.query(
    `INSERT INTO buyers(id, source_id, source_ref, name, name_norm, country)
     VALUES (1, 1, 'b1|ESP', 'Buyer One', 'b1', 'ESP')`,
  );
  await db.query(
    `INSERT INTO companies(id, source_id, source_ref, name, name_norm, country)
     VALUES (1, 1, 'c1|ESP', 'Winner SA', 'c1', 'ESP')`,
  );
  await db.query(`INSERT INTO cpvs(code) VALUES ('72200000'), ('72500000')`);
  // Tender + award + contract with explicit end (duration_expiry, medium)
  await db.query(
    `INSERT INTO tenders(id, source_id, source_ref, buyer_id, cpv_main, cpv_all)
     VALUES (1, 1, 't1', 1, '72200000', ARRAY['72200000'])`,
  );
  await db.query(
    `INSERT INTO awards(id, tender_id, source_ref, award_date, winner_company_id, end_date)
     VALUES (1, 1, 't1', '2026-01-15', 1, '2027-01-15')`,
  );
  await db.query(
    `INSERT INTO contracts(id, award_id, buyer_id, company_id, cpv, framework, start_date, end_date)
     VALUES (1, 1, 1, 1, '72200000', false, '2026-01-15', '2027-01-15')`,
  );
  // Framework contract without explicit end (framework_expiry from LCSP cap, low).
  // CPV 48* keeps it OUT of the division-72 recurrence group.
  await db.query(
    `INSERT INTO tenders(id, source_id, source_ref, buyer_id, cpv_main, cpv_all)
     VALUES (2, 1, 't2', 1, '48200000', ARRAY['48200000'])`,
  );
  await db.query(
    `INSERT INTO awards(id, tender_id, source_ref, award_date, winner_company_id, framework)
     VALUES (2, 2, 't2', '2025-03-01', 1, true)`,
  );
  await db.query(
    `INSERT INTO contracts(id, award_id, buyer_id, company_id, cpv, framework, start_date, end_date)
     VALUES (2, 2, 1, 1, '48200000', true, '2025-03-01', '2029-03-01')`,
  );
  // Recurrence: 3 awards for buyer 1 in division 72 (t1 above + two more)
  for (const [i, date] of [
    [3, '2023-06-01'],
    [4, '2024-09-01'],
  ] as Array<[number, string]>) {
    await db.query(
      `INSERT INTO tenders(id, source_id, source_ref, buyer_id, cpv_main, cpv_all)
       VALUES ($1, 1, $2, 1, '72200000', ARRAY['72200000'])`,
      [i, `t${i}`],
    );
    await db.query(
      `INSERT INTO awards(id, tender_id, source_ref, award_date, winner_company_id)
       VALUES ($1, $1, $2, $3, 1)`,
      [i, `t${i}`, date],
    );
  }
}

describe('recomputeSignals on pg-mem', () => {
  it('rebuilds duration_expiry, framework_expiry and recurrence; re-run is clean', async () => {
    const db = await makeTestDb();
    await seed(db);
    const res = await recomputeSignals(db);
    // duration_expiry: award 1 (explicit end). framework_expiry: contract 2
    // (derived 48m end, low). recurrence: division 72 has awards at
    // 2023-06-01, 2024-09-01, 2026-01-15 → high.
    expect(res.byType.duration_expiry).toBe(1);
    expect(res.byType.framework_expiry).toBe(1);
    expect(res.byType.recurrence).toBe(1);
    expect(res.total).toBe(3);

    const rows = (
      await db.query('SELECT signal_type, confidence, basis FROM forecast_signals ORDER BY signal_type')
    ).rows as Array<{ signal_type: string; confidence: string; basis: Record<string, unknown> }>;
    const byType = Object.fromEntries(rows.map((r) => [r.signal_type, r]));
    expect(byType.duration_expiry.confidence).toBe('medium');
    expect(byType.framework_expiry.confidence).toBe('low');
    expect(byType.recurrence.confidence).toBe('high');
    expect(byType.recurrence.basis.evidence_count).toBe(3);

    // every persisted basis carries the auditable evidence trail (basis_version 1)
    for (const r of rows) {
      expect(r.basis.basis_version).toBe(BASIS_VERSION);
      expect(typeof r.basis.confidence_rule).toBe('string');
    }
    expect(byType.duration_expiry.basis).toMatchObject({
      rule: 'explicit_end_date',
      end_date: '2027-01-15',
      award_date: '2026-01-15',
      source_ref: 't1',
      tender_source_ref: 't1',
      framework: false,
      buyer_id: 1,
      incumbent_company_id: 1,
    });
    expect(byType.framework_expiry.basis).toMatchObject({
      rule: 'lcsp_48m_cap',
      award_date: '2025-03-01',
      source_ref: 't2',
      tender_source_ref: 't2',
      framework: true,
    });
    expect(byType.recurrence.basis).toMatchObject({
      window_rule: RECURRENCE_WINDOW_RULE,
      intervals_days: [458, 501],
      last_award_date: '2026-01-15',
      award_refs: ['t3', 't4', 't1'],
    });

    // delete + rebuild: second run yields identical state, no duplicates
    const res2 = await recomputeSignals(db);
    expect(res2).toEqual(res);
    expect((await db.query('SELECT count(*)::int n FROM forecast_signals')).rows[0]).toEqual({
      n: 3,
    });
  });
});

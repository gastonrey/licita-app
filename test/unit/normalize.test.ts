// Parser tests against REAL TED Search API v3 responses (fixtures fetched
// live 2026-08-13; see fixtures dir). Also covers pure helper edge cases.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  addMonthsIso,
  deriveContractDates,
  firstLangValue,
  isoDate,
  isFrameworkFlag,
  monthsFromDuration,
  normalizeName,
  parseTedNotice,
  pickNif,
  pickNuts,
} from '../../src/ingest/normalize.js';
import type { TedNotice, TedSearchResponse } from '../../src/domain/types.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function loadFixture(name: string): TedNotice[] {
  const res = JSON.parse(
    readFileSync(join(fixturesDir, name), 'utf8'),
  ) as TedSearchResponse;
  return res.notices;
}

describe('normalizeName (lower(unaccent(trim)))', () => {
  it('trims, lowercases and strips diacritics', () => {
    expect(normalizeName('  Tecnilógica Ecosistemas, S.A.U. ')).toBe(
      'tecnilogica ecosistemas, s.a.u.',
    );
    expect(normalizeName('DIPUTACIÓN DE BARCELONA')).toBe('diputacion de barcelona');
    expect(normalizeName('Müller Ñandú')).toBe('muller nandu');
  });
});

describe('scalar helpers', () => {
  it('isoDate strips timezone offsets', () => {
    expect(isoDate('2026-07-01+02:00')).toBe('2026-07-01');
    expect(isoDate('2026-06-30Z')).toBe('2026-06-30');
    expect(isoDate('20260701')).toBe('2026-07-01');
    expect(isoDate(undefined)).toBeNull();
    expect(isoDate('nope')).toBeNull();
  });

  it('firstLangValue prefers spa, then eng, then any', () => {
    expect(firstLangValue({ spa: ['Hola'], eng: ['Hello'] })).toBe('Hola');
    expect(firstLangValue({ eng: ['Hello'], deu: ['Hallo'] })).toBe('Hello');
    expect(firstLangValue({ deu: ['Hallo'] })).toBe('Hallo');
    // live quirk: scalar string value inside the map (title-proc)
    expect(firstLangValue({ spa: 'Título' })).toBe('Título');
    expect(firstLangValue(null)).toBeNull();
  });

  it('monthsFromDuration converts units', () => {
    expect(monthsFromDuration('24', 'MONTH')).toBe(24);
    expect(monthsFromDuration('1', 'YEAR')).toBe(12);
    expect(monthsFromDuration('2', 'YEAR')).toBe(24);
    expect(monthsFromDuration('30', 'DAY')).toBeCloseTo(0.99, 1);
    expect(monthsFromDuration(undefined, 'MONTH')).toBeNull();
  });

  it('isFrameworkFlag treats anything but "none" as framework', () => {
    expect(isFrameworkFlag(['none'])).toBe(false);
    expect(isFrameworkFlag(['fa-wo-rc'])).toBe(true);
    expect(isFrameworkFlag(['fa-w-rc'])).toBe(true);
    expect(isFrameworkFlag(undefined)).toBe(false);
  });

  it('pickNif extracts Spanish NIF/CIF shapes only', () => {
    expect(pickNif(['A28963767'])).toBe('A28963767');
    expect(pickNif(['11716830215443', 'S2827001E'])).toBe('S2827001E');
    expect(pickNif(['11716830215443'])).toBeNull();
    expect(pickNif(undefined)).toBeNull();
  });

  it('pickNuts prefers granular NUTS over country', () => {
    expect(pickNuts(['ES300', 'ESP'])).toBe('ES300');
    expect(pickNuts(['ESP'])).toBe('ESP');
    expect(pickNuts(undefined)).toBeNull();
  });

  it('addMonthsIso clamps to month end', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2026-07-01', 48)).toBe('2030-07-01');
    expect(addDaysIso('2026-12-31', 90)).toBe('2027-03-31');
  });
});

describe('parseTedNotice — fixture: recent ES IT award notices', () => {
  const notices = loadFixture('ted-search-es-can-it.json');

  it('parses buyer, winner, value, cpvs from a single-winner eForms notice', () => {
    const rows = parseTedNotice(notices[0]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.sourceRef).toBe('449218-2026');
    expect(r.noticeType).toBe('can-standard');
    expect(r.publicationDate).toBe('2026-07-01');
    expect(r.buyer.name).toBe('Junta de Contratación del Ministerio de Sanidad');
    expect(r.buyer.country).toBe('ESP');
    expect(r.buyer.sourceRef).toBe(
      'junta de contratacion del ministerio de sanidad|ESP',
    );
    expect(r.winner?.name).toBe('Tecnilógica Ecosistemas, S.A.U.');
    expect(r.winnerNif).toBe('A28963767');
    expect(r.value).toBe(433.58);
    expect(r.currency).toBe('EUR');
    expect(r.cpvs).toContain('72000000');
    expect(r.framework).toBe(false);
    expect(r.awardDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.url).toBe('https://ted.europa.eu/en/notice/-/detail/449218-2026');
    expect(r.biddersCount).toBe(1); // max of ['1','1']
  });

  it('takes max submissions count and granular NUTS', () => {
    const rows = parseTedNotice(notices[2]); // Mesa de las Cortes de Aragón
    expect(rows[0].biddersCount).toBe(12); // max of ['12','0','0','2','12']
    expect(rows[0].buyer.nuts).toBe('ES243');
  });
});

describe('parseTedNotice — fixture: framework agreements', () => {
  const notices = loadFixture('ted-search-es-framework.json');

  it('flags fa-wo-rc as framework with explicit dates', () => {
    const rows = parseTedNotice(notices[0]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.framework).toBe(true);
    expect(r.startDate).toBe('2026-06-02');
    expect(r.endDate).toBe('2026-12-31');
    expect(r.awardDate).toBe('2026-05-13'); // winner-decision-date (preferred over conclusion-date 2026-05-27)
  });
});

describe('parseTedNotice — fixture: multi-winner + duration', () => {
  const notices = loadFixture('ted-search-es-multiwinner-duration.json');
  const byRef = Object.fromEntries(notices.map((n) => [n['publication-number'], n]));

  it('emits one row per winner; notice-level value stays null (not fabricated)', () => {
    const rows = parseTedNotice(byRef['539696-2026'] as TedNotice);
    expect(rows.length).toBe(4);
    const names = rows.map((r) => r.winner?.name);
    expect(names).toContain('Seidor Solutions, S.L.');
    expect(names).toContain('RICOH ESPAÑA, S.L.');
    for (const r of rows) {
      expect(r.value).toBeNull();
      expect(r.biddersCount).toBeNull();
      expect(r.sourceRef).toMatch(/^539696-2026#\d$/);
    }
  });

  it('parses 24 MONTH duration and single-winner value', () => {
    const rows = parseTedNotice(byRef['533655-2026'] as TedNotice);
    expect(rows).toHaveLength(1);
    expect(rows[0].durationMonths).toBe(24);
    expect(rows[0].value).toBe(1477338.46);
    expect(rows[0].framework).toBe(false);
  });
});

describe('deriveContractDates', () => {
  it('keeps explicit end date and sets renewal window for frameworks', () => {
    const d = deriveContractDates({
      framework: true,
      durationMonths: null,
      startDate: '2026-06-02',
      endDate: '2026-12-31',
      awardDate: '2026-05-27',
    });
    expect(d.endDate).toBe('2026-12-31');
    expect(d.renewalWindowStart).toBe(addDaysIso('2026-12-31', -90));
    expect(d.renewalWindowEnd).toBe(addDaysIso('2026-12-31', 90));
  });

  it('derives end from duration (non-framework, no cap)', () => {
    const d = deriveContractDates({
      framework: false,
      durationMonths: 24,
      startDate: '2026-07-24',
      endDate: null,
      awardDate: '2026-07-24',
    });
    expect(d.endDate).toBe('2028-07-24');
    expect(d.renewalWindowStart).toBeNull();
  });

  it('caps framework duration at LCSP 48 months when no explicit end', () => {
    const d = deriveContractDates({
      framework: true,
      durationMonths: 72,
      startDate: null,
      endDate: null,
      awardDate: '2026-01-15',
    });
    expect(d.endDate).toBe('2030-01-15'); // 48m cap, not 72m
    const noDuration = deriveContractDates({
      framework: true,
      durationMonths: null,
      startDate: null,
      endDate: null,
      awardDate: '2026-01-15',
    });
    expect(noDuration.endDate).toBe('2030-01-15');
  });

  it('never fabricates: no start/award date and no explicit end → nulls', () => {
    const d = deriveContractDates({
      framework: false,
      durationMonths: 24,
      startDate: null,
      endDate: null,
      awardDate: null,
    });
    expect(d).toEqual({
      startDate: null,
      endDate: null,
      renewalWindowStart: null,
      renewalWindowEnd: null,
    });
  });
});

describe('parseTedNotice — skip rules', () => {
  it('returns [] without publication-number or buyer name', () => {
    expect(parseTedNotice({} as TedNotice)).toEqual([]);
    expect(
      parseTedNotice({ 'publication-number': ['1-2026'] } as unknown as TedNotice),
    ).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  awardsQuerySchema,
  cpvSchema,
  idParamSchema,
  isoDateSchema,
  nutsSchema,
  renewalsQuerySchema,
  searchQuerySchema,
} from '../../src/api/validate.js';

describe('cpvSchema', () => {
  it('accepts CPV codes and prefixes', () => {
    for (const ok of ['72', '72000000', '48000000', '72-1', '72000000-2', '722']) {
      expect(cpvSchema.safeParse(ok).success, ok).toBe(true);
    }
  });
  it('rejects invalid cpv', () => {
    for (const bad of ['7', '720000000', 'abc', '72-', '72-12', '72 00', '']) {
      expect(cpvSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('isoDateSchema', () => {
  it('accepts valid ISO dates', () => {
    expect(isoDateSchema.safeParse('2026-01-31').success).toBe(true);
    expect(isoDateSchema.safeParse('2024-02-29').success).toBe(true);
  });
  it('rejects malformed or impossible dates', () => {
    for (const bad of ['2026-1-1', '31-01-2026', '2026-13-01', '2023-02-29', '2026-02-30', 'yesterday']) {
      expect(isoDateSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('nutsSchema', () => {
  it('accepts NUTS codes/prefixes and uppercases them', () => {
    expect(nutsSchema.parse('es61')).toBe('ES61');
    expect(nutsSchema.parse('ES')).toBe('ES');
    expect(nutsSchema.safeParse('E').success).toBe(false);
    expect(nutsSchema.safeParse('ES6111').success).toBe(false);
  });
});

describe('searchQuerySchema', () => {
  it('applies defaults (type=award, page=1, size=20)', () => {
    const q = searchQuerySchema.parse({});
    expect(q.type).toBe('award');
    expect(q.page).toBe(1);
    expect(q.size).toBe(20);
  });
  it('coerces page/size from strings and caps size at 100', () => {
    const q = searchQuerySchema.parse({ page: '2', size: '100' });
    expect(q.page).toBe(2);
    expect(q.size).toBe(100);
    expect(searchQuerySchema.safeParse({ size: '101' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
  it('rejects overlong q and bad enums', () => {
    expect(searchQuerySchema.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ type: 'lot' }).success).toBe(false);
  });
  it('accepts a full valid query', () => {
    const q = searchQuerySchema.parse({
      q: 'ciberseguridad',
      cpv: '72',
      buyer: 'ayuntamiento',
      company: 'indra',
      region: 'es',
      from: '2025-01-01',
      to: '2025-12-31',
      type: 'tender',
    });
    expect(q.region).toBe('ES');
    expect(q.cpv).toBe('72');
  });
});

describe('renewalsQuerySchema', () => {
  it('defaults window_months=12, min_confidence=low', () => {
    const q = renewalsQuerySchema.parse({});
    expect(q.window_months).toBe(12);
    expect(q.min_confidence).toBe('low');
  });
  it('caps window_months at 36', () => {
    expect(renewalsQuerySchema.safeParse({ window_months: '36' }).success).toBe(true);
    expect(renewalsQuerySchema.safeParse({ window_months: '37' }).success).toBe(false);
  });
});

describe('idParamSchema / awardsQuerySchema', () => {
  it('parses numeric id params', () => {
    expect(idParamSchema.parse({ id: '42' }).id).toBe(42);
    expect(idParamSchema.safeParse({ id: '-1' }).success).toBe(false);
    expect(idParamSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });
  it('paginates awards queries', () => {
    expect(awardsQuerySchema.parse({ page: '3', size: '50' })).toEqual({ page: 3, size: 50 });
  });
});

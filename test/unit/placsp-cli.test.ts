// PLACSP config envs (loadConfig) and CLI source routing (resolveSources).
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { resolveSources } from '../../src/ingest/cli.js';
import { makeTestConfig } from './testconfig.js';

const PLACSP_ENVS = ['PLACSP_ENABLED', 'PLACSP_MAX_PAGES', 'PLACSP_DELAY_MS', 'PLACSP_SCHEDULE'];
const saved = Object.fromEntries(PLACSP_ENVS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of PLACSP_ENVS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('loadConfig PLACSP envs', () => {
  it('defaults: disabled, 5 pages, 500ms delay, no scheduling', () => {
    for (const k of PLACSP_ENVS) delete process.env[k];
    const c = loadConfig();
    expect(c.placsp).toEqual({ enabled: false, maxPages: 5, delayMs: 500, schedule: false });
  });

  it('parses PLACSP_* envs', () => {
    process.env.PLACSP_ENABLED = 'true';
    process.env.PLACSP_MAX_PAGES = '12';
    process.env.PLACSP_DELAY_MS = '1000';
    process.env.PLACSP_SCHEDULE = 'true';
    const c = loadConfig();
    expect(c.placsp).toEqual({ enabled: true, maxPages: 12, delayMs: 1000, schedule: true });
  });
});

describe('resolveSources', () => {
  it('explicit --source wins', () => {
    const c = makeTestConfig();
    expect(resolveSources(c, 'ted')).toEqual(['ted']);
    expect(resolveSources(c, 'placsp')).toEqual(['placsp']);
    expect(resolveSources(c, 'all')).toEqual(['ted', 'placsp']);
  });

  it('default (scheduler/CLI without --source) is TED only', () => {
    expect(resolveSources(makeTestConfig(), undefined)).toEqual(['ted']);
  });

  it('scheduler adds PLACSP only when PLACSP_SCHEDULE and PLACSP_ENABLED', () => {
    const off = makeTestConfig({
      placsp: { enabled: true, maxPages: 5, delayMs: 500, schedule: false },
    });
    expect(resolveSources(off, undefined)).toEqual(['ted']);
    const on = makeTestConfig({
      placsp: { enabled: true, maxPages: 5, delayMs: 500, schedule: true },
    });
    expect(resolveSources(on, undefined)).toEqual(['ted', 'placsp']);
  });
});

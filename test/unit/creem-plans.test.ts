// SME Creem plan products. Ids from the Creative Machine account are fixtures
// for tests and docs only — loadConfig must not default to them.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { validateConfig } from '../../src/config.validate.js';
import { planProductId } from '../../src/pay/creem.js';
import { makeTestConfig } from './testconfig.js';

const PLAN_ENV = [
  'CREEM_PRODUCT_ID_RADAR_MONTHLY',
  'CREEM_PRODUCT_ID_RADAR_ANNUAL',
  'CREEM_PRODUCT_ID_PRO_MONTHLY',
  'CREEM_PRODUCT_ID_PRO_ANNUAL',
  'CREEM_PRODUCT_ID_TEAM_MONTHLY',
] as const;

const TEST_IDS = {
  radarMonthly: 'prod_DQLeAZkGLgSWSBe79doNr',
  radarAnnual: 'prod_39q3c29aWwXvkE4pqU4YUT',
  proMonthly: 'prod_4Iyrui9hjVwSeftMImc9Yg',
  proAnnual: 'prod_3vkS91sGzp4aueHBuRCNEH',
  teamMonthly: 'prod_5z4JBpuINvsVJNU0avrcy0',
};

const LIVE_IDS = [
  'prod_6u3gvUJkvWAoGxaTErNAkX',
  'prod_7gx0yupTdQCxidUSmSdhWx',
  'prod_4G9C8ej8VdeZgrWbY3jWYR',
  'prod_2tukZ9IRVOgeYsZ59Ar59W',
  'prod_PvJQIwYRo0wbntVsrBQVi',
];

const saved = new Map<string, string | undefined>();
for (const key of PLAN_ENV) saved.set(key, process.env[key]);

afterEach(() => {
  for (const key of PLAN_ENV) {
    const orig = saved.get(key);
    if (orig === undefined) delete process.env[key];
    else process.env[key] = orig;
  }
});

describe('Creem plan product config', () => {
  it('defaults every plan product to empty, never to a live or test id', () => {
    for (const key of PLAN_ENV) delete process.env[key];
    const plans = loadConfig().creem.plans!;
    expect(plans).toEqual({
      radarMonthly: '',
      radarAnnual: '',
      proMonthly: '',
      proAnnual: '',
      teamMonthly: '',
    });
    const blob = JSON.stringify(plans);
    for (const id of [...LIVE_IDS, ...Object.values(TEST_IDS)]) {
      expect(blob).not.toContain(id);
    }
  });

  it('reads the five plan variables when they are set', () => {
    process.env.CREEM_PRODUCT_ID_RADAR_MONTHLY = TEST_IDS.radarMonthly;
    process.env.CREEM_PRODUCT_ID_RADAR_ANNUAL = TEST_IDS.radarAnnual;
    process.env.CREEM_PRODUCT_ID_PRO_MONTHLY = TEST_IDS.proMonthly;
    process.env.CREEM_PRODUCT_ID_PRO_ANNUAL = TEST_IDS.proAnnual;
    process.env.CREEM_PRODUCT_ID_TEAM_MONTHLY = TEST_IDS.teamMonthly;
    expect(loadConfig().creem.plans).toEqual(TEST_IDS);
  });

  it('does not require plan product ids when Creem is enabled', () => {
    expect(() =>
      validateConfig(
        makeTestConfig({
          creem: {
            enabled: true,
            apiKey: 'creem_test_placeholder',
            webhookSecret: 'whsec_creem_placeholder',
            productId: 'prod_creem_placeholder',
            priceCents: 2900,
          },
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a plan id that is not a Creem product id', () => {
    expect(() =>
      validateConfig(
        makeTestConfig({
          creem: {
            enabled: true,
            apiKey: 'creem_test_placeholder',
            webhookSecret: 'whsec_creem_placeholder',
            productId: 'prod_creem_placeholder',
            priceCents: 2900,
            plans: { ...TEST_IDS, radarMonthly: 'not-a-product' },
          },
        }),
      ),
    ).toThrow(/CREEM_PRODUCT_ID_RADAR_MONTHLY/);
  });

  it('maps Team annual to no product and Radar annual to its own id', () => {
    const creem = makeTestConfig({ creem: { enabled: true, apiKey: 'x', webhookSecret: 'x', productId: 'prod_legacy', priceCents: 2900, plans: TEST_IDS } }).creem;
    expect(planProductId(creem, 'team', 'annual')).toBe('');
    expect(planProductId(creem, 'team', 'monthly')).toBe(TEST_IDS.teamMonthly);
    expect(planProductId(creem, 'radar', 'annual')).toBe(TEST_IDS.radarAnnual);
    expect(planProductId(creem, 'radar', 'monthly')).not.toBe(creem.productId);
  });

  it('keeps live product ids out of source and records them in the docs', () => {
    const source = [
      'src/config.ts',
      'src/pay/creem.ts',
      'src/api/routes/billing.ts',
      'src/web/pages.ts',
    ].map((path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')).join('\n');
    const docs = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
      + readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    for (const id of LIVE_IDS) {
      expect(source).not.toContain(id);
      expect(docs).toContain(id);
    }
    for (const id of Object.values(TEST_IDS)) expect(docs).toContain(id);
    for (const name of PLAN_ENV) expect(docs).toContain(name);
  });
});

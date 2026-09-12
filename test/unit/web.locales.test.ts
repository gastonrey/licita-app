// SDD slice S1 — i18n infrastructure + es/en locale dictionaries (Part 1).
// Hard contracts (spec R2 + design architecture decision b):
//  - es<->en key-set parity, placeholder parity: a missing/extra key or a
//    mismatched {placeholder} fails the suite (no silent English leak).
//  - t() hard-fails on missing keys and on missing variables.
//  - href() maps human pages to /en for the en locale and keeps dev surfaces
//    (/docs, /v1/*, /mcp, /llms.txt, /openapi.json, ...) bare on both locales.
//  - en dict keeps byte-fidelity of the current English copy for the protected
//    text needles (spec N1 matrix).
import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { registerWeb } from '../../src/web/pages.js';
import { LOCALES, href, localeFromPath, otherLocale, t } from '../../src/web/i18n.js';
import { makeTestConfig } from './testconfig.js';
import { makeTestDb } from './testdb.js';
import type { Db } from '../../src/db/client.js';

/** Recursively list leaf keys as dot paths ("home.heroTitle", "faq.items.x.a"). */
function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string') return [prefix];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => flattenKeys(v, `${prefix}.${i}`));
  if (obj !== null && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

function valueAt(obj: unknown, key: string): string | undefined {
  const v = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj);
  return typeof v === 'string' ? v : undefined;
}

/** Sorted {placeholder} token list for a string. */
function tokens(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe('web.locales — dictionary parity es <-> en', () => {
  it('es and en expose identical key sets (hard parity, no silent leak)', () => {
    const enKeys = flattenKeys(LOCALES.en);
    const esKeys = flattenKeys(LOCALES.es);
    expect(enKeys).toEqual(esKeys);
    // Prove this is a real dictionary: parity over an empty pair is not a GREEN.
    expect(enKeys.length).toBeGreaterThan(100);
  });

  it('placeholder token sets match between locales for every key', () => {
    const esKeys = flattenKeys(LOCALES.es);
    expect(esKeys.length).toBeGreaterThan(100);
    for (const key of esKeys) {
      const en = valueAt(LOCALES.en, key);
      const es = valueAt(LOCALES.es, key);
      expect(en, `en missing value for ${key}`).toBeDefined();
      expect(es, `es missing value for ${key}`).toBeDefined();
      expect(tokens(en as string), `placeholder mismatch on ${key}`).toEqual(tokens(es as string));
    }
  });

  it('en dict keeps byte-fidelity of the protected text needles (spec N1)', () => {
    expect(t('en', 'nav.home')).toBe('Home');
    expect(t('en', 'nav.requestDemo')).toBe('Request demo');
    expect(t('en', 'home.heroTitle')).toBe('Know which public contracts deserve your next conversation.');
    expect(t('en', 'home.builtOn')).toBe('Built on primary sources');
    expect(t('en', 'home.trustStrip.dates.label')).toBe('Not reported when unknown');
    expect(t('en', 'usecases.title')).toBe('Use cases');
    expect(t('en', 'data.overview.h1')).toBe('Data');
    expect(t('en', 'data.spain.h1')).toBe('Data — Spain (PLACSP)');
    expect(t('en', 'data.eu.h1')).toBe('Data — EU (TED)');
    expect(t('en', 'notFound.title')).toBe('Not found');
    expect(t('en', 'pricing.title')).toBe('Pricing');
    expect(t('en', 'footer.provenance')).toContain(
      'Provenance: every data row exposes <code>meta.provenance</code>',
    );
    // Retention copy: exactly 180 days, never "for 30 days".
    expect(t('en', 'home.ctaDemo.body')).toContain('180 days');
    expect(t('en', 'home.faq.items.demoRetention.answer')).toContain('<strong>180 days</strong>');
    expect(t('en', 'trust.privacy.body', { email: 'eutendersai@gmail.com' })).toContain('180 days');
    // Creem needle set lives in the dictionary (monthly card + FAQ answers).
    expect(t('en', 'home.pricing.cards.monthly.desc')).toContain('30 days');
    expect(t('en', 'home.faq.items.accountSubscription.answerCreem')).toContain('kind=creem');
    expect(t('en', 'home.pricing.introCreem')).toContain('no signup');
    expect(t('en', 'home.pricing.intro')).toContain('no subscriptions, no signup');
  });

  it('en dict writes /en prefixed hrefs for human links and bare hrefs for dev surfaces', () => {
    // Human targets are /en-prefixed inside the self-contained en dict (design decision b).
    expect(t('en', 'home.coverage.body')).toContain('href="/en/data"');
    expect(t('en', 'home.coverage.dataLinks')).toContain('href="/en/data/spain"');
    expect(t('en', 'data.overview.bullets.1')).toContain('href="/en/data/eu"');
    expect(t('en', 'data.spain.overviewLink')).toBe('data overview');
    // Dev surfaces stay bare even on the en dict.
    expect(t('en', 'home.pricing.note')).toContain('href="/v1/pricing"');
    expect(t('en', 'home.developers.body')).toContain('href="/llms.txt"');
    expect(t('en', 'usecases.freeBody')).toContain('href="/v1/demo"');
    expect(t('en', 'pricing.intro', { paymentsMode: 'x402', researchPrice: '0.50' })).toContain(
      'href="/v1/pricing"',
    );
  });
});

describe('web.locales — resolver t()', () => {
  it('substitutes {creemPrice}, {researchPrice}, {mcpEndpoint}, {email}, {year}', () => {
    expect(t('en', 'home.pricing.cards.monthly.amountN', { creemPrice: '49.50' })).toBe('€49.50');
    expect(t('en', 'home.pricing.cards.research.amountN', { researchPrice: '0.50' })).toBe('$0.50');
    expect(t('en', 'home.connect.body', { mcpEndpoint: 'https://licita.example/mcp' })).toContain(
      'https://licita.example/mcp',
    );
    expect(t('en', 'footer.copyright', { year: 2026 })).toBe('© 2026 Licita');
    expect(t('en', 'trust.privacy.body', { email: 'eutendersai@gmail.com' })).toContain(
      'mailto:eutendersai@gmail.com',
    );
  });

  it('HARD-fails on a missing key for both locales (R2 — no silent English leak)', () => {
    expect(() => t('en', 'nav.doesNotExist')).toThrow();
    expect(() => t('es', 'home.nope')).toThrow();
    expect(() => t('en', 'nav')).toThrow(); // non-leaf key
  });

  it('HARD-fails on a missing variable and stays byte-exact when provided', () => {
    expect(() => t('en', 'home.connect.body')).toThrow();
    expect(() => t('es', 'home.pricing.cards.monthly.amountN')).toThrow();
    expect(t('es', 'home.connect.body', { mcpEndpoint: 'https://licita.example/mcp' })).toContain(
      'https://licita.example/mcp',
    );
  });
});

describe('web.locales — resolver href()', () => {
  it('en prefixes human pages with /en', () => {
    expect(href('en', '/pricing')).toBe('/en/pricing');
    expect(href('en', '/use-cases/tender-intelligence')).toBe('/en/use-cases/tender-intelligence');
    expect(href('en', '/data/spain')).toBe('/en/data/spain');
    expect(href('en', '/methodology')).toBe('/en/methodology');
    expect(href('en', '/#demo')).toBe('/en#demo');
  });

  it('dev surfaces stay bare on en (/docs, /v1, /mcp, discovery files)', () => {
    for (const p of [
      '/docs',
      '/v1/pricing',
      '/v1/demo',
      '/mcp',
      '/llms.txt',
      '/openapi.json',
      '/styles.css',
      '/sitemap.xml',
      '/robots.txt',
      '/.well-known/mcp/server-card.json',
    ]) {
      expect(href('en', p), `dev surface ${p} must stay bare`).toBe(p);
    }
  });

  it('es keeps every path unchanged (root locale)', () => {
    expect(href('es', '/pricing')).toBe('/pricing');
    expect(href('es', '/docs')).toBe('/docs');
    expect(href('es', '/#demo')).toBe('/#demo');
  });

  it('is idempotent for already-prefixed /en paths', () => {
    expect(href('en', '/en/pricing')).toBe('/en/pricing');
    expect(href('en', '/en')).toBe('/en');
  });
});

describe('web.locales — localeFromPath / otherLocale', () => {
  it('maps /en and /en/* to en and everything else to es', () => {
    expect(localeFromPath('/en')).toBe('en');
    expect(localeFromPath('/en/pricing')).toBe('en');
    expect(localeFromPath('/en/nope')).toBe('en');
    expect(localeFromPath('/')).toBe('es');
    expect(localeFromPath('/pricing')).toBe('es');
    expect(localeFromPath('/v1/nope')).toBe('es');
  });

  it('otherLocale flips both directions', () => {
    expect(otherLocale('en')).toBe('es');
    expect(otherLocale('es')).toBe('en');
  });
});

// --- Part 2 — route-level integration (spec R1/R3/R4/R5, run through the real
// buildServer + registerWeb wiring so the 301 family, the 404 split and the
// head SEO contract are proven as served).
describe('web.locales — route-level integration (Part 2)', () => {
  async function webServer(): Promise<{ app: FastifyInstance; db: Db }> {
    const db = await makeTestDb();
    const config = makeTestConfig({ paymentsMode: 'dev' });
    const app = await buildServer(config, db);
    registerWeb(app, config);
    return { app, db };
  }

  it('R1 301 family: /es, /es/, /es/* and /en/ redirect to the root-locale equivalents, query preserved', async () => {
    const { app, db } = await webServer();
    const cases: Array<[string, string]> = [
      ['/es', '/'],
      ['/es/', '/'],
      ['/es/pricing', '/pricing'],
      ['/es/use-cases/tender-intelligence', '/use-cases/tender-intelligence'],
      ['/es/data/spain?x=1', '/data/spain?x=1'],
      ['/en/', '/en'],
    ];
    for (const [from, to] of cases) {
      const res = await app.inject({ method: 'GET', url: from });
      expect(res.statusCode, `${from} status`).toBe(301);
      expect(res.headers.location, `${from} location`).toBe(to);
    }
    await app.close();
    await db.end();
  });

  it('R4/M2 404 split: locale HTML at web paths, JSON not_found envelope on machine paths', async () => {
    const { app, db } = await webServer();
    const es = await app.inject({ method: 'GET', url: '/nope' });
    expect(es.statusCode).toBe(404);
    expect(es.headers['content-type']).toMatch(/^text\/html/);
    expect(es.body).toContain('<html lang="es">');
    expect(es.body).toContain('No encontrado');
    expect(es.body).toContain('<meta name="robots" content="noindex">');

    const en = await app.inject({ method: 'GET', url: '/en/nope' });
    expect(en.statusCode).toBe(404);
    expect(en.headers['content-type']).toMatch(/^text\/html/);
    expect(en.body).toContain('<html lang="en">');
    expect(en.body).toContain('Not found');
    expect(en.body).toContain('<meta name="robots" content="noindex">');

    for (const url of [
      '/v1/nope',
      '/mcp/nope',
      '/openapi.json/nope',
      '/llms.txt/nope',
      '/robots.txt/nope',
      '/styles.css/nope',
      '/sitemap.xml/nope',
      '/health/nope',
      '/.well-known/nope',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `${url} status`).toBe(404);
      expect(res.headers['content-type'], `${url} content-type`).toMatch(/^application\/json/);
      expect(res.json().error.code, `${url} code`).toBe('not_found');
    }
    await app.close();
    await db.end();
  });

  it('R3 SEO matrix on /pricing + /en/pricing: canonical, hreflang pair, x-default→/, og:locale + alternate, JSON-LD inLanguage', async () => {
    const { app, db } = await webServer();
    const es = await app.inject({ method: 'GET', url: '/pricing' });
    expect(es.statusCode).toBe(200);
    expect(es.body).toContain('<html lang="es">');
    expect(es.body).toContain('<link rel="canonical" href="/pricing">');
    expect(es.body).toContain('<link rel="alternate" hreflang="es" href="/pricing">');
    expect(es.body).toContain('<link rel="alternate" hreflang="en" href="/en/pricing">');
    expect(es.body).toContain('<link rel="alternate" hreflang="x-default" href="/">');
    expect(es.body).toContain('<meta property="og:locale" content="es_ES">');
    expect(es.body).toContain('<meta property="og:locale:alternate" content="en_US">');
    expect(es.body).toContain('"inLanguage": "es"');

    const en = await app.inject({ method: 'GET', url: '/en/pricing' });
    expect(en.statusCode).toBe(200);
    expect(en.body).toContain('<html lang="en">');
    expect(en.body).toContain('<link rel="canonical" href="/en/pricing">');
    expect(en.body).toContain('<link rel="alternate" hreflang="es" href="/pricing">');
    expect(en.body).toContain('<link rel="alternate" hreflang="en" href="/en/pricing">');
    expect(en.body).toContain('<link rel="alternate" hreflang="x-default" href="/">');
    expect(en.body).toContain('<meta property="og:locale" content="en_US">');
    expect(en.body).toContain('<meta property="og:locale:alternate" content="es_ES">');
    expect(en.body).toContain('"inLanguage": "en"');
    await app.close();
    await db.end();
  });

  it('R5 switcher reciprocity: path-preserving reciprocal hrefs on both locales', async () => {
    const { app, db } = await webServer();
    const esPricing = await app.inject({ method: 'GET', url: '/pricing' });
    expect(esPricing.body).toContain(
      '<a class="lang-switch" lang="en" hreflang="en" href="/en/pricing">English</a>',
    );
    const enPricing = await app.inject({ method: 'GET', url: '/en/pricing' });
    expect(enPricing.body).toContain(
      '<a class="lang-switch" lang="es" hreflang="es" href="/pricing">Español</a>',
    );
    const homeEs = await app.inject({ method: 'GET', url: '/' });
    expect(homeEs.body).toContain('<a class="lang-switch" lang="en" hreflang="en" href="/en">English</a>');
    const homeEn = await app.inject({ method: 'GET', url: '/en' });
    expect(homeEn.body).toContain('<a class="lang-switch" lang="es" hreflang="es" href="/">Español</a>');
    await app.close();
    await db.end();
  });

  it('R1 no Accept-Language redirect: / serves Spanish with Accept-Language: en, 200, no Location', async () => {
    const { app, db } = await webServer();
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toContain('<html lang="es">');
    await app.close();
    await db.end();
  });

  it('HOME_SCRIPT stays a frozen single constant, byte-identical on / and /en', async () => {
    const { app, db } = await webServer();
    const grabScript = (body: string) => {
      const start = body.indexOf('<script>const sample=');
      expect(start, 'HOME_SCRIPT start').toBeGreaterThanOrEqual(0);
      const end = body.indexOf('</script>', start);
      return body.slice(start, end);
    };
    const esScript = grabScript((await app.inject({ method: 'GET', url: '/' })).body);
    const enScript = grabScript((await app.inject({ method: 'GET', url: '/en' })).body);
    expect(esScript).toContain("fetch('/v1/demo/request?source=homepage'");
    expect(enScript).toBe(esScript);
    await app.close();
    await db.end();
  });
});
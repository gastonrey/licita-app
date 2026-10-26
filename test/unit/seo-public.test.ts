// Public SEO contract: sitemap line in robots.txt, social cards, unique
// titles and descriptions, and schema that does not name the operator.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { loadConfig } from '../../src/config.js';
import { PUBLIC_PLAN_EUR } from '../../src/domain/public-plans.js';
import { registerWeb } from '../../src/web/pages.js';
import { t } from '../../src/web/i18n.js';
import { makeTestConfig } from './testconfig.js';

const BASE = 'https://licita.example';

const ES_PATHS = [
  '/',
  '/pricing',
  '/radar',
  '/developers',
  '/use-cases',
  '/use-cases/tender-intelligence',
  '/use-cases/company-research',
  '/use-cases/buyer-intelligence',
  '/use-cases/renewals-forecasting',
  '/data',
  '/data/spain',
  '/data/eu',
  '/methodology',
  '/security',
  '/privacy',
  '/terms',
  '/status',
];

function enPath(path: string): string {
  return path === '/' ? '/en' : `/en${path}`;
}

async function webApp(baseUrl = BASE) {
  const app = Fastify({ logger: false });
  registerWeb(app, makeTestConfig({ paymentsMode: 'dev', baseUrl }));
  await app.ready();
  return app;
}

function headOf(html: string): string {
  return html.slice(0, html.indexOf('</head>'));
}

function titleOf(html: string): string {
  const match = html.match(/<title>([^<]*)<\/title>/);
  return match?.[1] ?? '';
}

function descriptionOf(html: string): string {
  const match = html.match(/<meta name="description" content="([^"]*)">/);
  return match?.[1] ?? '';
}

function jsonLd(html: string): { '@graph': Array<Record<string, unknown>> } {
  const match = html.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/);
  if (!match) throw new Error('missing JSON-LD');
  return JSON.parse(match[1]) as { '@graph': Array<Record<string, unknown>> };
}

describe('robots.txt Sitemap', () => {
  it('declares the sitemap on the deployment origin', async () => {
    const app = await webApp();
    const res = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(res.body).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`);
    await app.close();
  });

  it('falls back to a root-relative sitemap when BASE_URL is unset', async () => {
    const app = await webApp('');
    const res = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(res.body).toBe('User-agent: *\nAllow: /\n\nSitemap: /sitemap.xml\n');
    expect(res.body).not.toMatch(/eutendersai\.com/);
    await app.close();
  });
});

describe('Open Graph image', () => {
  it('serves a PNG at /og.png and points every public page at it', async () => {
    const app = await webApp();
    const image = await app.inject({ method: 'GET', url: '/og.png' });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toMatch(/^image\/png/);
    expect(image.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    const home = await app.inject({ method: 'GET', url: '/' });
    const head = headOf(home.body);
    expect(head).toContain(`<meta property="og:image" content="${BASE}/og.png">`);
    expect(head).toContain('<meta property="og:description" content="');
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(head).toContain('<meta name="twitter:title" content="');
    expect(head).toContain(`<meta name="twitter:image" content="${BASE}/og.png">`);
    await app.close();
  });
});

describe('unique titles and descriptions', () => {
  it('gives every Spanish and English public page its own title and description', async () => {
    const app = await webApp();
    const esTitles = new Set<string>();
    const enTitles = new Set<string>();
    const esDescriptions = new Set<string>();
    const enDescriptions = new Set<string>();
    for (const path of ES_PATHS) {
      const es = await app.inject({ method: 'GET', url: path });
      const en = await app.inject({ method: 'GET', url: enPath(path) });
      const esTitle = titleOf(es.body);
      const enTitle = titleOf(en.body);
      const esDescription = descriptionOf(es.body);
      const enDescription = descriptionOf(en.body);
      expect(esTitle, path).toMatch(/ — Relicita$/);
      expect(enTitle, enPath(path)).toMatch(/ — Relicita$/);
      expect(esTitle.length, path).toBeLessThanOrEqual(70);
      expect(enTitle.length, enPath(path)).toBeLessThanOrEqual(70);
      expect(esDescription.length, path).toBeGreaterThan(40);
      expect(enDescription.length, enPath(path)).toBeGreaterThan(40);
      expect(esTitles.has(esTitle), esTitle).toBe(false);
      expect(enTitles.has(enTitle), enTitle).toBe(false);
      expect(esDescriptions.has(esDescription), esDescription).toBe(false);
      expect(enDescriptions.has(enDescription), enDescription).toBe(false);
      esTitles.add(esTitle);
      enTitles.add(enTitle);
      esDescriptions.add(esDescription);
      enDescriptions.add(enDescription);
      expect(es.body, path).not.toContain('Use case:');
    }
    const docs = await app.inject({ method: 'GET', url: '/docs' });
    expect(titleOf(docs.body)).toBe('Tender API docs: x402, credits, MCP — Relicita');
    expect(enTitles.has(titleOf(docs.body))).toBe(false);
    await app.close();
  });
});

describe('JSON-LD', () => {
  it('adds Organization without personal data, FAQPage on FAQ pages, and Offers on pricing', async () => {
    const app = await webApp();
    const home = jsonLd((await app.inject({ method: 'GET', url: '/' })).body);
    const types = (node: Record<string, unknown>) => (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]);
    expect(home['@graph'].some((node) => types(node).includes('Organization'))).toBe(true);
    expect(home['@graph'].some((node) => types(node).includes('FAQPage'))).toBe(true);
    const org = home['@graph'].find((node) => types(node).includes('Organization'));
    expect(JSON.stringify(org)).not.toMatch(/email|founder|address|telephone|gaston|gmail|Person/i);

    const developers = jsonLd((await app.inject({ method: 'GET', url: '/developers' })).body);
    expect(developers['@graph'].some((node) => types(node).includes('FAQPage'))).toBe(true);
    const pricing = jsonLd((await app.inject({ method: 'GET', url: '/pricing' })).body);
    const product = pricing['@graph'].find((node) => types(node).includes('Product'));
    expect(product).toBeDefined();
    const offers = product?.offers as Array<{ '@type': string; price: string; priceCurrency: string }>;
    expect(offers.map((offer) => offer.price)).toEqual(['0', '39', '99', '199']);
    expect(offers.every((offer) => offer['@type'] === 'Offer' && offer.priceCurrency === 'EUR')).toBe(true);
    expect(pricing['@graph'].some((node) => types(node).includes('FAQPage'))).toBe(false);

    const data = jsonLd((await app.inject({ method: 'GET', url: '/data' })).body);
    expect(data['@graph'].some((node) => types(node).includes('FAQPage'))).toBe(false);
    await app.close();
  });
});

describe('public price coherence', () => {
  it('shows 39 € on /pricing and hides the legacy cents variable, matching the catalog', async () => {
    const app = Fastify({ logger: false });
    registerWeb(
      app,
      makeTestConfig({
        creem: { enabled: true, apiKey: 'creem_test_x', webhookSecret: 'whsec_x', productId: 'prod_x', priceCents: 2900 },
      }),
    );
    const es = await app.inject({ method: 'GET', url: '/pricing' });
    const en = await app.inject({ method: 'GET', url: '/en/pricing' });
    expect(es.body).toContain('39 €');
    expect(es.body).toContain('39 €/mes');
    expect(en.body).toContain('€39');
    expect(en.body).toContain('€39/month');
    for (const body of [es.body, en.body]) {
      expect(body).not.toContain('CREEM_PRICE_CENTS');
      expect(body).not.toContain('€29.00');
      expect(body).not.toContain('29.00/mes');
    }
    expect(t('es', 'plans.radar.price')).toBe(`${PUBLIC_PLAN_EUR.radarMonthly} €`);
    expect(t('en', 'plans.radar.price')).toBe(`€${PUBLIC_PLAN_EUR.radarMonthly}`);
    await app.close();
  });

  it('defaults CREEM_PRICE_CENTS to the public Radar price', () => {
    const previous = process.env.CREEM_PRICE_CENTS;
    delete process.env.CREEM_PRICE_CENTS;
    try {
      expect(loadConfig().creem.priceCents).toBe(PUBLIC_PLAN_EUR.radarMonthly * 100);
    } finally {
      if (previous === undefined) delete process.env.CREEM_PRICE_CENTS;
      else process.env.CREEM_PRICE_CENTS = previous;
    }
  });
});

describe('public brand versus technical ids', () => {
  it('renames display titles to Relicita and keeps registry and package ids', () => {
    const server = JSON.parse(readFileSync('server.json', 'utf8')) as { name: string; title: string };
    const glama = JSON.parse(readFileSync('glama.json', 'utf8')) as { name: string; title: string };
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string };
    expect(server.title).toBe('Relicita');
    expect(server.name).toBe('io.github.gastonrey/licita-app');
    expect(glama.title).toContain('Relicita');
    expect(glama.name).toBe('licita');
    expect(pkg.name).toBe('licita-agent');
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('Relicita');
    expect(readme).not.toMatch(/\bLicita is listed\b/);
  });
});

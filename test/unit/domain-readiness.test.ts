// fiat-revenue-rails Slice A — domain-readiness (spec DR3 sitemap.xml,
// DR4 canonical/OG/meta head; byte-safe §5 needles). All assertions run
// through the real registerWeb routes so head output and sitemap are proven
// as served.

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerWeb } from '../../src/web/pages.js';
import { makeTestConfig } from './testconfig.js';

const BASE = 'https://licita.example';

async function webApp(baseUrl = BASE) {
  const app = Fastify({ logger: false });
  registerWeb(app, makeTestConfig({ paymentsMode: 'dev', baseUrl }));
  await app.ready();
  return app;
}

describe('GET /sitemap.xml (DR3)', () => {
  it('returns 200 application/xml urlset with absolute baseUrl-derived page URLs', async () => {
    const app = await webApp();
    const res = await app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/xml/);
    expect(res.body).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(res.body).toContain('</urlset>');
    for (const path of [
      '/', '/pricing', '/docs', '/use-cases', '/use-cases/tender-intelligence',
      '/data', '/data/spain', '/data/eu', '/methodology', '/security', '/privacy', '/terms', '/status',
    ]) {
      expect(res.body, `loc for ${path}`).toContain(`<loc>${BASE}${path}</loc>`);
    }
    // Machine channels are not indexable pages — never listed.
    expect(res.body).not.toContain(`<loc>${BASE}/mcp</loc>`);
    expect(res.body).not.toContain('/llms.txt');
    expect(res.body).not.toContain('/openapi.json');
    await app.close();
  });

  it('falls back to root-relative locs with no hardcoded host when BASE_URL is unset', async () => {
    const app = await webApp('');
    const res = await app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<loc>/pricing</loc>');
    // Every loc is root-relative. (The <urlset> xmlns namespace URI is the
    // required sitemaps.org schema identifier, not a deployment host — it
    // legitimately contains "http://".)
    expect(res.body).not.toMatch(/<loc>[^<]*https?:\/\//);
    expect(res.body).not.toMatch(/duckdns|eutenders|licita\.app/);
    await app.close();
  });
});

describe('page() head: canonical + OG + meta description (DR4)', () => {
  it('renders per-path canonical, og:url, og:title/og:type and description on the homepage', async () => {
    const app = await webApp();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`<link rel="canonical" href="${BASE}/">`);
    expect(res.body).toContain(`<meta property="og:url" content="${BASE}/">`);
    expect(res.body).toContain('<meta property="og:type" content="website">');
    expect(res.body).toContain('<meta property="og:site_name" content="Licita">');
    expect(res.body).toContain('<meta property="og:title" content="');
    expect(res.body).toContain('<meta name="description" content="');
    await app.close();
  });

  it('renders per-path canonical/og:url for docs, pricing and data pages', async () => {
    const app = await webApp();
    for (const path of ['/docs', '/pricing', '/data']) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.body, `${path} canonical`).toContain(`<link rel="canonical" href="${BASE}${path}">`);
      expect(res.body, `${path} og:url`).toContain(`<meta property="og:url" content="${BASE}${path}">`);
    }
    await app.close();
  });

  it('keeps the existing head lines byte-identical (charset/viewport/theme-color + stylesheet order)', async () => {
    const app = await webApp();
    const res = await app.inject({ method: 'GET', url: '/' });
    const head = res.body.slice(0, res.body.indexOf('</head>'));
    expect(head).toContain('<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="theme-color" content="#F6F3EA">');
    // §5 needle: stylesheet link present and BEFORE any canonical/og additions and the title.
    expect(head).toContain('<link rel="stylesheet" href="/styles.css">');
    expect(head.indexOf('<link rel="stylesheet" href="/styles.css">')).toBeLessThan(head.indexOf('<link rel="canonical"'));
    expect(head.indexOf('<link rel="stylesheet" href="/styles.css">')).toBeLessThan(head.indexOf('<title>'));
    await app.close();
  });

  it('emits root-relative canonical/og:url without a hardcoded host when BASE_URL is unset', async () => {
    const app = await webApp('');
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.body).toContain('<link rel="canonical" href="/docs">');
    expect(res.body).toContain('<meta property="og:url" content="/docs">');
    // No hardcoded deployment host. (The public contact email
    // eutendersai@gmail.com is an address, not a host — hence eutenders\.)
    expect(res.body).not.toMatch(/duckdns|licita\.app|eutenders\./);
    await app.close();
  });
});

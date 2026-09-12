// S2.1 — dual-locale homepage contract tests (bilingual-es-en-ux-refresh).
//
// Root (/) serves Spanish; /en serves English. Contract and attribute needles
// (markup classes, form attributes, endpoint strings, CSS link) assert on BOTH
// locales; human text needles assert ES at root and EN at /en. The language
// switcher and the <html lang> attribute are first-class assertions.
//
// Tests are written RED (pass only after S2.2 implements the content flip).

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppConfig } from '../../src/config.js';
import { registerWeb } from '../../src/web/pages.js';
import { makeTestConfig } from './testconfig.js';

async function page(url: string, overrides: Partial<AppConfig> = {}): Promise<ReturnType<Fastify['inject']>> {
  const app = Fastify({ logger: false });
  registerWeb(app, makeTestConfig({ paymentsMode: 'dev', ...overrides }));
  const res = await app.inject({ method: 'GET', url });
  await app.close();
  return res;
}

const CREEM_ON: Partial<AppConfig> = {
  creem: { enabled: true, apiKey: 'creem_test_x', webhookSecret: 'whsec_x', productId: 'prod_x', priceCents: 4950 },
};

// Needles shared by both locales: deterministic markup, form contract,
// endpoint references — never translated, never changed by the content flip.
const CONTRACT_NEEDLES = [
  'evidence-rail',
  'skip-link',
  'action="/v1/demo/request"',
  "fetch('/v1/demo/request?source=homepage'",
  'type="email"',
  'autocomplete="email"',
  'inputmode="email"',
  'spellcheck="false"',
  'aria-live="polite"',
  'site-footer',
  'x-client-key',
  'source_metadata',
  'evidence-lines',
  '<link rel="stylesheet" href="/styles.css">',
  'POST /v1/research',
  'TED',
  'PLACSP',
];

describe('human homepage (Spanish at /, English at /en)', () => {
  it('serves ES at / and EN at /en with correct lang, text, contract and switcher needles', async () => {
    const locales = [
      {
        url: '/',
        lang: 'es',
        hero: 'Descubre qué contratos públicos merecen tu próxima conversación.',
        builtOn: 'Construido sobre fuentes primarias',
        lastIngestion: 'última ingesta con éxito',
        notReported: 'No consta',
        days: '180 días',
        evidenceRef: 'enlace al origen',
        footer: ['Metodología', 'Seguridad', 'Términos', 'Estado'],
        research: 'Informe de investigación',
        switchTo: 'en',
        switchLabel: 'English',
      },
      {
        url: '/en',
        lang: 'en',
        hero: 'Know which public contracts deserve your next conversation',
        builtOn: 'Built on primary sources',
        lastIngestion: 'last successful ingestion',
        notReported: 'Not reported',
        days: '180 days',
        evidenceRef: 'upstream',
        footer: ['Methodology', 'Security', 'Terms', 'Status'],
        research: 'Research brief',
        switchTo: 'es',
        switchLabel: 'Español',
      },
    ] as const;

    for (const l of locales) {
      const res = await page(l.url);
      expect(res.statusCode, `${l.url} status`).toBe(200);
      expect(res.body, `${l.url} lang`).toContain(`<html lang="${l.lang}">`);
      // Human text needles (locale-specific).
      expect(res.body, `${l.url} hero`).toContain(l.hero);
      expect(res.body, `${l.url} builtOn`).toContain(l.builtOn);
      expect(res.body, `${l.url} lastIngestion`).toContain(l.lastIngestion);
      expect(res.body, `${l.url} notReported`).toContain(l.notReported);
      expect(res.body, `${l.url} days`).toContain(l.days);
      expect(res.body, `${l.url} evidenceRef`).toContain(l.evidenceRef);
      for (const f of l.footer) expect(res.body, `${l.url} footer ${f}`).toContain(f);
      expect(res.body, `${l.url} research`).toContain(l.research);
      // Language switcher marks the OTHER locale.
      expect(res.body, `${l.url} switcher`).toContain('class="lang-switch"');
      expect(res.body, `${l.url} switcher lang`).toContain(`lang="${l.switchTo}"`);
      expect(res.body, `${l.url} switcher hreflang`).toContain(`hreflang="${l.switchTo}"`);
      expect(res.body, `${l.url} switcher label`).toContain(`>${l.switchLabel}</a>`);
      // Contract needles on both locales.
      for (const needle of CONTRACT_NEEDLES) {
        expect(res.body, `${l.url} missing "${needle}"`).toContain(needle);
      }
      // No cross-locale hero leak.
      if (l.lang === 'es') {
        expect(res.body).not.toContain('Know which public contracts deserve your next conversation');
      } else {
        expect(res.body).not.toContain('Descubre qué contratos públicos merecen tu próxima conversación.');
      }
    }
  });

  it('renders a truthful no-JS success state from the redirect query on both locales', async () => {
    const es = await page('/?demo=success');
    expect(es.body).toContain('Solicitud de demo recibida');
    expect(es.body).toContain('no se ha reservado ninguna reunión');
    const en = await page('/en?demo=success');
    expect(en.body).toContain('Demo request received');
    expect(en.body).toContain('no meeting was booked');
  });

  it('states the real demo-retention rule on the privacy page in both locales', async () => {
    const esPrivacy = await page('/privacy');
    expect(esPrivacy.statusCode).toBe(200);
    expect(esPrivacy.body).toContain('180 días');
    expect(esPrivacy.body).not.toContain('for 30 days');
    expect(esPrivacy.body).toContain('contactado, usado, pagado o perdido');

    const enPrivacy = await page('/en/privacy');
    expect(enPrivacy.statusCode).toBe(200);
    expect(enPrivacy.body).toContain('180 days');
    expect(enPrivacy.body).not.toContain('for 30 days');
    expect(enPrivacy.body).toContain('contacted, used, paid or lost');
  });

  it('homepage advertises the creem monthly plan with a config-derived price when enabled, on both locales (B2.6)', async () => {
    const es = await page('/', CREEM_ON);
    expect(es.body).toContain('Plan mensual');
    expect(es.body).toContain('€49.50'); // derived from CREEM_PRICE_CENTS=4950
    expect(es.body).toContain('POST /v1/creem/checkout');
    expect(es.body).toContain('kind=creem');
    expect(es.body).toContain('30 días');
    expect(es.body).not.toContain('Monthly plan');
    expect(es.body).not.toContain('sin suscripciones, sin registro'); // creem intro replaces the no-subscription line

    const en = await page('/en', CREEM_ON);
    expect(en.body).toContain('Monthly plan');
    expect(en.body).toContain('€49.50');
    expect(en.body).toContain('POST /v1/creem/checkout');
    expect(en.body).toContain('kind=creem');
    expect(en.body).toContain('30 days');
    expect(en.body).toContain('pay-per-call');
    expect(en.body).not.toContain('no subscriptions, no signup');
  });

  it('homepage keeps the no-subscription framing on both locales when creem is disabled', async () => {
    const es = await page('/');
    expect(es.body).toContain('sin suscripciones, sin registro');
    expect(es.body).toContain('Informe de investigación');
    expect(es.body).not.toContain('Plan mensual');

    const en = await page('/en');
    expect(en.body).toContain('no subscriptions, no signup');
    expect(en.body).toContain('Research brief');
    expect(en.body).not.toContain('Monthly plan');
  });

  it('serves the demo sample script byte-identical on both locales', async () => {
    const es = await page('/');
    const en = await page('/en');
    const extract = (body: string): string => {
      const start = body.indexOf('<script>const sample=document.getElementById');
      expect(start, 'demo sample script start').toBeGreaterThan(-1);
      const end = body.indexOf('</script>', start);
      expect(end, 'demo sample script end').toBeGreaterThan(start);
      return body.slice(start, end);
    };
    const esScript = extract(es.body);
    const enScript = extract(en.body);
    expect(esScript.length).toBeGreaterThan(1000); // non-trivial, real content
    expect(enScript).toBe(esScript); // byte-identical in both locales
  });
});
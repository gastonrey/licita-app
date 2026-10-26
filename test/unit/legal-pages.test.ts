// Legal pages: /legal and /en/legal, footer link, and the claims that must
// match the product (identity, 12-month signup purge, no tracking cookies).

import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { registerWeb } from '../../src/web/pages.js';
import { makeTestConfig } from './testconfig.js';
import { makeTestDb } from './testdb.js';

async function page(url: string): Promise<{ statusCode: number; body: string }> {
  const db = await makeTestDb();
  const app = await buildServer(makeTestConfig({ paymentsMode: 'dev' }), db);
  registerWeb(app, makeTestConfig({ paymentsMode: 'dev' }));
  const res = await app.inject({ method: 'GET', url });
  await app.close();
  await db.end();
  return { statusCode: res.statusCode, body: res.body };
}

describe('legal notice', () => {
  it('serves the LSSI identity in Spanish and English and links it from the footer', async () => {
    const es = await page('/legal');
    expect(es.statusCode).toBe(200);
    expect(es.body).toContain('<html lang="es">');
    expect(es.body).toContain('Gastón Leonardo Rey Fernández');
    expect(es.body).toContain('02769985A');
    expect(es.body).toContain('Pobla de Segur 15, 3C, 28033 Madrid');
    expect(es.body).toContain('mailto:hola@eutendersai.com');
    expect(es.body).toContain('inteligencia de contratación pública');
    expect(es.body).toContain('MIT');
    expect(es.body).toContain('octubre de 2026');
    expect(es.body).toContain('href="/legal">Aviso legal</a>');

    const en = await page('/en/legal');
    expect(en.statusCode).toBe(200);
    expect(en.body).toContain('<html lang="en">');
    expect(en.body).toContain('02769985A');
    expect(en.body).toContain('href="/en/legal">Legal notice</a>');
    expect(en.body).toContain('October 2026');
  });

  it('states the real retention, processors, rights and the absence of tracking cookies', async () => {
    const es = await page('/privacy');
    expect(es.body).toContain('12 meses');
    expect(es.body).toContain('Hetzner');
    expect(es.body).toContain('Cloudflare');
    expect(es.body).toContain('Resend');
    expect(es.body).toContain('Creem');
    expect(es.body).toContain('Merchant of Record');
    expect(es.body).toContain('x402');
    expect(es.body).toContain('cláusulas contractuales tipo');
    expect(es.body).toContain('portabilidad');
    expect(es.body).toContain('un mes');
    expect(es.body).toContain('www.aepd.es');
    expect(es.body).toContain('no instala cookies');
    expect(es.body).toContain('/radar/baja');
    expect(es.body).not.toContain('eutendersai@gmail.com');
  });

  it('identifies the provider, Spanish venue, B2B scope and the proposed refund', async () => {
    const es = await page('/terms');
    expect(es.body).toContain('02769985A');
    expect(es.body).toContain('empresas y profesionales');
    expect(es.body).toContain('Madrid');
    expect(es.body).toContain('14 días');
    expect(es.body).toContain('Merchant of Record');
    expect(es.body).toContain('octubre de 2026');
    expect(es.body).toContain('no tiene un endpoint propio de reembolso');
  });
});

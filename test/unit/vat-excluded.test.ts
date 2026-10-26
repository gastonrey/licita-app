// Paid plan prices are net of VAT. Creem adds 21% at checkout
// (39 € + IVA = 47,19 €). The suffix sits next to those prices in both
// locales. price_monthly_cents stays the net amount.

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { buildPricing } from '../../src/api/routes/pricing.js';
import { registerWeb } from '../../src/web/pages.js';
import { makeTestConfig } from './testconfig.js';

const VAT_NOTE = 'Subscription prices exclude VAT (+ VAT). Creem adds 21% VAT at checkout.';

async function html(url: string) {
  const app = Fastify({ logger: false });
  registerWeb(app, makeTestConfig({ paymentsMode: 'dev' }));
  const res = await app.inject({ method: 'GET', url });
  await app.close();
  return res;
}

describe('VAT is excluded from paid plan prices', () => {
  it('adds vat_note on /v1/pricing without changing price_monthly_cents', () => {
    const off = buildPricing('dev');
    expect(off.subscription.vat_note).toBe(VAT_NOTE);
    expect(off.subscription.price_monthly_cents).toBeUndefined();

    const on = buildPricing('dev', { enabled: true, priceCents: 4950 });
    expect(on.subscription.vat_note).toBe(VAT_NOTE);
    expect(on.subscription.price_monthly_cents).toBe(4950);
    expect(on.subscription.price_monthly).toBe('49.50');
  });

  it('places + IVA next to paid plan prices in Spanish and leaves the free plan unmarked', async () => {
    for (const url of ['/', '/pricing', '/terms', '/developers']) {
      const res = await html(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('+ IVA');
      expect(res.body, url).toContain('47,19');
    }
    const pricing = await html('/pricing');
    expect(pricing.body).toContain('<span class="n">39 €</span><span class="u">+ IVA</span>');
    expect(pricing.body).toContain('<span class="n">99 €</span><span class="u">+ IVA</span>');
    expect(pricing.body).toContain('<span class="n">199 €</span><span class="u">+ IVA</span>');
    expect(pricing.body).not.toContain('<span class="n">0 €</span><span class="u">+ IVA</span>');
    expect(pricing.body).toContain('390 € + IVA');
    expect(pricing.body).toContain('990 € + IVA');
    expect(pricing.body).toContain('39 € + IVA/mes');
    expect(pricing.body).not.toContain('$0.25 + IVA');
  });

  it('places + VAT next to paid plan prices in English', async () => {
    for (const url of ['/en', '/en/pricing', '/en/terms', '/en/developers', '/docs']) {
      const res = await html(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('+ VAT');
      expect(res.body, url).toContain('47.19');
    }
    const pricing = await html('/en/pricing');
    expect(pricing.body).toContain('<span class="n">€39</span><span class="u">+ VAT</span>');
    expect(pricing.body).toContain('<span class="n">€99</span><span class="u">+ VAT</span>');
    expect(pricing.body).toContain('<span class="n">€199</span><span class="u">+ VAT</span>');
    expect(pricing.body).not.toContain('<span class="n">€0</span><span class="u">+ VAT</span>');
    expect(pricing.body).toContain('€390 + VAT');
    expect(pricing.body).toContain('€990 + VAT');
    expect(pricing.body).toContain('€39 + VAT/month');
    expect(pricing.body).not.toContain('$0.25 + VAT');
  });

  it('keeps + IVA / + VAT on the Creem monthly line when checkout is enabled', async () => {
    const app = Fastify({ logger: false });
    registerWeb(
      app,
      makeTestConfig({
        creem: { enabled: true, apiKey: 'creem_test_x', webhookSecret: 'whsec_x', productId: 'prod_x', priceCents: 4950 },
      }),
    );
    const es = await app.inject({ method: 'GET', url: '/pricing' });
    const en = await app.inject({ method: 'GET', url: '/en/pricing' });
    const docs = await app.inject({ method: 'GET', url: '/docs' });
    expect(es.body).toContain('39 €/mes + IVA');
    expect(es.body).not.toContain('€49.50');
    expect(en.body).toContain('€39/month + VAT');
    expect(docs.body).toContain('€49.50/month + VAT');
    expect(docs.body).toContain('€39/month + VAT');
    await app.close();
  });

  it('marks paid Offers as excluding VAT and keeps the net price', async () => {
    const res = await html('/pricing');
    const match = res.body.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/);
    expect(match).not.toBeNull();
    const graph = JSON.parse(match![1]) as { '@graph': Array<Record<string, unknown>> };
    const product = graph['@graph'].find((node) => node['@type'] === 'Product');
    const offers = product?.offers as Array<{
      price: string;
      priceSpecification?: { '@type': string; price: string; priceCurrency: string; valueAddedTaxIncluded: boolean };
    }>;
    expect(offers.map((offer) => offer.price)).toEqual(['0', '39', '99', '199']);
    const free = offers.find((offer) => offer.price === '0');
    expect(free?.priceSpecification).toBeUndefined();
    for (const offer of offers.filter((item) => item.price !== '0')) {
      expect(offer.priceSpecification).toEqual({
        '@type': 'UnitPriceSpecification',
        price: offer.price,
        priceCurrency: 'EUR',
        valueAddedTaxIncluded: false,
      });
    }
  });
});

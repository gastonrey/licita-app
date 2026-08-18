// P0.8 pricing abstraction: config-driven overrides (RESEARCH_PRICE_USD) win
// over ENDPOINT_PRICES, both providers honor them, and the dev faucet prices
// the research endpoint through the same seam.

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import { ENDPOINT_PRICES } from '../../src/domain/types.js';
import { priceOverrides, resolvePrice } from '../../src/pay/prices.js';
import { createPaymentProvider } from '../../src/pay/provider.js';
import { DevPaymentProvider, registerDevFaucet } from '../../src/pay/devProvider.js';
import { X402PaymentProvider } from '../../src/pay/x402Provider.js';
import { makeTestConfig } from './testconfig.js';

const PAY_TO = '0x3bF0F00f4c8e46CA4bFEa5D77cCDdCFC95c5ac5E';

function makeDb(): Db {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  return new Pool() as unknown as Db;
}

describe('resolvePrice / priceOverrides', () => {
  it('wins in the order: override → ENDPOINT_PRICES → "0.00"', () => {
    const overrides = { 'POST /v1/research': '0.50' };
    expect(resolvePrice(overrides, 'POST /v1/research')).toBe('0.50');
    expect(resolvePrice(overrides, 'GET /v1/search')).toBe(ENDPOINT_PRICES['GET /v1/search']);
    expect(resolvePrice(overrides, 'GET /v1/demo')).toBe('0.00');
    expect(resolvePrice(undefined, 'GET /v1/pricing')).toBe('0.00');
    expect(resolvePrice(undefined, 'GET /nope')).toBe('0.00');
  });

  it('priceOverrides maps only the config-owned research price', () => {
    const config = makeTestConfig({ researchPriceUsd: '0.75' });
    expect(priceOverrides(config)).toEqual({ 'POST /v1/research': '0.75' });
  });
});

describe('providers honor config-driven overrides', () => {
  it('DevPaymentProvider price/createToken/requiredResponse use the override', async () => {
    const db = makeDb();
    await db.query(
      `CREATE TABLE payments (
        id bigserial PRIMARY KEY, client_id bigint,
        endpoint text NOT NULL, amount_usd numeric NOT NULL,
        provider text NOT NULL, proof text UNIQUE NOT NULL, status text NOT NULL
      )`,
    );
    const provider = new DevPaymentProvider({
      secret: 's',
      db,
      prices: { 'POST /v1/research': '0.50' },
    });
    expect(provider.price('POST /v1/research')).toBe('0.50');
    expect(provider.requiredResponse('POST /v1/research').accepts[0].amount).toBe('0.50');
    const { token } = provider.createToken('POST /v1/research');
    expect((await provider.verify(token, 'POST /v1/research')).amount).toBe('0.50');
  });

  it('verify rejects a token whose amount no longer matches the override', async () => {
    const db = makeDb();
    await db.query(
      `CREATE TABLE payments (
        id bigserial PRIMARY KEY, client_id bigint,
        endpoint text NOT NULL, amount_usd numeric NOT NULL,
        provider text NOT NULL, proof text UNIQUE NOT NULL, status text NOT NULL
      )`,
    );
    const mint = new DevPaymentProvider({ secret: 's', db, prices: { 'POST /v1/research': '0.50' } });
    const { token } = mint.createToken('POST /v1/research');
    const reprice = new DevPaymentProvider({ secret: 's', db, prices: { 'POST /v1/research': '0.99' } });
    expect(await reprice.verify(token, 'POST /v1/research')).toEqual({
      ok: false,
      reason: 'amount_mismatch',
    });
  });

  it('X402PaymentProvider resolves research through the override', () => {
    const provider = new X402PaymentProvider(
      { facilitatorUrl: 'https://facilitator.test', payTo: PAY_TO, network: 'eip155:84532' },
      undefined,
      { prices: { 'POST /v1/research': '0.50' } },
    );
    expect(provider.price('POST /v1/research')).toBe('0.50');
    expect(provider.price('GET /v1/search')).toBe(ENDPOINT_PRICES['GET /v1/search']);
    expect(provider.requiredResponse('POST /v1/research').hint).toContain('$0.50');
  });

  it('createPaymentProvider injects priceOverrides for both modes', () => {
    const dev = createPaymentProvider(makeTestConfig({ researchPriceUsd: '0.50' }), makeDb());
    expect(dev.price('POST /v1/research')).toBe('0.50');
    const x402 = createPaymentProvider(
      makeTestConfig({
        paymentsMode: 'x402',
        researchPriceUsd: '0.50',
        x402: { facilitatorUrl: 'https://facilitator.test', payTo: PAY_TO, network: 'eip155:84532' },
      }),
      makeDb(),
    );
    expect(x402.name).toBe('x402');
    expect(x402.price('POST /v1/research')).toBe('0.50');
  });
});

describe('dev faucet prices research via the seam', () => {
  it('POST /v1/dev-faucet mints research tokens at the override price', async () => {
    const config = makeTestConfig({ payHmacSecret: 's', researchPriceUsd: '0.50' });
    const app = Fastify({ logger: false });
    registerDevFaucet(app, config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev-faucet',
      payload: { endpoint: 'POST /v1/research' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ endpoint: 'POST /v1/research', amount: '0.50' });
  });

  it('rejects free endpoints with a clear message', async () => {
    const config = makeTestConfig({ payHmacSecret: 's', researchPriceUsd: '0.50' });
    const app = Fastify({ logger: false });
    registerDevFaucet(app, config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev-faucet',
      payload: { endpoint: 'GET /v1/demo' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('free');
  });

  it('rejects unknown endpoint keys', async () => {
    const config = makeTestConfig({ payHmacSecret: 's', researchPriceUsd: '0.50' });
    const app = Fastify({ logger: false });
    registerDevFaucet(app, config);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev-faucet',
      payload: { endpoint: 'GET /nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Unknown endpoint');
  });
});
// P2 prepaid credit bundles: atomic balance debit from the REST payment
// middleware (x-client-key header), the /v1/billing REST routes, the
// concurrent double-spend guard, and the MCP mirror (client_key debit +
// billing_get_balance + billing_purchase_credits).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../src/config.js';
import type { Db } from '../../src/db/client.js';
import { buildServer } from '../../src/api/server.js';
import { buildMcpServer } from '../../src/mcp/server.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { DevPaymentProvider } from '../../src/pay/devProvider.js';
import { makeTestConfig } from './testconfig.js';
import { makeTestDb } from './testdb.js';

const SECRET = 'billing-test-secret';
const config: AppConfig = makeTestConfig({ payHmacSecret: SECRET, operatorKey: 'op' });

async function seedAccount(db: Db, key: string, cents: number): Promise<void> {
  await db.query('INSERT INTO credit_accounts (client_key, balance_cents) VALUES ($1, $2)', [key, cents]);
}

async function balanceOf(db: Db, key: string): Promise<number> {
  const res = await db.query('SELECT balance_cents FROM credit_accounts WHERE client_key = $1', [key]);
  return res.rows.length === 0 ? -1 : Number(res.rows[0].balance_cents);
}

/** Minimal tender + source row so get_tender returns data on the pg-mem testdb. */
async function seedTender(db: Db): Promise<void> {
  await db.query(`INSERT INTO sources (id, code, name) VALUES (1, 'ted', 'TED')`);
  await db.query(
    `INSERT INTO tenders (id, source_id, source_ref, notice_type, publication_date, title)
     VALUES (7, 1, '123-2026', 'can-standard', '2026-01-15', 'Suministro de software')`,
  );
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function parseText(result: ToolCallResult): Record<string, unknown> {
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('prepaid credit debit (REST paymentPreHandler)', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = await makeTestDb();
    app = await buildServer(config, db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('debits the balance when x-client-key is present and funds suffice', async () => {
    await seedAccount(db, 'agent-1', 500);
    await seedTender(db);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tenders/7',
      headers: { 'x-client-key': 'agent-1' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe(7);
    expect(body.meta.paid).toBe(true);
    expect(body.meta.price_usd).toBe('0.02');
    expect(await balanceOf(db, 'agent-1')).toBe(498);
    const pays = await db.query('SELECT provider, endpoint, amount_usd, status FROM payments');
    expect(pays.rows).toHaveLength(1);
    expect(pays.rows[0]).toMatchObject({
      provider: 'credit',
      endpoint: 'GET /v1/tenders/:id',
      status: 'success',
    });
    expect(Number(pays.rows[0].amount_usd)).toBe(0.02);
  });

  it('insufficient balance falls through to the 402 proof flow', async () => {
    await seedAccount(db, 'agent-1', 1);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search',
      headers: { 'x-client-key': 'agent-1' },
    });
    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.error.code).toBe('payment_required');
    expect(body.error.message).toContain('Prepaid balance insufficient');
    expect(await balanceOf(db, 'agent-1')).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM payments')).rows[0].n).toBe(0);
  });

  it('no account falls through to the 402 proof flow', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search',
      headers: { 'x-client-key': 'nobody' },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('payment_required');
    expect(res.json().error.message).toContain('Prepaid balance insufficient');
  });

  it('without x-client-key the 402 message does not mention credits', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/search' });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.message).not.toContain('Prepaid balance insufficient');
  });

  it('bundle endpoints never debit even with x-client-key (proof still required)', async () => {
    await seedAccount(db, 'agent-1', 5000);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/credits/5',
      headers: { 'x-client-key': 'agent-1' },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('payment_required');
    expect(await balanceOf(db, 'agent-1')).toBe(5000);
    expect((await db.query('SELECT count(*)::int AS n FROM payments')).rows[0].n).toBe(0);
  });

  it('double-spend guard: with balance equal to one cost only the first call debits', async () => {
    await seedAccount(db, 'agent-1', 2);
    await seedTender(db);
    const first = await app.inject({
      method: 'GET',
      url: '/v1/tenders/7',
      headers: { 'x-client-key': 'agent-1' },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'GET',
      url: '/v1/tenders/7',
      headers: { 'x-client-key': 'agent-1' },
    });
    expect(second.statusCode).toBe(402);
    expect(second.json().error.message).toContain('Prepaid balance insufficient');
    expect(await balanceOf(db, 'agent-1')).toBe(0);
    const pays = await db.query('SELECT provider, proof FROM payments');
    expect(pays.rows).toHaveLength(1);
    expect(pays.rows[0].provider).toBe('credit');
  });
});

describe('billing routes (REST)', () => {
  let db: Db;
  let app: FastifyInstance;
  const signer = new DevPaymentProvider({ secret: SECRET });

  beforeEach(async () => {
    db = await makeTestDb();
    app = await buildServer(config, db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('POST /v1/billing/credits/5 purchases credits; GET /v1/billing reads the balance', async () => {
    const { token } = signer.createToken('POST /v1/billing/credits/5');
    const buy = await app.inject({
      method: 'POST',
      url: '/v1/billing/credits/5',
      headers: { 'x-client-key': 'agent-1', 'x-payment': token },
    });
    expect(buy.statusCode).toBe(200);
    const body = buy.json();
    expect(body.meta).toMatchObject({ paid: true, price_usd: '5.00' });
    expect(body.data).toMatchObject({
      client_key: 'agent-1',
      added_cents: 500,
      balance_cents: 500,
      balance_usd: '5.00',
    });

    const check = await app.inject({
      method: 'GET',
      url: '/v1/billing',
      headers: { 'x-client-key': 'agent-1' },
    });
    expect(check.statusCode).toBe(200);
    expect(check.json().data).toMatchObject({
      client_key: 'agent-1',
      balance_cents: 500,
      balance_usd: '5.00',
    });
    expect(check.json().meta.price_usd).toBe('0.00');
  });

  it('a second purchase of the same bundle adds to the existing balance', async () => {
    const { token } = signer.createToken('POST /v1/billing/credits/10');
    const first = await app.inject({
      method: 'POST',
      url: '/v1/billing/credits/10',
      headers: { 'x-client-key': 'agent-1', 'x-payment': token },
    });
    expect(first.statusCode).toBe(200);
    const { token: token2 } = signer.createToken('POST /v1/billing/credits/10');
    const second = await app.inject({
      method: 'POST',
      url: '/v1/billing/credits/10',
      headers: { 'x-client-key': 'agent-1', 'x-payment': token2 },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({
      client_key: 'agent-1',
      added_cents: 1000,
      balance_cents: 2000,
      balance_usd: '20.00',
    });
  });

  it('GET /v1/billing without an account → 404 with a buy hint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing',
      headers: { 'x-client-key': 'ghost' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    expect(res.json().error.hint).toContain('POST /v1/billing/credits/5');
  });

  it('GET /v1/billing without x-client-key → 422 invalid_query', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/billing' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('missing x-client-key on a purchase → 422 invalid_query', async () => {
    const { token } = signer.createToken('POST /v1/billing/credits/5');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/credits/5',
      headers: { 'x-payment': token },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('invalid bundle amount → 400 invalid_query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/credits/7',
      headers: { 'x-client-key': 'agent-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_query');
  });

  it('replaying a consumed purchase proof is blocked (unique payments.proof)', async () => {
    const { token } = signer.createToken('POST /v1/billing/credits/5');
    const first = await app.inject({
      method: 'POST',
      url: '/v1/billing/credits/5',
      headers: { 'x-client-key': 'agent-1', 'x-payment': token },
    });
    expect(first.statusCode).toBe(200);
    const again = await app.inject({
      method: 'POST',
      url: '/v1/billing/credits/5',
      headers: { 'x-client-key': 'agent-1', 'x-payment': token },
    });
    expect(again.statusCode).toBe(402);
    expect(again.json().error.message).toContain('replay');
    expect(await balanceOf(db, 'agent-1')).toBe(500);
  });
});

describe('MCP billing tools and credit debit', () => {
  let db: Db;
  let client: Client;
  let provider: DevPaymentProvider;

  beforeEach(async () => {
    db = await makeTestDb();
    provider = new DevPaymentProvider({ secret: SECRET, db });
    const server = buildMcpServer(provider, db, config);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'billing-test', version: '0.0.1' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('paid tool with client_key debits the balance', async () => {
    await seedAccount(db, 'agent-1', 500);
    await seedTender(db);
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, client_key: 'agent-1' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.meta).toMatchObject({ price_usd: '0.02', paid: true });
    expect((body.data as { id: number }).id).toBe(7);
    expect(await balanceOf(db, 'agent-1')).toBe(498);
  });

  it('paid tool with client_key but no balance → payment_required', async () => {
    await seedAccount(db, 'agent-1', 1);
    await seedTender(db);
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, client_key: 'agent-1' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    expect(await balanceOf(db, 'agent-1')).toBe(1);
  });

  it('billing_get_balance returns the balance or not_found', async () => {
    await seedAccount(db, 'agent-1', 2500);
    const ok = (await client.callTool({
      name: 'billing_get_balance',
      arguments: { client_key: 'agent-1' },
    })) as ToolCallResult;
    expect(ok.isError).toBeFalsy();
    expect(parseText(ok).data).toMatchObject({
      client_key: 'agent-1',
      balance_cents: 2500,
      balance_usd: '25.00',
    });

    const missing = (await client.callTool({
      name: 'billing_get_balance',
      arguments: { client_key: 'ghost' },
    })) as ToolCallResult;
    expect(missing.isError).toBe(true);
    expect(parseText(missing).error).toMatchObject({ code: 'not_found' });
  });

  it('billing_purchase_credits verifies the proof for the exact bundle and credits', async () => {
    const { token } = provider.createToken('POST /v1/billing/credits/10');
    const res = (await client.callTool({
      name: 'billing_purchase_credits',
      arguments: { client_key: 'agent-1', amount: 10, payment_token: token },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.meta).toMatchObject({ price_usd: '10.00', paid: true });
    expect(body.data).toMatchObject({
      client_key: 'agent-1',
      added_cents: 1000,
      balance_cents: 1000,
      balance_usd: '10.00',
    });
  });

  it('billing_purchase_credits without proof → payment_required at the bundle price', async () => {
    const res = (await client.callTool({
      name: 'billing_purchase_credits',
      arguments: { client_key: 'agent-1', amount: 5 },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    expect(body.price_usd).toBe('5.00');
  });
});

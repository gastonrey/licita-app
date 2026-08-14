// MCP server: tool registration, unpaid → payment_required (isError=false),
// paid → data envelope, get_pricing free; plus an HTTP-level inject test of
// the streamable-HTTP mount at /mcp.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { newDb } from 'pg-mem';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Db } from '../../src/db/client.js';
import type { AppConfig } from '../../src/config.js';
import { buildMcpServer, mountMcp } from '../../src/mcp/server.js';
import { DevPaymentProvider } from '../../src/pay/devProvider.js';
import { X402PaymentProvider } from '../../src/pay/x402Provider.js';
import { initPayments, resetPayments } from '../../src/pay/middleware.js';
import { ENDPOINT_PRICES } from '../../src/domain/types.js';
import { makeTestConfig } from './testconfig.js';

const SECRET = 'mcp-test-secret';

const config: AppConfig = makeTestConfig({ payHmacSecret: SECRET, operatorKey: 'op' });

const PAYMENTS_DDL = `
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint,
  endpoint text NOT NULL, amount_usd numeric NOT NULL, provider text NOT NULL,
  proof text UNIQUE NOT NULL, status text NOT NULL, created_at timestamptz DEFAULT now(),
  payer_address text, tx_hash text, network text
);
`;

const TENDER_ROW = {
  id: 7,
  source_ref: '123-2026',
  source_code: 'ted',
  notice_type: 'can-standard',
  publication_date: '2026-01-15',
  title: 'Suministro de software',
  description: null,
  cpv_main: '72000000',
  cpv_all: ['72000000'],
  procedure_type: 'open',
  deadline: null,
  estimated_value: '100000',
  currency: 'EUR',
  nuts: 'ES61',
  url: null,
  b_id: 3,
  b_name: 'Ministerio de Prueba',
  b_country: 'ES',
  b_nuts: 'ES61',
  b_org_type: null,
};

const COMPANY_ROW = {
  id: 7,
  source_ref: 'acme s.a.|ESP',
  source_code: 'ted',
  name: 'ACME S.A.',
  country: 'ESP',
  nif: 'A12345674',
};

/**
 * Fake db: real pg-mem only for the payments table (replay protection);
 * canned rows for the data queries the tools run.
 */
function makeDb(): { db: Db; payments: Db } {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const payments = new Pool() as unknown as Db;
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      const t = text.replace(/\s+/g, ' ');
      if (t.includes('INSERT INTO payments')) return payments.query(text, values);
      if (t.includes('FROM tenders t JOIN sources s')) return { rows: [TENDER_ROW] };
      if (t.includes('FROM companies c JOIN sources s'))
        return { rows: values[0] === 7 ? [COMPANY_ROW] : [] };
      if (t.includes('FROM awards a WHERE a.winner_company_id'))
        return { rows: [{ wins: 1, total_value: '1000' }] };
      if (t.includes('FROM awards a LEFT JOIN companies c ON c.id = a.winner_company_id WHERE a.tender_id'))
        return { rows: [] };
      return { rows: [] };
    },
  } as unknown as Db;
  return { db, payments };
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

describe('MCP tools (in-process client)', () => {
  let client: Client;
  let provider: DevPaymentProvider;

  beforeAll(async () => {
    const { db, payments } = makeDb();
    await payments.query(PAYMENTS_DDL);
    provider = new DevPaymentProvider({ secret: SECRET, db });
    const server = buildMcpServer(provider, db, config);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
  });

  it('lists exactly the 8 SPEC tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_buyer_history',
      'get_company',
      'get_company_awards',
      'get_company_opportunities',
      'get_pricing',
      'get_renewals',
      'get_tender',
      'search_tenders',
    ]);
    for (const t of tools) {
      if (t.name === 'get_pricing') continue;
      expect(t.inputSchema.properties).toHaveProperty('payment_token');
    }
  });

  it('get_pricing is always free', async () => {
    const res = (await client.callTool({ name: 'get_pricing', arguments: {} })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.meta).toMatchObject({ price_usd: '0.00', paid: false });
    const data = body.data as { endpoints: Array<{ endpoint: string; price_usd: string }> };
    expect(data.endpoints.length).toBe(Object.keys(ENDPOINT_PRICES).length);
  });

  it('paid tool without token → payment_required payload with isError=false', async () => {
    const res = (await client.callTool({
      name: 'search_tenders',
      arguments: { q: 'software' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    expect(body.price_usd).toBe('0.02');
    const how = body.how_to_pay as { faucet: string; mcp_arg: string };
    expect(how.faucet).toContain('/v1/dev-faucet');
    expect(how.mcp_arg).toBe('payment_token');
  });

  it('paid tool with invalid token → payment_required with reason', async () => {
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: 'bogus.token' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    expect(body.reason).toBe('invalid_signature');
  });

  it('paid tool with valid token → data; replay → payment_required(replay)', async () => {
    const { token } = provider.createToken('GET /v1/tenders/:id');
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: token },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.meta).toMatchObject({ price_usd: '0.02', paid: true });
    const data = body.data as { id: number; title: string; buyer: { name: string } };
    expect(data.id).toBe(7);
    expect(data.title).toBe('Suministro de software');
    expect(data.buyer.name).toBe('Ministerio de Prueba');

    const again = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: token },
    })) as ToolCallResult;
    expect(parseText(again).reason).toBe('replay');
  });

  it('token minted for a different endpoint is rejected', async () => {
    const { token } = provider.createToken('GET /v1/search');
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: token },
    })) as ToolCallResult;
    expect(parseText(res).reason).toBe('wrong_endpoint');
  });

  it('get_company returns the shared profile shape incl. aliases/identifiers', async () => {
    const { token } = provider.createToken('GET /v1/companies/:id');
    const res = (await client.callTool({
      name: 'get_company',
      arguments: { id: 7, payment_token: token },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    const data = body.data as Record<string, unknown> & {
      id: number;
      nif: string;
      aliases: string[];
      identifiers: Array<{ scheme: string; value: string }>;
      stats: { wins: number };
    };
    expect(data.id).toBe(7);
    expect(data.nif).toBe('A12345674');
    expect(data.aliases).toEqual([]);
    expect(data.identifiers).toEqual([]);
    expect(data.stats.wins).toBe(1);
    expect(data.caveats).toBeDefined();
    expect(data.provenance).toBeDefined();
  });

  it('get_company on an unknown id → not_found error result', async () => {
    const { token } = provider.createToken('GET /v1/companies/:id');
    const res = (await client.callTool({
      name: 'get_company',
      arguments: { id: 999, payment_token: token },
    })) as ToolCallResult;
    expect(res.isError).toBe(true);
    expect(parseText(res).error).toMatchObject({ code: 'not_found' });
  });

  it('invalid tool args are rejected by schema validation', async () => {
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 'not-a-number' },
    })) as ToolCallResult;
    expect(res.isError).toBe(true);
  });
});

/** Parse the single JSON-RPC message out of an SSE-framed MCP response body. */
function parseSse(body: string): Record<string, any> {
  const line = body.split('\n').find((l) => l.startsWith('data: '));
  expect(line, `SSE data line in: ${body.slice(0, 200)}`).toBeTruthy();
  return JSON.parse((line as string).slice('data: '.length));
}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

describe('mountMcp HTTP transport', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const { db, payments } = makeDb();
    await payments.query(PAYMENTS_DDL);
    initPayments(config, db); // mountMcp consumes the runtime owned by buildServer
    app = Fastify({ logger: false });
    mountMcp(app, config, db);
  });

  afterEach(async () => {
    await app.close();
    resetPayments();
  });

  it('answers an initialize handshake at POST /mcp (SSE-framed)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'inject-test', version: '0.0.1' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = parseSse(res.body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.serverInfo).toEqual({ name: 'licita-agent', version: '0.1.0' });
  });

  it('serves tools/call over HTTP (stateless: fresh transport per request)', async () => {
    const call = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_pricing', arguments: {} },
      },
    });
    expect(call.statusCode).toBe(200);
    const body = parseSse(call.body);
    const text = body.result.content[0].text as string;
    expect(JSON.parse(text).data.endpoints.length).toBe(Object.keys(ENDPOINT_PRICES).length);
  });

  it('unpaid paid-tool call over HTTP returns payment_required content', async () => {
    const call = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_renewals', arguments: {} },
      },
    });
    expect(call.statusCode).toBe(200);
    const body = parseSse(call.body);
    expect(body.result.isError).toBeFalsy();
    const payload = JSON.parse(body.result.content[0].text as string);
    expect(payload).toMatchObject({ payment_required: true, price_usd: '0.25' });
  });
});

describe('MCP tools in x402 mode', () => {
  const PAY_TO = '0x3bF0F00f4c8e46CA4bFEa5D77cCDdCFC95c5ac5E';
  const PAYER = '0x1111111111111111111111111111111111111111';

  function mockFacilitator(): import('@x402/core/server').FacilitatorClient {
    return {
      async verify() {
        return { isValid: true, payer: PAYER };
      },
      async settle() {
        return { success: true, transaction: '0xtxhash', network: 'eip155:84532', payer: PAYER };
      },
      async getSupported() {
        return { kinds: [], extensions: [], signers: {} };
      },
    };
  }

  async function makeX402Client(): Promise<{ client: Client; provider: X402PaymentProvider }> {
    const { db, payments } = makeDb();
    await payments.query(PAYMENTS_DDL);
    const provider = new X402PaymentProvider(
      { facilitatorUrl: 'https://facilitator.test', payTo: PAY_TO, network: 'eip155:84532' },
      db,
      { facilitator: mockFacilitator() },
    );
    const server = buildMcpServer(provider, db, config);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
    return { client, provider };
  }

  it('unpaid tool result documents the x402 payment_token semantics', async () => {
    const { client } = await makeX402Client();
    const res = (await client.callTool({
      name: 'search_tenders',
      arguments: { q: 'software' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    const how = body.how_to_pay as {
      protocol: string;
      mode: string;
      faucet: null;
      rest_header: string;
      steps: string[];
    };
    expect(how.protocol).toBe('x402');
    expect(how.mode).toBe('x402');
    expect(how.faucet).toBeNull();
    expect(how.rest_header).toBe('PAYMENT-SIGNATURE');
    expect(how.steps.join(' ')).toContain('PAYMENT-REQUIRED');
    expect(how.steps.join(' ')).toContain('payment_token');
  });

  it('paid call with a valid base64 payment payload → data; replay → payment_required(replay)', async () => {
    const { client, provider } = await makeX402Client();
    const proof = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        accepted: provider.requirementsFor('GET /v1/tenders/:id'),
        payload: { signature: '0xsig' },
      }),
    ).toString('base64');

    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: proof },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.meta).toMatchObject({ price_usd: '0.02', paid: true });
    expect((body.data as { id: number }).id).toBe(7);

    const again = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: proof },
    })) as ToolCallResult;
    expect(parseText(again).reason).toBe('replay');
  });

  it('malformed payment_token → payment_required with invalid_payload', async () => {
    const { client } = await makeX402Client();
    const res = (await client.callTool({
      name: 'get_tender',
      arguments: { id: 7, payment_token: 'not-a-payment' },
    })) as ToolCallResult;
    expect(res.isError).toBeFalsy();
    const body = parseText(res);
    expect(body.payment_required).toBe(true);
    expect(body.reason).toBe('invalid_payload');
  });
});

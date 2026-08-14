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
import { ENDPOINT_PRICES } from '../../src/domain/types.js';

const SECRET = 'mcp-test-secret';

const config: AppConfig = {
  port: 0,
  logLevel: 'error',
  pg: { host: '', port: 0, user: '', password: '', database: '' },
  paymentsMode: 'dev',
  payHmacSecret: SECRET,
  x402: {},
  operatorKey: 'op',
  ingestMonths: 24,
  ingestOnBoot: false,
  ingestCronHour: 4,
};

const PAYMENTS_DDL = `
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint,
  endpoint text NOT NULL, amount_usd numeric NOT NULL, provider text NOT NULL,
  proof text UNIQUE NOT NULL, status text NOT NULL, created_at timestamptz DEFAULT now()
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
    app = Fastify({ logger: false });
    mountMcp(app, config, db);
  });

  afterEach(async () => {
    await app.close();
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

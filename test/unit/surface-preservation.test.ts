import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { ENDPOINT_PRICES } from '../../src/domain/types.js';
import { registerWeb } from '../../src/web/pages.js';
import { makeTestConfig } from './testconfig.js';
import { makeTestDb } from './testdb.js';
import { mountMcp } from '../../src/mcp/server.js';

describe('agent-surface preservation after homepage changes', () => {
  it('preserves the exact robots contract and the complete llms endpoint ladder', async () => {
    const app = Fastify({ logger: false });
    registerWeb(app, makeTestConfig({ paymentsMode: 'dev' }));

    const robots = await app.inject({ method: 'GET', url: '/robots.txt' });
    expect(robots.statusCode).toBe(200);
    expect(robots.headers['content-type']).toMatch(/^text\/plain; charset=utf-8/);
    expect(robots.body).toBe('User-agent: *\nAllow: /\n');

    const llms = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(llms.statusCode).toBe(200);
    expect(llms.headers['content-type']).toMatch(/^text\/plain; charset=utf-8/);
    expect(llms.body).toContain('GET /v1/demo is a free labeled sample');
    for (const [endpoint, price] of Object.entries(ENDPOINT_PRICES)) {
      expect(llms.body, endpoint).toContain(`- ${endpoint} — ${price === '0.00' ? 'free' : `$${price}/call`}`);
    }
    expect(llms.body).toContain('POST /v1/research — $0.50/call');
    await app.close();
  });

  it('preserves pricing, OpenAPI, and server-card contracts on the real route registrations', async () => {
    const db = await makeTestDb();
    const config = makeTestConfig({ paymentsMode: 'dev', operatorKey: 'surface-key' });
    const app = await buildServer(config, db);
    registerWeb(app, config);

    const pricing = await app.inject({ method: 'GET', url: '/v1/pricing' });
    expect(pricing.statusCode).toBe(200);
    expect(pricing.headers['content-type']).toMatch(/^application\/json/);
    expect(pricing.json().data.endpoints).toEqual(expect.arrayContaining(
      Object.entries(ENDPOINT_PRICES).map(([endpoint, price]) => ({ endpoint, price_usd: price, free: price === '0.00' })),
    ));

    const openapi = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(openapi.statusCode).toBe(200);
    const document = openapi.json();
    expect(document.openapi).toBe('3.1.0');
    for (const path of ['/v1/demo', '/v1/pricing', '/v1/search', '/v1/research', '/v1/stats']) {
      expect(document.paths[path], path).toBeDefined();
    }

    const card = await app.inject({ method: 'GET', url: '/.well-known/mcp/server-card.json' });
    expect(card.statusCode).toBe(200);
    expect(card.headers['content-type']).toMatch(/^application\/json; charset=utf-8/);
    const cardBody = card.json();
    expect(cardBody).toMatchObject({ schemaVersion: '2025-12-11', name: 'licita', transports: ['sse'] });
    expect(cardBody.tools).toHaveLength(11);
    const tools = cardBody.tools as Array<{ name: string; inputSchema: { type: string } }>;
    expect(tools.map((tool) => tool.name)).toEqual([
      'search_tenders', 'get_tender', 'get_company', 'get_company_awards',
      'get_company_opportunities', 'get_buyer_history', 'get_renewals', 'get_pricing',
      'research', 'billing_get_balance', 'billing_purchase_credits',
    ]);
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object');

    await app.close();
    await db.end();
  });

  it('preserves every documented agent-facing route with its content contract', async () => {
    const db = await makeTestDb();
    const config = makeTestConfig({ paymentsMode: 'dev' });
    const app = await buildServer(config, db);
    registerWeb(app, config);
    mountMcp(app, config, db);

    const htmlContracts = [
      ['/docs', '<h1>Docs — Licita</h1>'],
      ['/use-cases', 'Concrete agent missions'],
      ['/use-cases/tender-intelligence', 'Tender intelligence — find recent tenders and who won'],
      ['/data', '<h1>Data</h1>'],
      ['/data/spain', '<h1>Data — Spain (PLACSP)</h1>'],
      ['/data/eu', '<h1>Data — EU (TED)</h1>'],
    ] as const;

    for (const [url, marker] of htmlContracts) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['content-type'], url).toMatch(/^text\/html; charset=utf-8/);
      expect(response.body, url).toContain(marker);
    }

    const demo = await app.inject({ method: 'GET', url: '/v1/demo' });
    expect(demo.statusCode).toBe(200);
    expect(demo.headers['content-type']).toMatch(/^application\/json/);
    expect(demo.json().data).toMatchObject({
      note: expect.stringContaining('Free sample of Licita data'),
      tender: null,
      renewal: null,
    });

    const mcp = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'surface-preservation-test', version: '1.0.0' },
        },
      },
    });
    expect(mcp.statusCode).toBe(200);
    expect(mcp.headers['content-type']).toMatch(/^text\/event-stream/);
    const mcpPayload = JSON.parse(mcp.body.match(/data: (.+)/)?.[1] ?? '{}');
    expect(mcpPayload.result.serverInfo).toEqual({ name: 'licita', version: '0.1.0' });

    await app.close();
    await db.end();
  });
});

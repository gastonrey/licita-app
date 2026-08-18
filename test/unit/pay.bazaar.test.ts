// Bazaar discovery extension (x402 specs/extensions/bazaar.md): every priced
// REST endpoint and paid MCP tool advertises extensions.bazaar on the 402
// PaymentRequired with service metadata, so facilitators can catalog Licita in
// Bazaar search. Covers the registry (BAZAAR_EXTENSIONS / bazaarExtension),
// the provider's requiredResponse merge, and the middleware 402 body + header.

import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import type { AppConfig } from '../../src/config.js';
import {
  BAZAAR_EXTENSIONS,
  BAZAAR_SERVICE_METADATA,
  bazaarExtension,
  type BazaarExtension,
} from '../../src/pay/bazaar.js';
import { X402PaymentProvider } from '../../src/pay/x402Provider.js';
import { initPayments, paymentPreHandler, resetPayments } from '../../src/pay/middleware.js';
import {
  isValidRouteTemplate,
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
} from '@x402/extensions/bazaar';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import type { FacilitatorClient } from '@x402/core/server';
import type { PaymentRequirement } from '../../src/domain/types.js';
import { makeTestConfig } from './testconfig.js';

const PAY_TO = '0x3bF0F00f4c8e46CA4bFEa5D77cCDdCFC95c5ac5E';

const PRICED_REST_KEYS = [
  'GET /v1/search',
  'GET /v1/tenders/:id',
  'GET /v1/companies/:id',
  'GET /v1/companies/:id/awards',
  'GET /v1/companies/:id/opportunities',
  'GET /v1/buyers/:id/history',
  'GET /v1/renewals',
  'POST /v1/research',
];

const DYNAMIC_ROUTES = [
  'GET /v1/tenders/:id',
  'GET /v1/companies/:id',
  'GET /v1/companies/:id/awards',
  'GET /v1/companies/:id/opportunities',
  'GET /v1/buyers/:id/history',
];

const PAID_MCP_TOOLS = [
  'search_tenders',
  'get_tender',
  'get_company',
  'get_company_awards',
  'get_company_opportunities',
  'get_buyer_history',
  'get_renewals',
  'research',
];

const FREE_KEYS = ['GET /v1/pricing', 'GET /v1/stats', 'GET /v1/demo'];

function makeProvider(): X402PaymentProvider {
  return new X402PaymentProvider(
    { facilitatorUrl: 'https://facilitator.test', payTo: PAY_TO, network: 'eip155:84532' },
    undefined,
    {
      facilitator: {
        async verify() {
          return { isValid: true, payer: '0x1111111111111111111111111111111111111111' };
        },
        async settle() {
          return {
            success: true,
            transaction: '0xtxhash',
            network: 'eip155:84532',
            payer: '0x1111111111111111111111111111111111111111',
          };
        },
        async getSupported() {
          return { kinds: [], extensions: [], signers: {} };
        },
      } satisfies FacilitatorClient,
    },
  );
}

function v2Requirement(provider: X402PaymentProvider, key: string): PaymentRequirement {
  return provider.requiredResponse(key);
}

describe('BAZAAR_EXTENSIONS registry', () => {
  it('declares an extension for every priced REST key and paid MCP tool', () => {
    for (const key of PRICED_REST_KEYS) expect(bazaarExtension(key)).toBeDefined();
    for (const name of PAID_MCP_TOOLS) expect(bazaarExtension(name)).toBeDefined();
    expect(Object.keys(BAZAAR_EXTENSIONS)).toHaveLength(PRICED_REST_KEYS.length + PAID_MCP_TOOLS.length);
  });

  it('never declares bazaar for free/unknown endpoints', () => {
    for (const key of FREE_KEYS) expect(bazaarExtension(key)).toBeUndefined();
    expect(bazaarExtension('GET /nope')).toBeUndefined();
  });

  it('every declared extension passes the bazaar spec + schema validation', () => {
    for (const [key, ext] of Object.entries(BAZAAR_EXTENSIONS)) {
      const spec = validateDiscoveryExtensionSpec(ext);
      expect(spec.valid, `${key}: ${(spec as { errors?: string[] }).errors?.join(', ') ?? ''}`).toBe(true);
      const schema = validateDiscoveryExtension(ext);
      expect(schema.valid, `${key}: ${(schema as { errors?: string[] }).errors?.join(', ') ?? ''}`).toBe(true);
    }
  });
});

describe('REST bazaar discovery (http)', () => {
  const provider = makeProvider();

  it('every priced REST key is type http with an object schema', () => {
    for (const key of PRICED_REST_KEYS) {
      const ext = bazaarExtension(key) as BazaarExtension;
      const input = (ext.info as { input: { type: string; method?: string; bodyType?: string } }).input;
      expect(input.type).toBe('http');
      expect(ext.schema).toBeTypeOf('object');
    }
  });

  it('GET keys declare method GET; POST /v1/research declares bodyType json', () => {
    for (const key of PRICED_REST_KEYS) {
      const input = (bazaarExtension(key) as BazaarExtension).info as {
        input: { type: string; method: string; bodyType?: string };
      };
      if (key === 'POST /v1/research') {
        expect(input.input.method).toBe('POST');
        expect(input.input.bodyType).toBe('json');
      } else {
        expect(input.input.method).toBe('GET');
        expect(input.input.bodyType).toBeUndefined();
      }
    }
  });

  it('requiredResponse carries extensions.bazaar with http info + service metadata', () => {
    for (const key of PRICED_REST_KEYS) {
      const requirement = v2Requirement(provider, key);
      expect(requirement.x402Version).toBe(2);
      const ext = (requirement as { extensions: { bazaar: BazaarExtension } }).extensions.bazaar;
      expect((ext.info as { input: { type: string } }).input.type).toBe('http');
      const res = requirement.resource;
      expect(res.url).toBe(key);
      expect(res.mimeType).toBe('application/json');
      expect(res.serviceName).toBe('Licita');
      expect(res.description).toContain('Licita');
    }
  });

  it('POST /v1/research advertises a body example', () => {
    const ext = bazaarExtension('POST /v1/research') as BazaarExtension;
    const info = ext.info as {
      input: { bodyType: string; body: Record<string, unknown>; method: string };
    };
    expect(info.input.bodyType).toBe('json');
    expect(info.input.body).toMatchObject({ query: 'health sector IT services', limit: 5 });
  });

  it('dynamic id routes advertise pathParams', () => {
    const ext = bazaarExtension('GET /v1/tenders/:id') as BazaarExtension;
    const info = ext.info as { input: { pathParams: Record<string, unknown> } };
    expect(info.input.pathParams).toMatchObject({ id: expect.any(Number) });
  });
});

describe('MCP bazaar discovery', () => {
  it('every paid MCP tool is type mcp with toolName, transport sse and an object inputSchema', () => {
    for (const name of PAID_MCP_TOOLS) {
      const ext = bazaarExtension(name) as BazaarExtension;
      const info = ext.info as {
        input: {
          type: string;
          toolName: string;
          transport: string;
          inputSchema: Record<string, unknown>;
          example?: Record<string, unknown>;
        };
        output: { example: unknown };
      };
      expect(info.input.type).toBe('mcp');
      expect(info.input.toolName).toBe(name);
      expect(info.input.transport).toBe('sse');
      expect(info.input.inputSchema).toBeTypeOf('object');
      expect(info.input.example).toBeTypeOf('object');
      expect(info.output.example).toBeTypeOf('object');
    }
  });

  it('requiredResponse carries extensions.bazaar for MCP tools', () => {
    const provider = makeProvider();
    for (const name of PAID_MCP_TOOLS) {
      const requirement = v2Requirement(provider, name);
      const ext = (requirement as { extensions: { bazaar: BazaarExtension } }).extensions.bazaar;
      const input = (ext.info as { input: { type: string; toolName: string } }).input;
      expect(input.type).toBe('mcp');
      expect(input.toolName).toBe(name);
    }
  });
});

describe('routeTemplate', () => {
  it('is present and valid on the 5 dynamic REST routes', () => {
    for (const key of DYNAMIC_ROUTES) {
      const ext = bazaarExtension(key) as BazaarExtension;
      expect(ext.routeTemplate).toBeDefined();
      expect(isValidRouteTemplate(ext.routeTemplate)).toBe(true);
    }
  });

  it('is absent on static REST routes and MCP tools', () => {
    for (const key of PRICED_REST_KEYS) {
      if (DYNAMIC_ROUTES.includes(key)) continue;
      const ext = bazaarExtension(key) as BazaarExtension;
      expect(ext.routeTemplate).toBeUndefined();
    }
    for (const name of PAID_MCP_TOOLS) {
      const ext = bazaarExtension(name) as BazaarExtension;
      expect(ext.routeTemplate).toBeUndefined();
    }
  });
});

describe('service metadata', () => {
  it('serviceName is Licita and tags are ≤5 printable-ASCII strings', () => {
    expect(BAZAAR_SERVICE_METADATA.serviceName).toBe('Licita');
    const tags = BAZAAR_SERVICE_METADATA.tags ?? [];
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.length).toBeLessThanOrEqual(5);
    for (const tag of tags) {
      expect(tag).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});

describe('middleware 402 integration', () => {
  const PAYMENTS_DDL = `
CREATE TABLE payments (
  id bigserial PRIMARY KEY, client_id bigint,
  endpoint text NOT NULL, amount_usd numeric NOT NULL, provider text NOT NULL,
  proof text UNIQUE NOT NULL, status text NOT NULL, created_at timestamptz DEFAULT now(),
  payer_address text, tx_hash text, network text
);
`;

  function makeDb(): Db {
    const mem = newDb({ noAstCoverageCheck: true });
    const { Pool } = mem.adapters.createPg();
    return new Pool() as unknown as Db;
  }

  function buildApp(): FastifyInstance {
    const app = Fastify({ logger: false });
    app.get('/v1/search', { preHandler: [paymentPreHandler('GET /v1/search')] }, async () => ({ ok: true }));
    return app;
  }

  afterEach(() => resetPayments());

  it('402 without proof carries extensions.bazaar in the body and the PAYMENT-REQUIRED header', async () => {
    const db = makeDb();
    await db.query(PAYMENTS_DDL);
    const config: AppConfig = makeTestConfig({
      paymentsMode: 'x402',
      x402: { facilitatorUrl: 'https://facilitator.test', payTo: PAY_TO, network: 'eip155:84532' },
    });
    initPayments(config, db);
    const app = buildApp();

    const res = await app.inject({ method: 'GET', url: '/v1/search' });
    expect(res.statusCode).toBe(402);

    const body = res.json();
    const bodyExt = body.extensions?.bazaar as BazaarExtension;
    expect(bodyExt).toBeDefined();
    expect((bodyExt.info as { input: { type: string } }).input.type).toBe('http');
    expect(body.resource.serviceName).toBe('Licita');

    const header = res.headers['payment-required'];
    expect(typeof header).toBe('string');
    const decoded = decodePaymentRequiredHeader(header as string);
    const headerExt = (decoded as { extensions: { bazaar: BazaarExtension } }).extensions?.bazaar;
    expect(headerExt).toBeDefined();
    expect((headerExt.info as { input: { type: string } }).input.type).toBe('http');
    await app.close();
  });
});
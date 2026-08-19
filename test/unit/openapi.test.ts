import { describe, expect, it } from 'vitest';
import { buildOpenApi } from '../../src/api/openapi.js';
import { ENDPOINT_PRICES } from '../../src/domain/types.js';

describe('openapi document', () => {
  const doc = buildOpenApi() as {
    openapi: string;
    info: { title: string };
    paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
    components: { schemas: Record<string, unknown> };
  };

  // Every ENDPOINT_PRICES key is documented, including the free GET /v1/billing
  // and the priced credit bundles; POST /v1/research is covered by its own test.
  const documentedKeys = Object.keys(ENDPOINT_PRICES);

  // ENDPOINT_PRICES key → OpenAPI path (bundle keys share the {amount} template).
  const pathFor = (key: string) => {
    const p = key.split(' ')[1].replace(':id', '{id}');
    return p.startsWith('/v1/billing/credits/') ? '/v1/billing/credits/{amount}' : p;
  };
  const methodFor = (key: string) => key.split(' ')[0].toLowerCase() as 'get' | 'post';

  it('is OpenAPI 3.1 with info', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Licita');
  });

  it('documents every endpoint from ENDPOINT_PRICES', () => {
    for (const key of documentedKeys) {
      const p = pathFor(key);
      expect(doc.paths[p], `path ${p}`).toBeDefined();
      const method = methodFor(key);
      expect(doc.paths[p][method], `${key}`).toBeDefined();
      expect(doc.paths[p][method].operationId).toBeTruthy();
    }
  });

  it('paid endpoints document a 402 response; free ones do not', () => {
    for (const [key, price] of Object.entries(ENDPOINT_PRICES)) {
      const p = pathFor(key);
      const responses = doc.paths[p][methodFor(key)].responses ?? {};
      if (price === '0.00') expect(responses['402'], key).toBeUndefined();
      else expect(responses['402'], key).toBeDefined();
    }
  });

  it('documents POST /v1/research (paid, config-driven price) with a request body', () => {
    const op = doc.paths['/v1/research'].post as {
      operationId?: string;
      security?: unknown[];
      requestBody?: { required?: boolean; content?: Record<string, { schema?: { required?: string[]; properties?: Record<string, unknown> } }> };
      responses?: Record<string, unknown>;
    };
    expect(op.operationId).toBe('research');
    expect(op.security).toEqual([{ paymentSignature: [] }]);
    expect(op.requestBody?.required).toBe(true);
    expect(op.requestBody?.content?.['application/json']?.schema?.required).toEqual(['query']);
    expect(op.responses?.['402']).toBeDefined();
    const r200 = op.responses?.['200'] as {
      content?: { 'application/json'?: { schema?: { properties?: { data?: { properties?: Record<string, unknown> } } } } };
    };
    const props = r200.content?.['application/json']?.schema?.properties?.data?.properties ?? {};
    for (const k of ['topic', 'confidence', 'summary', 'findings', 'windows']) {
      expect(props[k], `research data ${k}`).toBeDefined();
    }
  });

  it('documents GET /v1/demo as a free endpoint with the sample data shape', () => {
    const op = doc.paths['/v1/demo'].get as {
      operationId?: string;
      security?: unknown[];
      responses?: Record<string, unknown>;
    };
    expect(op.operationId).toBe('getDemo');
    expect(op.security).toBeUndefined();
    expect(op.responses?.['402']).toBeUndefined();
  });

  it('error schema enum matches the SPEC §5 error codes', () => {
    const err = doc.components.schemas.Error as {
      properties: { error: { properties: { code: { enum: string[] } } } };
    };
    expect(err.properties.error.properties.code.enum).toEqual([
      'invalid_query',
      'not_found',
      'payment_required',
      'rate_limited',
      'internal',
    ]);
  });

  it('meta schema matches the envelope contract', () => {
    const meta = doc.components.schemas.Meta as { required: string[]; properties: Record<string, unknown> };
    expect(meta.required).toEqual(['request_id', 'price_usd', 'paid', 'provenance']);
    for (const k of ['request_id', 'price_usd', 'paid', 'provenance', 'page', 'total']) {
      expect(meta.properties[k], k).toBeDefined();
    }
  });

  it('is JSON-serializable', () => {
    expect(() => JSON.stringify(doc)).not.toThrow();
  });

  it('declares the x402 v2 PAYMENT-SIGNATURE security scheme and applies it to paid endpoints', () => {
    const schemes = doc.components.securitySchemes as Record<
      string,
      { type: string; in: string; name: string }
    >;
    expect(schemes.paymentSignature).toBeDefined();
    expect(schemes.paymentSignature).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'PAYMENT-SIGNATURE',
    });
    for (const [key, price] of Object.entries(ENDPOINT_PRICES)) {
      const p = pathFor(key);
      const op = doc.paths[p][methodFor(key)] as { security?: unknown[] };
      if (price === '0.00') expect(op.security, key).toBeUndefined();
      else expect(op.security, key).toEqual([{ paymentSignature: [] }]);
    }
  });

  it('documents the PAYMENT-REQUIRED header on the 402 response', () => {
    const responses = doc.paths['/v1/search'].get.responses as Record<string, unknown>;
    const r402 = responses['402'] as { headers?: Record<string, unknown> };
    expect(r402.headers).toBeDefined();
    expect(r402.headers?.['PAYMENT-REQUIRED']).toBeDefined();
  });
});

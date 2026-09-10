// C2.1 Error-envelope standardization pins (fiat-revenue-rails). Every 4xx
// response from the API surface MUST be a JSON error envelope of the shape
// { error: { code, message, hint? } } — never a plain-text send. One test per
// standardized class: 400 validation, 401 auth, 404 unknown route, 429 rate
// limit, and malformed-body parse errors. These are approval tests: they pin
// the contract the audit verified, so a regression to reply.send('text')
// anywhere fails loudly.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../src/config.js';
import type { Db } from '../../src/db/client.js';
import { buildServer } from '../../src/api/server.js';
import { makeTestConfig } from './testconfig.js';
import { makeTestDb } from './testdb.js';

describe('error envelope standardization (C2.1)', () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = await makeTestDb();
    app = await buildServer(makeTestConfig(), db);
  });

  afterEach(async () => {
    await app.close();
  });

  it('404 unknown routes use the not_found envelope, not plain text', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/no-such-route' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const body = res.json() as { error: { code: string; message: string; hint?: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('not found');
    expect(body.error.hint).toContain('/openapi.json');
  });

  it('400 validation errors use the invalid_query envelope', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/stats?from=bogus',
      headers: { 'x-operator-key': 'test-operator-key' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string; hint?: string } };
    expect(body.error.code).toBe('invalid_query');
    expect(body.error.message).toContain('Invalid query parameters');
    expect(body.error.hint).toBeDefined();
  });

  it('401 auth failures use the error envelope (pinned rejection shape)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/stats' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string; message: string; hint?: string } };
    expect(body.error.code).toBe('invalid_query');
    expect(body.error.message).toContain('x-operator-key');
  });

  it('429 rate-limit responses use the rate_limited envelope with retry-after', async () => {
    let last: number | null = null;
    for (let i = 0; i < 61; i++) {
      const res = await app.inject({ method: 'GET', url: '/v1/pricing' });
      last = res.statusCode;
      if (res.statusCode === 429) {
        expect(res.headers['retry-after']).toBeDefined();
        const body = res.json() as { error: { code: string; message: string; hint?: string } };
        expect(body.error.code).toBe('rate_limited');
        expect(body.error.message).toContain('requests per minute');
        break;
      }
    }
    expect(last).toBe(429);
  });

  it('malformed JSON bodies use the error envelope, not a raw parser error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/demo/request',
      payload: '{"email": ',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid_query');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it('malformed JSON on the rawBody-stashing webhook route is also a 400 envelope', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/creem/webhook',
      payload: '{"id": ',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    // The parser rejects it before signature verification ever runs.
    expect(body.error.code).toBe('invalid_query');
  });
});
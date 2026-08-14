// GET /health: 200 ok when the db answers SELECT 1, 503 degraded when it fails.

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import type { Db } from '../../src/db/client.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { makeTestConfig } from './testconfig.js';

function fakeDb(query: Db['query']): Db {
  return { query, on: () => undefined, end: async () => undefined } as unknown as Db;
}

describe('GET /health', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    resetPayments();
  });

  it('200 { status: "ok", db: "up" } when the db is reachable', async () => {
    app = await buildServer(makeTestConfig(), fakeDb((async () => ({ rows: [] })) as Db['query']));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('503 { status: "degraded", db: "down" } when the db fails', async () => {
    app = await buildServer(
      makeTestConfig(),
      fakeDb((async () => {
        throw new Error('connection refused');
      }) as Db['query']),
    );
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
  });

  it('is free (no payment hook) and not operator-gated', async () => {
    app = await buildServer(makeTestConfig(), fakeDb((async () => ({ rows: [] })) as Db['query']));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200); // no X-PAYMENT, no x-operator-key
  });
});

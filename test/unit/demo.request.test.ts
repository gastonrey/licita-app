import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import { channelFor, demoRequestSchema } from '../../src/api/routes/demo.js';
import { demoStatsHandler } from '../../src/api/routes/stats.js';
import { createRateLimiter } from '../../src/api/ratelimit.js';
import { buildServer } from '../../src/api/server.js';
import { makeTestDb, countRows } from './testdb.js';
import { makeTestConfig } from './testconfig.js';

describe('demo request capture', () => {
  it('captures a valid POST through the wired route and leaves no row for invalid input', async () => {
    const db = await makeTestDb();
    await db.query(readFileSync(new URL('../../migrations/007_demo_requests.sql', import.meta.url), 'utf8'));
    const app = await buildServer(makeTestConfig({ operatorKey: 'demo-route' }), db);

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/demo/request?source=homepage',
      payload: { email: 'not-an-email' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'invalid_query' } });
    expect(await countRows(db, 'demo_requests')).toBe(0);

    const valid = await app.inject({
      method: 'POST',
      url: '/v1/demo/request?source=homepage',
      payload: { email: ' A@B.com ' },
    });
    expect(valid.statusCode).toBe(201);
    expect(valid.json()).toMatchObject({
      data: { email: 'a@b.com', channel: 'homepage', status: 'new' },
      meta: { price_usd: '0.00', paid: false },
    });
    expect(await countRows(db, 'demo_requests')).toBe(1);

    await app.close();
    await db.end();
  });

  it('accepts the browser form encoding and redirects with a truthful success marker', async () => {
    const db = await makeTestDb();
    await db.query(readFileSync(new URL('../../migrations/007_demo_requests.sql', import.meta.url), 'utf8'));
    const app = await buildServer(makeTestConfig({ operatorKey: 'form-route' }), db);
    const res = await app.inject({
      method: 'POST', url: '/v1/demo/request?source=homepage',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=form%40example.com',
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/?demo=success');
    expect(await countRows(db, 'demo_requests')).toBe(1);
    await app.close();
    await db.end();
  });

  it('enforces migration constraints and permits duplicate emails', async () => {
    const mem = newDb({ noAstCoverageCheck: true });
    const { Pool } = mem.adapters.createPg();
    const db = new Pool();
    await db.query(readFileSync(new URL('../../migrations/007_demo_requests.sql', import.meta.url), 'utf8'));
    await db.query("INSERT INTO demo_requests (email) VALUES ('a@b.com'), ('a@b.com')");
    expect((await db.query('SELECT count(*)::int AS n FROM demo_requests')).rows[0].n).toBe(2);
    await expect(db.query("INSERT INTO demo_requests (email, channel) VALUES ('b@b.com', '')")).rejects.toThrow();
    await expect(db.query("INSERT INTO demo_requests (email, status) VALUES ('c@b.com', 'bogus')")).rejects.toThrow();
  });

  it('normalizes the email and attributes the source with precedence', () => {
    expect(demoRequestSchema.parse({ email: ' A@B.com ' })).toEqual({ email: 'a@b.com' });
    expect(channelFor({ source: ' homepage ' }, 'https://example.test')).toBe('homepage');
    expect(channelFor({}, 'https://example.test')).toBe('web');
    expect(channelFor({}, undefined)).toBe('direct');
  });

  it('rejects invalid email and bounds source attribution', () => {
    expect(() => demoRequestSchema.parse({ email: 'nope' })).toThrow();
    expect(channelFor({ source: '  ' }, undefined)).toBe('direct');
    expect(channelFor({ source: 'x'.repeat(65) }, undefined)).toBe('direct');
    expect(channelFor({ source: 'x'.repeat(64) }, undefined)).toBe('x'.repeat(64));
  });

  it('does not accept a malformed submission and exposes an ordered admin feed', async () => {
    expect(demoRequestSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    const mem = newDb({ noAstCoverageCheck: true });
    const { Pool } = mem.adapters.createPg();
    const db = new Pool();
    await db.query(readFileSync(new URL('../../migrations/007_demo_requests.sql', import.meta.url), 'utf8'));
    await db.query("INSERT INTO demo_requests (email, channel, status) VALUES ('old@b.com','web','new'),('new@b.com','homepage','paid')");
    const response = await demoStatsHandler({ db } as never)({ query: { limit: '200' } } as never, { send: (body: unknown) => body } as never);
    expect((response as any).data.requests.map((row: any) => row.email)).toEqual(['new@b.com', 'old@b.com']);
    expect((response as any).data.by_status).toEqual({ new: 1, contacted: 0, used: 0, paid: 1 });
  });

  it('returns a retry delay on the 61st request in a minute', () => {
    const limiter = createRateLimiter({ capacity: 60, refillPerMinute: 60, maxKeys: 10 });
    for (let i = 0; i < 60; i++) expect(limiter.take('demo-ip').allowed).toBe(true);
    const result = limiter.take('demo-ip');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });
});

// Lead funnel fix (TDD): migration 008 semantics, 180-day terminal-status
// purge, idempotent duplicate capture, operator list/PATCH routes, and the
// lead auto-reply resilience. Written before the implementation.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import type { Db } from '../../src/db/client.js';
import { buildServer } from '../../src/api/server.js';
import { buildOpenApi } from '../../src/api/openapi.js';
import { countRows, makeTestDb } from './testdb.js';
import { makeTestConfig } from './testconfig.js';

const MIG007 = readFileSync(new URL('../../migrations/007_demo_requests.sql', import.meta.url), 'utf8');
const MIG008 = readFileSync(new URL('../../migrations/008_demo_funnel.sql', import.meta.url), 'utf8');

/** Fresh pg-mem pool with the demo_requests table as it looks after 008. */
async function makeFunnelDb(): Promise<Db> {
  const mem = newDb({ noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  const db = new Pool() as unknown as Db;
  await db.query(MIG007);
  await db.query(MIG008);
  return db;
}

describe('demo funnel migration 008', () => {
  it('is replay-safe: applying the file twice in one script does not error', async () => {
    const db = await makeFunnelDb();
    await db.query(`${MIG008};\n${MIG008}`);
    await expect(db.query("INSERT INTO demo_requests (email, status) VALUES ('r@b.com', 'lost')")).resolves.toBeTruthy();
    await db.end();
  });

  it('widens the status domain to include lost while still rejecting junk', async () => {
    const db = await makeFunnelDb();
    await expect(db.query("INSERT INTO demo_requests (email, status) VALUES ('l@b.com', 'lost')")).resolves.toBeTruthy();
    await expect(db.query("INSERT INTO demo_requests (email, status) VALUES ('c@b.com', 'contacted')")).resolves.toBeTruthy();
    await expect(db.query("INSERT INTO demo_requests (email, status) VALUES ('b@b.com', 'bogus')")).rejects.toThrow();
    await db.end();
  });

  it('rejects a second row for the same email at the database level', async () => {
    const db = await makeFunnelDb();
    await expect(db.query("INSERT INTO demo_requests (email) VALUES ('a@b.com')")).resolves.toBeTruthy();
    await expect(db.query("INSERT INTO demo_requests (email) VALUES ('a@b.com')")).rejects.toThrow();
    expect(await countRows(db, 'demo_requests')).toBe(1);
    await db.end();
  });

  it('ships no trigger DDL: the 30-day sweep lived in code and is not re-created here', () => {
    // The audited claim of an auto-delete trigger was wrong: migrations 001-007
    // never created one; the sweep was the DELETE inside the insert path.
    const statements = (sql: string) =>
      sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toUpperCase();
    expect(statements(MIG007)).not.toContain('TRIGGER');
    expect(statements(MIG008)).not.toContain('TRIGGER');
  });
});

describe('demo request capture under the new retention rule', () => {
  it('never auto-deletes old "new" leads and purges only terminal statuses older than 180 days', async () => {
    const db = await makeFunnelDb();
    await db.query("INSERT INTO demo_requests (email, status, created_at) VALUES ('oldnew@b.com', 'new', now() - interval '400 days')");
    await db.query("INSERT INTO demo_requests (email, status, created_at) VALUES ('oldcontacted@b.com', 'contacted', now() - interval '200 days')");
    await db.query("INSERT INTO demo_requests (email, status, created_at) VALUES ('oldpaid@b.com', 'paid', now() - interval '181 days')");
    await db.query("INSERT INTO demo_requests (email, status, created_at) VALUES ('oldlost@b.com', 'lost', now() - interval '200 days')");
    await db.query("INSERT INTO demo_requests (email, status, created_at) VALUES ('freshcontact@b.com', 'contacted', now() - interval '10 days')");
    await db.query("INSERT INTO demo_requests (email, status, created_at) VALUES ('oldused@b.com', 'used', now() - interval '100 days')");

    const app = await buildServer(makeTestConfig({ operatorKey: 'funnel' }), db);
    const res = await app.inject({ method: 'POST', url: '/v1/demo/request', payload: { email: 'trigger@b.com' } });
    expect(res.statusCode).toBe(201);
    await app.close();

    const emails = (await db.query('SELECT email FROM demo_requests ORDER BY email')).rows.map((r: { email: string }) => r.email);
    expect(emails).toEqual(['freshcontact@b.com', 'oldnew@b.com', 'oldused@b.com', 'trigger@b.com']);
    await db.end();
  });

  it('treats a resubmitted email as already-requested: success response, single row, original channel kept', async () => {
    const db = await makeFunnelDb();
    const app = await buildServer(makeTestConfig({ operatorKey: 'dup' }), db);
    const first = await app.inject({ method: 'POST', url: '/v1/demo/request?source=homepage', payload: { email: 'dup@b.com' } });
    const second = await app.inject({ method: 'POST', url: '/v1/demo/request?source=campaign', payload: { email: 'dup@b.com' } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({
      data: { email: 'dup@b.com', status: 'new', channel: 'homepage' },
      meta: { price_usd: '0.00', paid: false },
    });
    expect(await countRows(db, 'demo_requests')).toBe(1);
    await app.close();
    await db.end();
  });

  it('redirects with the same success marker on a duplicate browser form submission', async () => {
    const db = await makeFunnelDb();
    const app = await buildServer(makeTestConfig({ operatorKey: 'dupform' }), db);
    const form = {
      method: 'POST' as const,
      url: '/v1/demo/request?source=homepage',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=dupform%40example.com',
    };
    const first = await app.inject(form);
    const second = await app.inject(form);
    expect(first.statusCode).toBe(303);
    expect(second.statusCode).toBe(303);
    expect(second.headers.location).toBe('/?demo=success');
    expect(await countRows(db, 'demo_requests')).toBe(1);
    await app.close();
    await db.end();
  });

  it('still answers the request successfully when the lead auto-reply send fails', async () => {
    const db = await makeFunnelDb();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('resend down');
    }) as unknown as typeof globalThis.fetch;
    try {
      const app = await buildServer(makeTestConfig({
        operatorKey: 'autoreply',
        resendApiKey: 're_test_abcdefghijklmnopqrstuvwxyz0123456789',
      }), db);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/demo/request?source=homepage',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'email=replyfail%40example.com',
      });
      expect(res.statusCode).toBe(303);
      expect(await countRows(db, 'demo_requests')).toBe(1);
      await app.close();
    } finally {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    }
    await db.end();
  });

  it('surfaces a real database failure as 500 without a second error from the sweep', async () => {
    // makeTestDb() has no demo_requests table: the best-effort purge must not
    // mask or compound the insert failure — the route still answers 500 cleanly.
    const db = await makeTestDb();
    const app = await buildServer(makeTestConfig({ operatorKey: 'nopedgetable' }), db);
    const res = await app.inject({ method: 'POST', url: '/v1/demo/request', payload: { email: 'x@b.com' } });
    expect(res.statusCode).toBe(500);
    await app.close();
    await db.end();
  });
});

describe('operator demo requests endpoints', () => {
  it('rejects list and patch without the operator key', async () => {
    const db = await makeFunnelDb();
    const app = await buildServer(makeTestConfig({ operatorKey: 'opkey-xyz' }), db);
    const list = await app.inject({ method: 'GET', url: '/v1/demo/requests' });
    const patch = await app.inject({ method: 'PATCH', url: '/v1/demo/requests/1', payload: { status: 'contacted' } });
    expect(list.statusCode).toBe(401);
    expect(list.json()).toMatchObject({ error: { code: 'invalid_query' } });
    expect(patch.statusCode).toBe(401);
    await app.close();
    await db.end();
  });

  it('patches status with the operator key and returns the updated row in the envelope', async () => {
    const db = await makeFunnelDb();
    const app = await buildServer(makeTestConfig({ operatorKey: 'opkey-abc' }), db);
    const created = await app.inject({ method: 'POST', url: '/v1/demo/request', payload: { email: 'patch@b.com' } });
    const id = created.json().data.id as number;
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/demo/requests/${id}`,
      headers: { 'x-operator-key': 'opkey-abc' },
      payload: { status: 'contacted' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: { email: 'patch@b.com', status: 'contacted' },
      meta: { price_usd: '0.00', paid: false },
    });
    expect(res.json().data.source_url).toBeNull();
    const stored = await db.query('SELECT status FROM demo_requests WHERE id = $1', [id]);
    expect(stored.rows[0].status).toBe('contacted');
    await app.close();
    await db.end();
  });

  it('rejects an invalid status value and a missing lead id', async () => {
    const db = await makeFunnelDb();
    const app = await buildServer(makeTestConfig({ operatorKey: 'opkey-bad' }), db);
    const bad = await app.inject({
      method: 'PATCH',
      url: '/v1/demo/requests/1',
      headers: { 'x-operator-key': 'opkey-bad' },
      payload: { status: 'shredded' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: 'invalid_query' } });
    const missing = await app.inject({
      method: 'PATCH',
      url: '/v1/demo/requests/99999',
      headers: { 'x-operator-key': 'opkey-bad' },
      payload: { status: 'paid' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'not_found' } });
    await app.close();
    await db.end();
  });

  it('lists leads newest-first with status filter and pagination metadata', async () => {
    const db = await makeFunnelDb();
    await db.query("INSERT INTO demo_requests (email, channel, status) VALUES ('n1@b.com','web','new'),('n2@b.com','web','new'),('c1@b.com','web','contacted')");
    const app = await buildServer(makeTestConfig({ operatorKey: 'opkey-list' }), db);
    const headers = { 'x-operator-key': 'opkey-list' };
    const all = await app.inject({ method: 'GET', url: '/v1/demo/requests?limit=2', headers });
    expect(all.statusCode).toBe(200);
    expect(all.json().data.map((r: { email: string }) => r.email)).toEqual(['c1@b.com', 'n2@b.com']);
    expect(all.json().meta).toMatchObject({ page: 1, total: 3, price_usd: '0.00', paid: false });
    const page2 = await app.inject({ method: 'GET', url: '/v1/demo/requests?limit=2&page=2', headers });
    expect(page2.json().data.map((r: { email: string }) => r.email)).toEqual(['n1@b.com']);
    const filtered = await app.inject({ method: 'GET', url: '/v1/demo/requests?status=contacted', headers });
    expect(filtered.json().data.map((r: { email: string }) => r.email)).toEqual(['c1@b.com']);
    expect(filtered.json().meta.total).toBe(1);
    const badFilter = await app.inject({ method: 'GET', url: '/v1/demo/requests?status=nope', headers });
    expect(badFilter.statusCode).toBe(400);
    await app.close();
    await db.end();
  });
});

describe('openapi contract for the operator lead routes', () => {
  type Op = { operationId?: string; parameters?: Array<Record<string, unknown>>; responses?: Record<string, unknown> };
  const doc = buildOpenApi() as { paths: Record<string, Record<string, Op>> };

  it('documents GET /v1/demo/requests with the operator-key header and status enum', () => {
    const op = doc.paths['/v1/demo/requests']?.get;
    expect(op?.operationId).toBe('listDemoRequests');
    expect(op?.parameters?.some((p) => p.name === 'x-operator-key' && p.in === 'header' && p.required === true)).toBe(true);
    expect(op?.responses?.['401']).toBeDefined();
  });

  it('documents PATCH /v1/demo/requests/{id} with 401/404 and the extended status domain', () => {
    const op = doc.paths['/v1/demo/requests/{id}']?.patch;
    expect(op?.operationId).toBe('patchDemoRequestStatus');
    expect(op?.responses?.['401']).toBeDefined();
    expect(op?.responses?.['404']).toBeDefined();
    const statuses = JSON.stringify(doc.paths);
    expect(statuses).toContain('lost');
    expect(statuses).not.toContain("each paid call returns a client id");
  });
});

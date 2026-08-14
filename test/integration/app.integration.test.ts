// Integration test (W4): the REAL wired app (buildServer → registerWeb →
// mountMcp) against a REAL embedded PostgreSQL (scripts/dev-db.ts, port 5433)
// with REAL TED data ingested (maxNotices 25).
//
// NOT run by default (`npm test` is unit-only). Run explicitly:
//   npx vitest run -c test/vitest.integration.config.ts
//
// Network guard: if the TED Search API is unreachable from this environment,
// the whole suite skips with a clear message (the standalone
// scripts/smoke-agent.ts does not depend on this suite).

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { createDb, type Db } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { buildServer } from '../../src/api/server.js';
import { registerWeb } from '../../src/web/pages.js';
import { mountMcp } from '../../src/mcp/server.js';
import { runIngestOnce, type IngestSummary } from '../../src/ingest/cli.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const PG_PORT = 5433;
const PG_URL = `postgres://licita:licita@127.0.0.1:${PG_PORT}/licita`;

// --- network guard --------------------------------------------------------------

async function tedReachable(): Promise<boolean> {
  try {
    const res = await fetch('https://api.ted.europa.eu/v3/notices/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'buyer-country=ESP', paginationMode: 'ITERATION', pageSize: 1, fields: ['publication-number'] }),
      signal: AbortSignal.timeout(15_000),
    });
    // Any HTTP response (even 4xx) means the API is reachable.
    return res.status > 0;
  } catch {
    return false;
  }
}

const TED_OK = await tedReachable();
if (!TED_OK) {
  console.warn(
    '[integration] TED Search API unreachable from this environment — ' +
      'SKIPPING the integration suite. Re-run with network access.',
  );
}

// --- helpers ----------------------------------------------------------------------

type Json = Record<string, unknown>;

async function faucet(base: string, endpoint: string): Promise<string> {
  const res = await fetch(`${base}/v1/dev-faucet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Json;
  return (body.token ?? body.proof) as string;
}

async function paidGet(base: string, endpointKey: string, path: string) {
  const token = await faucet(base, endpointKey);
  const res = await fetch(`${base}${path}`, { headers: { 'X-PAYMENT': token } });
  return { status: res.status, body: (await res.json()) as Json, token };
}

function parseSse(raw: string): Json {
  const line = raw.split('\n').find((l) => l.startsWith('data: '));
  if (!line) throw new Error(`no SSE data line in: ${raw.slice(0, 200)}`);
  return JSON.parse(line.slice('data: '.length)) as Json;
}

/** Wait until dev-db child prints its ready line (or exits). */
function waitForDevDb(child: ChildProcess, output: { text: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`dev-db did not become ready. Output so far:\n${output.text}`)),
      120_000,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      output.text += chunk.toString();
      if (output.text.includes(`running on port ${PG_PORT}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`dev-db exited early (code ${code}). Output:\n${output.text}`));
    });
  });
}

/** Can we already reach a usable postgres on PG_PORT? (e.g. a dev-db left running) */
async function existingDb(): Promise<Db | null> {
  try {
    const db = createDb({ databaseUrl: PG_URL } as AppConfig);
    await db.query('SELECT 1');
    return db;
  } catch {
    return null;
  }
}

// --- suite -------------------------------------------------------------------------

describe.runIf(TED_OK)('integration: real app + real postgres + live TED slice', () => {
  let db: Db;
  let app: FastifyInstance;
  let base = '';
  let devDb: ChildProcess | null = null;
  let summary: IngestSummary;

  beforeAll(async () => {
    // 1. database: reuse a healthy dev-db on 5433, else spawn scripts/dev-db.ts.
    const existing = await existingDb();
    if (existing) {
      db = existing;
      console.log('[integration] reusing postgres already listening on 5433');
    } else {
      const cwd = mkdtempSync(join(tmpdir(), 'licita-epg-'));
      const output = { text: '' };
      devDb = spawn('npx', ['tsx', join(REPO_ROOT, 'scripts/dev-db.ts')], {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      devDb.stderr?.on('data', (c: Buffer) => {
        output.text += c.toString();
      });
      await waitForDevDb(devDb, output);
      db = createDb({ databaseUrl: PG_URL } as AppConfig);
    }

    // 2. migrations + small live ingest slice (idempotent).
    const config: AppConfig = {
      ...loadConfig(),
      databaseUrl: PG_URL,
      paymentsMode: 'dev',
      payHmacSecret: 'integration-secret',
      operatorKey: 'integration-operator',
      ingestOnBoot: false,
    };
    await runMigrations(db);
    summary = await runIngestOnce(config, db, { maxNotices: 25 });
    console.log(`[integration] ingest summary: ${JSON.stringify(summary)}`);

    // 3. real wired app on an ephemeral port.
    app = await buildServer(config, db);
    registerWeb(app, config);
    mountMcp(app, config, db);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no listen address');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.end();
    if (devDb) {
      devDb.kill('SIGINT');
      await new Promise((r) => setTimeout(r, 3000));
      if (!devDb.killed) devDb.kill('SIGKILL');
    }
  });

  it('ingested a real TED slice (notices → awards/contracts/signals)', () => {
    expect(summary.notices_seen).toBe(25);
    expect(summary.errors).toBe(0);
    expect(summary.upserted).toBeGreaterThan(0);
    expect(summary.tenders).toBeGreaterThan(0);
    expect(summary.signals).toBeGreaterThan(0);
  });

  it('free discovery endpoints respond', async () => {
    for (const path of ['/llms.txt', '/openapi.json', '/v1/pricing', '/', '/docs', '/robots.txt']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
    }
  });

  it('unpaid search → 402 x402 body', async () => {
    const res = await fetch(`${base}/v1/search?cpv=72&type=award`);
    expect(res.status).toBe(402);
    const body = (await res.json()) as Json;
    expect(body.x402Version).toBe(1);
    const accepts = body.accepts as Array<Json>;
    expect(accepts[0].amount).toBe('0.02');
    expect(accepts[0].resource).toBe('GET /v1/search');
    expect((body.error as Json).code).toBe('payment_required');
  });

  it('faucet → paid search → 200 envelope with provenance', async () => {
    const { status, body } = await paidGet(base, 'GET /v1/search', '/v1/search?cpv=72&type=award');
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect((body.data as unknown[]).length).toBeGreaterThan(0);
    const meta = body.meta as Json;
    expect(meta.paid).toBe(true);
    expect(meta.price_usd).toBe('0.02');
    expect(typeof meta.request_id).toBe('string');
    expect(Array.isArray(meta.provenance)).toBe(true);
  });

  it('tender detail (paid) carries awards + ted provenance', async () => {
    const t = await paidGet(base, 'GET /v1/search', '/v1/search?cpv=72&type=tender&size=1');
    const row = (t.body.data as Array<Json>)[0];
    const { status, body } = await paidGet(base, 'GET /v1/tenders/:id', `/v1/tenders/${row.id}`);
    expect(status).toBe(200);
    const data = body.data as Json;
    expect(Number(data.id)).toBe(Number(row.id));
    expect(Array.isArray(data.awards)).toBe(true);
    const prov = (body.meta as Json).provenance as Array<Json>;
    expect(prov[0]?.source).toBe('ted');
  });

  it('renewals (paid, $0.25) returns forecast signals', async () => {
    const { status, body } = await paidGet(base, 'GET /v1/renewals', '/v1/renewals?window_months=12');
    expect(status).toBe(200);
    expect((body.meta as Json).price_usd).toBe('0.25');
    const rows = body.data as Array<Json>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(['duration_expiry', 'framework_expiry', 'recurrence']).toContain(r.signal_type);
      expect(r.window_start).toBeTruthy();
    }
  });

  it('replayed X-PAYMENT token is rejected with reason "replay"', async () => {
    const { token } = await paidGet(base, 'GET /v1/search', '/v1/search?cpv=72&type=award');
    const res = await fetch(`${base}/v1/search?cpv=48&type=award`, {
      headers: { 'X-PAYMENT': token },
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as Json;
    expect(String((body.error as Json).message)).toMatch(/replay/i);
  });

  it('MCP /mcp tools/list exposes the 8 tools; get_pricing is free', async () => {
    const rpc = async (id: number, method: string, params: unknown) => {
      const res = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      expect(res.status).toBe(200);
      return parseSse(await res.text());
    };
    const listed = await rpc(1, 'tools/list', {});
    const names = ((listed.result as Json).tools as Array<{ name: string }>).map((t) => t.name);
    for (const n of [
      'search_tenders',
      'get_tender',
      'get_company',
      'get_company_awards',
      'get_company_opportunities',
      'get_buyer_history',
      'get_renewals',
      'get_pricing',
    ]) {
      expect(names).toContain(n);
    }
    const called = await rpc(2, 'tools/call', { name: 'get_pricing', arguments: {} });
    const text = ((called.result as Json).content as Array<{ text: string }>)[0].text;
    const parsed = JSON.parse(text) as Json;
    expect(Array.isArray((parsed.data as Json).endpoints)).toBe(true);
  });
});

// Company profile API surface (P0.4): REST GET /v1/companies/:id and the MCP
// get_company tool share companyProfileData() — this proves both expose the
// same shape, including identity aliases and identifiers.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Db } from '../../src/db/client.js';
import { ensureSource, persistNotice } from '../../src/ingest/normalize.js';
import { resolveCompany } from '../../src/ingest/identity.js';
import { companyIdValidation, companyProfileHandler } from '../../src/api/routes/companies.js';
import { buildMcpServer } from '../../src/mcp/server.js';
import { DevPaymentProvider } from '../../src/pay/devProvider.js';
import { createLogger } from '../../src/obs/log.js';
import { createMetrics } from '../../src/obs/metrics.js';
import type { TedSearchResponse } from '../../src/domain/types.js';
import { countRows, makeTestDb } from './testdb.js';
import { makeTestConfig } from './testconfig.js';

const SECRET = 'profile-test-secret';
const config = makeTestConfig({ payHmacSecret: SECRET });

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ted-search-es-can-it.json'),
    'utf8',
  ),
) as TedSearchResponse;

/** Seed: one TED-ingested company (NIF A28963767) + a PLACSP alias via resolver. */
async function seed(): Promise<{ db: Db; companyId: number }> {
  const db = await makeTestDb();
  const tedSource = await ensureSource(db);
  const placspSource = await ensureSource(db, 'placsp');
  await persistNotice(db, tedSource, fixture.notices[0]);
  const company = (await db.query('SELECT id FROM companies')).rows[0] as { id: number };
  // Same NIF from PLACSP under a different name → alias on the same company.
  const again = await resolveCompany(db, {
    sourceId: placspSource,
    sourceCode: 'placsp',
    sourceRef: 'nif:A28963767',
    name: 'TECNOLOGÍAS ECOSISTEMAS SAU',
    country: 'ES',
    nif: 'A28963767',
    raw: null,
  });
  expect(again).toBe(company.id);
  expect(await countRows(db, 'companies')).toBe(1);
  return { db, companyId: company.id };
}

describe('company profile: REST and MCP expose the same identity shape', () => {
  let app: FastifyInstance;
  let db: Db;
  let companyId: number;

  afterEach(async () => {
    await app?.close();
  });

  it('REST profile includes aliases and identifiers', async () => {
    ({ db, companyId } = await seed());
    app = Fastify({ logger: false });
    const ctx = { config, db, log: createLogger('error'), metrics: createMetrics() };
    app.get('/v1/companies/:id', { preHandler: [companyIdValidation] }, companyProfileHandler(ctx));

    const res = await app.inject({ method: 'GET', url: `/v1/companies/${companyId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({
      id: companyId,
      nif: 'A28963767',
      aliases: ['TECNOLOGÍAS ECOSISTEMAS SAU'],
      identifiers: [
        { scheme: 'nif', value: 'A28963767' },
        { scheme: 'placsp', value: 'nif:A28963767' },
        { scheme: 'ted', value: 'tecnilogica ecosistemas, s.a.u.|ESP' },
      ],
    });
    expect(body.data.stats.wins).toBe(1);
    expect(body.meta.caveats[0]).toContain('Framework agreement values');
  });

  it('MCP get_company data matches the REST data shape field by field', async () => {
    ({ db, companyId } = await seed());
    app = Fastify({ logger: false });
    const ctx = { config, db, log: createLogger('error'), metrics: createMetrics() };
    app.get('/v1/companies/:id', { preHandler: [companyIdValidation] }, companyProfileHandler(ctx));
    const rest = (await app.inject({ method: 'GET', url: `/v1/companies/${companyId}` })).json()
      .data as Record<string, unknown>;

    const provider = new DevPaymentProvider({ secret: SECRET, db });
    const server = buildMcpServer(provider, db, config);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([client.connect(clientT), server.connect(serverT)]);
    const { token } = provider.createToken('GET /v1/companies/:id');
    const result = (await client.callTool({
      name: 'get_company',
      arguments: { id: companyId, payment_token: token },
    })) as { content: Array<{ type: string; text: string }> };
    const mcp = (JSON.parse(result.content[0].text) as { data: Record<string, unknown> }).data;

    // MCP embeds caveats/provenance in data; the profile fields match REST's.
    expect(mcp).toMatchObject(rest);
    expect(mcp.aliases).toEqual(rest.aliases);
    expect(mcp.identifiers).toEqual(rest.identifiers);
    await client.close();
    await server.close();
  });
});

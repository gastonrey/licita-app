// mountMcp(app, config, db) — streamable-HTTP MCP endpoint at /mcp (SPEC §6).
// 8 tools mirroring the REST endpoints, each with an optional `payment_token`
// arg. Unpaid calls return a structured `payment_required` payload with
// isError=false so agents read it as data. Paid calls run the SAME queries as
// the REST routes: all SQL lives in src/api/routes/* and is imported here.

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { PaymentProvider } from '../domain/types.js';
import { getPaymentProvider } from '../pay/middleware.js';
import { dateStr, num, provenanceFor, tedUrl } from '../api/routes/common.js';
import {
  awardsQuerySchema,
  idParamSchema,
  opportunitiesQuerySchema,
  renewalsQuerySchema,
  searchQuerySchema,
} from '../api/validate.js';
import { buildSearchQuery, mapSearchRow } from '../api/routes/search.js';
import { TENDER_SQL, TENDER_AWARDS_SQL, mapAwardRow } from '../api/routes/tenders.js';
import {
  CONFIDENCE_SCALE,
  RENEWALS_METHODOLOGY,
  buildRenewalsQuery,
  mapRenewalRow,
} from '../api/routes/renewals.js';
import {
  COMPANY_AWARDS_SQL,
  FRAMEWORK_CAVEAT,
  OPPORTUNITIES_SQL,
  SCORE_EXPLANATION,
  companyProfileData,
  loadCompany,
} from '../api/routes/companies.js';
import {
  BUYER_AWARD_DATES_SQL,
  BUYER_AWARDS_SQL,
  BUYER_SQL,
  BUYER_SUPPLIERS_SQL,
  computeConcentration,
  computeRecurrence,
  type SupplierRow,
} from '../api/routes/buyers.js';
import { buildPricing } from '../api/routes/pricing.js';

interface ToolTextResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function textResult(payload: unknown, isError = false): ToolTextResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function errorResult(code: string, message: string, hint?: string): ToolTextResult {
  return textResult({ error: { code, message, ...(hint ? { hint } : {}) } }, true);
}

/** Structured unpaid response — isError=false so agents parse it as data (SPEC §6). */
function paymentRequiredResult(
  provider: PaymentProvider,
  endpointKey: string,
  reason?: string,
): ToolTextResult {
  const price = provider.price(endpointKey);
  const howToPay =
    provider.name === 'x402'
      ? {
          protocol: 'x402',
          mode: provider.name,
          steps: [
            `1. Call the REST endpoint (${endpointKey}) without payment → HTTP 402 with a base64 PAYMENT-REQUIRED header (v2) and a body { x402Version: 2, resource, accepts[] } describing the exact USDC requirement.`,
            '2. Create the payment with an x402 client (scheme "exact", EIP-3009 transferWithAuthorization of USDC on the advertised network) and obtain the base64 payment payload.',
            '3. Retry this tool with payment_token set to that base64 payload — the same value a REST client sends as the PAYMENT-SIGNATURE (v2) or X-PAYMENT (v1) header.',
            'Proofs are single-use: the payment is verified AND settled on-chain before the tool runs.',
          ],
          faucet: null,
          mcp_arg: 'payment_token',
          rest_header: 'PAYMENT-SIGNATURE',
        }
      : {
          protocol: 'x402-compatible',
          mode: provider.name,
          steps: [
            `1. POST /v1/dev-faucet with {"endpoint":"${endpointKey}"} → { token, expires_at } (dev mode only).`,
            '2. Retry this tool with payment_token set to the token. Tokens are single-use and expire after 5 minutes.',
            'For REST: send the token as header X-PAYMENT instead.',
          ],
          faucet:
            provider.name === 'dev'
              ? `POST /v1/dev-faucet {"endpoint":"${endpointKey}"}`
              : null,
          mcp_arg: 'payment_token',
          rest_header: 'X-PAYMENT',
        };
  return textResult({
    payment_required: true,
    endpoint: endpointKey,
    price_usd: price,
    ...(reason ? { reason } : {}),
    how_to_pay: howToPay,
  });
}

interface ToolDef {
  endpointKey: string;
  description: string;
  /** zod raw shape, WITHOUT payment_token (added centrally). */
  schema: Record<string, z.ZodTypeAny>;
  run: (db: Db, args: Record<string, unknown>, config: AppConfig) => Promise<unknown>;
}

const idShape = { id: z.number().int().positive().describe('numeric id from search results') };
const pageShape = {
  page: z.number().int().min(1).default(1),
  size: z.number().int().min(1).max(100).default(20),
};

const TOOLS: Record<string, ToolDef> = {
  search_tenders: {
    endpointKey: 'GET /v1/search',
    description:
      'Search Spanish public-sector IT/software/cyber procurement: awards, tenders and contracts. Filters: q (full-text), cpv (prefix), buyer, company, region (NUTS), from/to (YYYY-MM-DD), type=award|tender|contract. Returns compact rows with ids for the other tools.',
    schema: {
      q: z.string().min(1).max(200).optional(),
      cpv: z.string().optional().describe('CPV code or prefix, e.g. "72"'),
      buyer: z.string().min(2).max(200).optional(),
      company: z.string().min(2).max(200).optional(),
      region: z.string().optional().describe('NUTS code or prefix, e.g. "ES61"'),
      from: z.string().optional().describe('YYYY-MM-DD'),
      to: z.string().optional().describe('YYYY-MM-DD'),
      type: z.enum(['award', 'tender', 'contract']).default('award'),
      ...pageShape,
    },
    run: async (db, args) => {
      const q = searchQuerySchema.parse(args);
      const { text, values } = buildSearchQuery(q);
      const res = await db.query(text, values);
      const total = res.rows.length > 0 ? Number(res.rows[0].total_count) : 0;
      return {
        results: res.rows.map((r) => mapSearchRow(q.type, r)),
        page: q.page,
        total,
      };
    },
  },

  get_tender: {
    endpointKey: 'GET /v1/tenders/:id',
    description:
      'Full tender detail by id: buyer, CPVs, deadline, estimated value, all awards/lots with winners, plus provenance (source + TED url).',
    schema: idShape,
    run: async (db, args) => {
      const { id } = idParamSchema.parse(args);
      const tRes = await db.query(TENDER_SQL, [id]);
      if (tRes.rows.length === 0) return { error: { code: 'not_found', message: `Tender ${id} not found` } };
      const t = tRes.rows[0];
      const aRes = await db.query(TENDER_AWARDS_SQL, [id]);
      return {
        id: Number(t.id),
        source_ref: (t.source_ref as string) ?? null,
        notice_type: (t.notice_type as string) ?? null,
        publication_date: dateStr(t.publication_date),
        title: (t.title as string) ?? null,
        description: (t.description as string) ?? null,
        cpv_main: (t.cpv_main as string) ?? null,
        cpv_all: (t.cpv_all as string[]) ?? [],
        procedure_type: (t.procedure_type as string) ?? null,
        deadline: t.deadline ? new Date(t.deadline as string).toISOString() : null,
        estimated_value: num(t.estimated_value),
        currency: (t.currency as string) ?? null,
        nuts: (t.nuts as string) ?? null,
        url: tedUrl(t.source_ref as string | null, t.url as string | null) ?? null,
        buyer:
          t.b_id != null
            ? {
                id: Number(t.b_id),
                name: String(t.b_name),
                country: (t.b_country as string) ?? null,
                nuts: (t.b_nuts as string) ?? null,
                org_type: (t.b_org_type as string) ?? null,
              }
            : null,
        awards: aRes.rows.map(mapAwardRow),
        provenance: provenanceFor(
          t.source_code as string,
          (t.source_ref as string) ?? null,
          tedUrl(t.source_ref as string | null, t.url as string | null),
        ),
      };
    },
  },

  get_company: {
    endpointKey: 'GET /v1/companies/:id',
    description:
      'Company profile by id: name, country, NIF, aliases and source identifiers (cross-source identity), plus aggregate stats (wins, total awarded value, top CPVs, top buyers).',
    schema: idShape,
    run: async (db, args) => {
      const { id } = idParamSchema.parse(args);
      const c = await loadCompany(db, id);
      if (!c) return { error: { code: 'not_found', message: `Company ${id} not found` } };
      const data = await companyProfileData(db, c);
      return {
        ...data,
        caveats: [FRAMEWORK_CAVEAT],
        provenance: provenanceFor(c.source_code as string, (c.source_ref as string) ?? null),
      };
    },
  },

  get_company_awards: {
    endpointKey: 'GET /v1/companies/:id/awards',
    description: 'Paginated award history for a company: dates, lots, values, tender + buyer context.',
    schema: { ...idShape, ...pageShape },
    run: async (db, args) => {
      const { id } = idParamSchema.parse(args);
      const { page, size } = awardsQuerySchema.parse(args);
      if (!(await loadCompany(db, id))) {
        return { error: { code: 'not_found', message: `Company ${id} not found` } };
      }
      const res = await db.query(COMPANY_AWARDS_SQL, [id, size, (page - 1) * size]);
      const total = res.rows.length > 0 ? Number(res.rows[0].total_count) : 0;
      return {
        awards: res.rows.map((r) => ({
          ...mapAwardRow(r),
          tender: {
            id: r.t_id != null ? Number(r.t_id) : null,
            source_ref: (r.t_ref as string) ?? null,
            title: (r.t_title as string) ?? null,
            cpv_main: (r.t_cpv as string) ?? null,
            publication_date: dateStr(r.t_pubdate),
            buyer: r.t_buyer_id != null ? { id: Number(r.t_buyer_id), name: String(r.t_buyer_name) } : null,
          },
        })),
        page,
        total,
      };
    },
  },

  get_company_opportunities: {
    endpointKey: 'GET /v1/companies/:id/opportunities',
    description:
      'Active/recent tenders matching a company\'s historical CPV/buyer profile, with a deterministic similarity score (explained in score_explanation).',
    schema: { ...idShape, ...pageShape },
    run: async (db, args) => {
      const { id } = idParamSchema.parse(args);
      const { page, size } = opportunitiesQuerySchema.parse(args);
      if (!(await loadCompany(db, id))) {
        return { error: { code: 'not_found', message: `Company ${id} not found` } };
      }
      const res = await db.query(OPPORTUNITIES_SQL, [id, size, (page - 1) * size]);
      const total = res.rows.length > 0 ? Number(res.rows[0].total_count) : 0;
      return {
        opportunities: res.rows.map((r) => ({
          id: Number(r.id),
          source_ref: (r.source_ref as string) ?? null,
          title: (r.title as string) ?? null,
          publication_date: dateStr(r.publication_date),
          deadline: r.deadline ? new Date(r.deadline as string).toISOString() : null,
          cpv_main: (r.cpv_main as string) ?? null,
          estimated_value: num(r.estimated_value),
          currency: (r.currency as string) ?? null,
          nuts: (r.nuts as string) ?? null,
          url: tedUrl(r.source_ref as string | null, r.url as string | null) ?? null,
          buyer: r.buyer_id != null ? { id: Number(r.buyer_id), name: String(r.buyer_name) } : null,
          score: Number(r.score),
          same_buyer: r.same_buyer === true,
          same_cpv: r.same_cpv === true,
        })),
        page,
        total,
        score_explanation: SCORE_EXPLANATION,
      };
    },
  },

  get_buyer_history: {
    endpointKey: 'GET /v1/buyers/:id/history',
    description:
      'Buyer profile by id: award history, supplier concentration (top-supplier share) and per-CPV-division recurrence (median months between awards).',
    schema: idShape,
    run: async (db, args) => {
      const { id } = idParamSchema.parse(args);
      const bRes = await db.query(BUYER_SQL, [id]);
      if (bRes.rows.length === 0) return { error: { code: 'not_found', message: `Buyer ${id} not found` } };
      const b = bRes.rows[0];
      const [awardsRes, suppliersRes, datesRes] = await Promise.all([
        db.query(BUYER_AWARDS_SQL, [id]),
        db.query(BUYER_SUPPLIERS_SQL, [id]),
        db.query(BUYER_AWARD_DATES_SQL, [id]),
      ]);
      const totalAwards = awardsRes.rows.length > 0 ? Number(awardsRes.rows[0].total_count) : 0;
      const supplierRows: SupplierRow[] = suppliersRes.rows.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        wins: Number(r.wins),
        total_value: num(r.total_value),
      }));
      return {
        id: Number(b.id),
        source_ref: (b.source_ref as string) ?? null,
        name: String(b.name),
        country: (b.country as string) ?? null,
        nuts: (b.nuts as string) ?? null,
        org_type: (b.org_type as string) ?? null,
        awards: awardsRes.rows.map((r) => ({
          ...mapAwardRow(r),
          tender: {
            id: r.t_id != null ? Number(r.t_id) : null,
            source_ref: (r.t_ref as string) ?? null,
            title: (r.t_title as string) ?? null,
            cpv_main: (r.t_cpv as string) ?? null,
          },
        })),
        awards_total: totalAwards,
        awards_returned: awardsRes.rows.length,
        supplier_concentration: computeConcentration(supplierRows),
        recurrence: computeRecurrence(
          datesRes.rows.map((r) => ({ division: String(r.division), award_date: r.award_date })),
        ),
        provenance: provenanceFor(b.source_code as string, (b.source_ref as string) ?? null),
      };
    },
  },

  get_renewals: {
    endpointKey: 'GET /v1/renewals',
    description:
      'Forecast signals for likely re-tenders: contracts/frameworks approaching renewal. Filters: cpv (prefix), buyer, window_months (default 12, max 36), min_confidence=low|medium|high.',
    schema: {
      cpv: z.string().optional(),
      buyer: z.string().min(2).max(200).optional(),
      window_months: z.number().int().min(1).max(36).default(12),
      min_confidence: z.enum(['low', 'medium', 'high']).default('low'),
      ...pageShape,
    },
    run: async (db, args) => {
      const q = renewalsQuerySchema.parse(args);
      const { text, values } = buildRenewalsQuery(q);
      const res = await db.query(text, values);
      const total = res.rows.length > 0 ? Number(res.rows[0].total_count) : 0;
      return {
        renewals: res.rows.map(mapRenewalRow),
        page: q.page,
        total,
        methodology: RENEWALS_METHODOLOGY,
        confidence_scale: [...CONFIDENCE_SCALE],
      };
    },
  },

  get_pricing: {
    endpointKey: 'GET /v1/pricing',
    description: 'Machine-readable price ladder for all endpoints/tools plus the payment flow. Always free.',
    schema: {},
    run: async (_db, _args, config) => buildPricing(config.paymentsMode),
  },
};

// --- server construction ---------------------------------------------------------

/** Build the MCP server with all 8 tools registered. Exported for tests. */
export function buildMcpServer(provider: PaymentProvider, db: Db, config: AppConfig): McpServer {
  const server = new McpServer(
    { name: 'licita-agent', version: '0.1.0' },
    {
      instructions:
        'Spanish public procurement intelligence (TED award notices, IT/software/cyber CPV 72*/48*). ' +
        'Most tools are paid per call: if a tool returns {"payment_required": true, ...}, follow its how_to_pay steps — in dev mode POST /v1/dev-faucet to get a token, then retry with payment_token. ' +
        'Start with get_pricing (free) and search_tenders to discover ids.',
    },
  );

  for (const [name, def] of Object.entries(TOOLS)) {
    server.registerTool(
      name,
      {
        description: `[${def.endpointKey} — $${provider.price(def.endpointKey)}] ${def.description}`,
        inputSchema: {
          ...def.schema,
          payment_token: z
            .string()
            .optional()
            .describe(
              'Payment proof: dev mode → single-use token from POST /v1/dev-faucet; x402 mode → base64 payment payload (the PAYMENT-SIGNATURE / X-PAYMENT header value)',
            ),
        },
      },
      async (args) => {
        const { payment_token: token, ...rest } = args as Record<string, unknown> & {
          payment_token?: string;
        };
        try {
          const price = provider.price(def.endpointKey);
          if (price !== '0.00') {
            if (typeof token !== 'string' || token.length === 0) {
              return paymentRequiredResult(provider, def.endpointKey);
            }
            const v = await provider.verify(token, def.endpointKey);
            if (!v.ok) {
              return paymentRequiredResult(provider, def.endpointKey, v.reason ?? 'invalid');
            }
          }
          const data = await def.run(db, rest, config);
          if (data !== null && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
            const err = (data as { error: { code?: string; message?: string } }).error;
            return errorResult(err.code ?? 'not_found', err.message ?? 'not found');
          }
          return textResult({
            data,
            meta: { price_usd: price, paid: price !== '0.00' },
          });
        } catch (err) {
          return errorResult(
            'internal',
            `Tool ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
            'Retry; if it persists, check arguments against the tool schema.',
          );
        }
      },
    );
  }

  return server;
}

/**
 * Mount a streamable-HTTP MCP endpoint at /mcp (the transport itself is free —
 * payment is per tool call). Uses the payment runtime initialized by
 * buildServer (initPayments); mountMcp never owns initialization.
 *
 * Stateless mode: the SDK requires a fresh transport per request
 * ("Stateless transport cannot be reused across requests"), so each HTTP
 * request gets its own McpServer + transport pair, closed when the connection
 * ends. This matches the SDK's simpleStatelessStreamableHttp pattern.
 */
export function mountMcp(app: FastifyInstance, config: AppConfig, db: Db): void {
  const provider = getPaymentProvider();

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    handler: async (req, reply) => {
      reply.hijack();
      const server = buildMcpServer(provider, db, config);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      reply.raw.on('close', () => {
        void transport.close().catch(() => undefined);
        void server.close().catch(() => undefined);
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req.raw, reply.raw, req.body);
      } catch (err) {
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { 'content-type': 'application/json' });
          reply.raw.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: `MCP transport error: ${String(err)}` },
              id: null,
            }),
          );
        } else {
          reply.raw.end();
        }
      }
    },
  });
}

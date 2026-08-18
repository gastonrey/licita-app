// x402 Bazaar discovery extension (specs/extensions/bazaar.md). Every paid
// REST endpoint and paid MCP tool advertises its discovery info via
// extensions.bazaar on the 402 PaymentRequired, so facilitators can catalog
// Licita in Bazaar search. Uses the official @x402/extensions/bazaar builders
// (declareDiscoveryExtension + sanitizeResourceServiceMetadata) — NOT the
// @x402/fastify server extension, because our custom server implementation on
// @x402/core builds requirements statically.
//
// MCP tool names/descriptions mirror the TOOLS registry in src/mcp/server.ts
// (the 8 paid tools). The module deliberately does NOT import src/mcp/server.ts
// (or src/pay/middleware.ts): doing so would create an ESM circular import
// (mcp/server → middleware → provider → x402Provider → bazaar → mcp/server)
// whose resolution order is load-order dependent. The tool inputSchema values
// below are plain JSON Schema mirrors of the zod shapes registered there.

import {
  declareDiscoveryExtension,
  isValidRouteTemplate,
  sanitizeResourceServiceMetadata,
  type DeclareDiscoveryExtensionInput,
} from '@x402/extensions/bazaar';

/** Bazaar extension payload: { info, schema } from declareDiscoveryExtension,
 *  plus an optional top-level routeTemplate for dynamic REST routes. */
export interface BazaarExtension {
  info: unknown;
  schema: unknown;
  routeTemplate?: string;
}

/** Sanitized Bazaar service metadata merged into PaymentRequired.resource
 *  (validated once at module load; tags ≤5 printable-ASCII strings). */
export const BAZAAR_SERVICE_METADATA: { serviceName?: string; tags?: string[] } =
  sanitizeResourceServiceMetadata({
    url: '', // sanitizeResourceServiceMetadata only checks service metadata fields
    serviceName: 'Licita',
    tags: ['procurement', 'tenders', 'eu', 'contracts', 'ai'],
    description: 'Licita — EU public procurement intelligence for AI agents',
  });

/**
 * Static REST discovery declarations pass the HTTP method explicitly so
 * facilitators catalog the verb without needing request-time enrichment.
 * DeclareDiscoveryExtensionInput deliberately omits `method` (the @x402
 * fastify/server extension injects it per request), so REST configs are cast
 * through the runtime-accepted shape.
 */
function declareRestExtension(config: Record<string, unknown>): { info: unknown; schema: unknown } {
  return declareDiscoveryExtension(config as DeclareDiscoveryExtensionInput).bazaar;
}

// --- placeholder output examples (never real paid data) ----------------------

const OUTPUT_SEARCH = {
  results: [
    {
      kind: 'award',
      id: 12580,
      source_ref: '123456-2026',
      title: 'Suministro de servicios cloud para la administración',
      date: '2026-02-10',
      buyer: { id: 88, name: 'Ministerio de Digitalización' },
      company: { id: 42, name: 'Acme Tecnologías SA' },
      value: 245000,
      currency: 'EUR',
      cpv: '72000000',
      tender_id: 12580,
      tender_source_ref: '123456-2026',
    },
  ],
  page: 1,
  total: 137,
};

const OUTPUT_TENDER = {
  id: 12580,
  source_ref: '123456-2026',
  notice_type: 'can-standard',
  publication_date: '2026-02-10',
  title: 'Suministro de servicios cloud para la administración',
  description: 'Servicios de cloud computing para organismos públicos.',
  cpv_main: '72000000',
  cpv_all: ['72000000', '72222300'],
  procedure_type: 'open',
  deadline: '2026-04-01T12:00:00.000Z',
  estimated_value: 245000,
  currency: 'EUR',
  nuts: 'ES61',
  url: 'https://ted.europa.eu/123456-2026',
  buyer: {
    id: 88,
    name: 'Ministerio de Digitalización',
    country: 'ES',
    nuts: 'ES61',
    org_type: 'national-authority',
  },
  awards: [
    {
      id: 91011,
      tender_id: 12580,
      source_ref: '123456-2026',
      award_date: '2026-05-12',
      lot: 'Lote 1',
      winner: { id: 42, name: 'Acme Tecnologías SA' },
      value: 245000,
      currency: 'EUR',
      bidders_count: 5,
      framework: false,
      duration_months: 24,
      start_date: '2026-07-01',
      end_date: '2028-06-30',
    },
  ],
  provenance: [{ source: 'ted', source_ref: '123456-2026' }],
};

const OUTPUT_COMPANY = {
  id: 42,
  source_ref: 'company-42',
  name: 'Acme Tecnologías SA',
  country: 'ES',
  nif: 'A12345678',
  aliases: ['Acme Tech', 'ACME SA'],
  identifiers: [{ scheme: 'ted', value: 'company-42' }],
  stats: {
    wins: 34,
    total_awarded_value: 5200000,
    top_cpvs: [{ code: '72000000', label_en: 'IT services: consulting, software' }],
    top_buyers: [{ id: 88, name: 'Ministerio de Digitalización', wins: 5 }],
  },
  caveats: ['Values may be understated when lots omit award amounts.'],
  provenance: [{ source: 'ted', source_ref: '123456-2026' }],
};

const OUTPUT_AWARDS = {
  awards: [
    {
      id: 91011,
      tender_id: 12580,
      source_ref: '123456-2026',
      award_date: '2026-05-12',
      lot: 'Lote 1',
      winner: { id: 42, name: 'Acme Tecnologías SA' },
      value: 245000,
      currency: 'EUR',
      bidders_count: 5,
      framework: false,
      duration_months: 24,
      start_date: '2026-07-01',
      end_date: '2028-06-30',
      tender: {
        id: 12580,
        source_ref: '123456-2026',
        title: 'Suministro de servicios cloud para la administración',
        cpv_main: '72000000',
        publication_date: '2026-02-10',
        buyer: { id: 88, name: 'Ministerio de Digitalización' },
      },
    },
  ],
  page: 1,
  total: 34,
};

const OUTPUT_OPPORTUNITIES = {
  opportunities: [
    {
      id: 13001,
      source_ref: '130001-2026',
      title: 'Servicios de ciberseguridad para organismos públicos',
      publication_date: '2026-06-20',
      deadline: '2026-08-01T12:00:00.000Z',
      cpv_main: '72000000',
      estimated_value: 180000,
      currency: 'EUR',
      nuts: 'ES61',
      url: 'https://ted.europa.eu/130001-2026',
      buyer: { id: 88, name: 'Ministerio de Digitalización' },
      score: 0.87,
      same_buyer: true,
      same_cpv: true,
    },
  ],
  page: 1,
  total: 12,
  score_explanation: 'Deterministic similarity over historical CPV/buyer profile.',
};

const OUTPUT_BUYER = {
  id: 88,
  source_ref: 'buyer-88',
  name: 'Ministerio de Digitalización',
  country: 'ES',
  nuts: 'ES61',
  org_type: 'national-authority',
  awards: [
    {
      id: 91011,
      tender_id: 12580,
      source_ref: '123456-2026',
      award_date: '2026-05-12',
      lot: 'Lote 1',
      winner: { id: 42, name: 'Acme Tecnologías SA' },
      value: 245000,
      currency: 'EUR',
      bidders_count: 5,
      framework: false,
      duration_months: 24,
      start_date: '2026-07-01',
      end_date: '2028-06-30',
      tender: { id: 12580, source_ref: '123456-2026', title: 'Suministro de servicios cloud', cpv_main: '72000000' },
    },
  ],
  awards_total: 128,
  awards_returned: 20,
  supplier_concentration: {
    suppliers: [{ id: 42, name: 'Acme Tecnologías SA', wins: 12, total_value: 2100000 }],
    distinct_suppliers: 41,
    top3_share_by_count: 0.4219,
    top3_share_by_value: 0.5231,
  },
  recurrence: [{ cpv_division: '72', awards: 18, median_months_between_awards: 9 }],
  provenance: [{ source: 'ted', source_ref: '123456-2026' }],
};

const OUTPUT_RENEWALS = {
  renewals: [
    {
      id: 7001,
      signal_type: 'expiring_framework',
      cpv: '72000000',
      window_start: '2026-09-01',
      window_end: '2027-09-01',
      confidence: 'high',
      basis: 'framework ends 2027-03; 2 prior awards in window',
      computed_at: '2026-08-18T10:00:00.000Z',
      buyer: { id: 88, name: 'Ministerio de Digitalización' },
      incumbent: { id: 42, name: 'Acme Tecnologías SA' },
      contract: {
        id: 5001,
        title: 'Marco de servicios cloud',
        value: 1200000,
        currency: 'EUR',
        start_date: '2024-03-01',
        end_date: '2027-03-01',
      },
    },
  ],
  page: 1,
  total: 5,
  methodology: 'Deterministic forecast over contract/framework expiry windows.',
  confidence_scale: ['low', 'medium', 'high'],
};

const OUTPUT_RESEARCH = {
  topic: 'health sector IT services',
  confidence: 'high',
  summary: 'Health-sector IT activity is concentrated in 3 active buyers with recurring cloud and cybersecurity tenders.',
  findings: [
    {
      type: 'tender',
      title: 'Servicios de ciberseguridad para hospitales públicos',
      detail: 'Open procedure, 180000 EUR, deadline 2026-08-01.',
      source: 'ted',
      source_ref: '130001-2026',
      timestamp: '2026-06-20',
      evidence: ['Full-text match on title/description; published within 90 days'],
    },
  ],
  windows: { tenders_days: 90, renewals_days: 365 },
};

// --- REST discovery extensions (priced keys) ---------------------------------

const ID_PATH_SCHEMA = {
  type: 'object',
  properties: { id: { type: 'number', description: 'numeric id from search results' } },
  required: ['id'],
} as const;

const PAGE_SIZE_SCHEMA = {
  type: 'object',
  properties: { page: { type: 'number' }, size: { type: 'number' } },
} as const;

const SEARCH_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    q: { type: 'string' },
    cpv: { type: 'string', description: 'CPV code or prefix, e.g. "72"' },
    buyer: { type: 'string' },
    company: { type: 'string' },
    region: { type: 'string', description: 'NUTS code or prefix, e.g. "ES61"' },
    from: { type: 'string', description: 'YYYY-MM-DD' },
    to: { type: 'string', description: 'YYYY-MM-DD' },
    type: { type: 'string', enum: ['award', 'tender', 'contract'] },
    page: { type: 'number' },
    size: { type: 'number' },
  },
} as const;

const RENEWALS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    cpv: { type: 'string' },
    buyer: { type: 'string' },
    window_months: { type: 'number' },
    min_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    page: { type: 'number' },
    size: { type: 'number' },
  },
} as const;

const RESEARCH_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    limit: { type: 'number' },
  },
  required: ['query'],
} as const;

/** Priced REST endpoint keys (resolvePrice returns != '0.00'); keys are the
 *  ENDPOINT_PRICES / priceOverrides keys from src/domain/types.ts. */
const PRICED_REST_KEYS = [
  'GET /v1/search',
  'GET /v1/tenders/:id',
  'GET /v1/companies/:id',
  'GET /v1/companies/:id/awards',
  'GET /v1/companies/:id/opportunities',
  'GET /v1/buyers/:id/history',
  'GET /v1/renewals',
  'POST /v1/research',
] as const;

/** The 5 dynamic REST routes that get a top-level routeTemplate (':param'
 *  syntax, validated with isValidRouteTemplate). Static routes never get one. */
const DYNAMIC_REST_KEYS = new Set<string>([
  'GET /v1/tenders/:id',
  'GET /v1/companies/:id',
  'GET /v1/companies/:id/awards',
  'GET /v1/companies/:id/opportunities',
  'GET /v1/buyers/:id/history',
]);

/** Route template for a dynamic endpoint key ('METHOD /v1/tenders/:id' →
 *  '/v1/tenders/:id'), validated by isValidRouteTemplate; undefined otherwise. */
function routeTemplateFor(endpointKey: string): string | undefined {
  const path = endpointKey.split(' ')[1];
  return path && isValidRouteTemplate(path) ? path : undefined;
}

const REST_EXTENSIONS: Record<string, { info: unknown; schema: unknown }> = {
  'GET /v1/search': declareRestExtension({
    method: 'GET',
    input: { q: 'cloud services', type: 'award', page: 1, size: 20 },
    inputSchema: SEARCH_INPUT_SCHEMA,
    output: { example: OUTPUT_SEARCH },
  }),
  'GET /v1/tenders/:id': declareRestExtension({
    method: 'GET',
    pathParams: { id: 12580 },
    pathParamsSchema: ID_PATH_SCHEMA,
    output: { example: OUTPUT_TENDER },
  }),
  'GET /v1/companies/:id': declareRestExtension({
    method: 'GET',
    pathParams: { id: 42 },
    pathParamsSchema: ID_PATH_SCHEMA,
    output: { example: OUTPUT_COMPANY },
  }),
  'GET /v1/companies/:id/awards': declareRestExtension({
    method: 'GET',
    input: { page: 1, size: 20 },
    inputSchema: PAGE_SIZE_SCHEMA,
    pathParams: { id: 42 },
    pathParamsSchema: ID_PATH_SCHEMA,
    output: { example: OUTPUT_AWARDS },
  }),
  'GET /v1/companies/:id/opportunities': declareRestExtension({
    method: 'GET',
    input: { page: 1, size: 20 },
    inputSchema: PAGE_SIZE_SCHEMA,
    pathParams: { id: 42 },
    pathParamsSchema: ID_PATH_SCHEMA,
    output: { example: OUTPUT_OPPORTUNITIES },
  }),
  'GET /v1/buyers/:id/history': declareRestExtension({
    method: 'GET',
    pathParams: { id: 88 },
    pathParamsSchema: ID_PATH_SCHEMA,
    output: { example: OUTPUT_BUYER },
  }),
  'GET /v1/renewals': declareRestExtension({
    method: 'GET',
    input: { cpv: '72000000', window_months: 12, min_confidence: 'low', page: 1, size: 20 },
    inputSchema: RENEWALS_INPUT_SCHEMA,
    output: { example: OUTPUT_RENEWALS },
  }),
  'POST /v1/research': declareRestExtension({
    method: 'POST',
    bodyType: 'json',
    input: { query: 'health sector IT services', limit: 5 },
    inputSchema: RESEARCH_INPUT_SCHEMA,
    output: { example: OUTPUT_RESEARCH },
  }),
};

// --- MCP discovery extensions (paid tools in src/mcp/server.ts) ---------------

interface PaidMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  example: Record<string, unknown>;
  output: unknown;
}

/** The 8 paid MCP tools from src/mcp/server.ts TOOLS (get_pricing is free and
 *  intentionally omitted). Names + descriptions mirror that registry exactly;
 *  inputSchema values are JSON Schema mirrors of the registered zod shapes. */
const PAID_MCP_TOOLS: PaidMcpTool[] = [
  {
    name: 'search_tenders',
    description:
      'Search Spanish public-sector IT/software/cyber procurement: awards, tenders and contracts. Filters: q (full-text), cpv (prefix), buyer, company, region (NUTS), from/to (YYYY-MM-DD), type=award|tender|contract. Returns compact rows with ids for the other tools.',
    inputSchema: SEARCH_INPUT_SCHEMA,
    example: { q: 'cloud services', type: 'award', page: 1, size: 20 },
    output: OUTPUT_SEARCH,
  },
  {
    name: 'get_tender',
    description:
      'Full tender detail by id: buyer, CPVs, deadline, estimated value, all awards/lots with winners, plus provenance (source + TED url).',
    inputSchema: ID_PATH_SCHEMA,
    example: { id: 12580 },
    output: OUTPUT_TENDER,
  },
  {
    name: 'get_company',
    description:
      "Company profile by id: name, country, NIF, aliases and source identifiers (cross-source identity), plus aggregate stats (wins, total awarded value, top CPVs, top buyers).",
    inputSchema: ID_PATH_SCHEMA,
    example: { id: 42 },
    output: OUTPUT_COMPANY,
  },
  {
    name: 'get_company_awards',
    description: 'Paginated award history for a company: dates, lots, values, tender + buyer context.',
    inputSchema: { ...ID_PATH_SCHEMA, ...PAGE_SIZE_SCHEMA, required: ['id'] },
    example: { id: 42, page: 1, size: 20 },
    output: OUTPUT_AWARDS,
  },
  {
    name: 'get_company_opportunities',
    description:
      "Active/recent tenders matching a company's historical CPV/buyer profile, with a deterministic similarity score (explained in score_explanation).",
    inputSchema: { ...ID_PATH_SCHEMA, ...PAGE_SIZE_SCHEMA, required: ['id'] },
    example: { id: 42, page: 1, size: 20 },
    output: OUTPUT_OPPORTUNITIES,
  },
  {
    name: 'get_buyer_history',
    description:
      'Buyer profile by id: award history, supplier concentration (top-supplier share) and per-CPV-division recurrence (median months between awards).',
    inputSchema: ID_PATH_SCHEMA,
    example: { id: 88 },
    output: OUTPUT_BUYER,
  },
  {
    name: 'get_renewals',
    description:
      'Forecast signals for likely re-tenders: contracts/frameworks approaching renewal. Filters: cpv (prefix), buyer, window_months (default 12, max 36), min_confidence=low|medium|high.',
    inputSchema: RENEWALS_INPUT_SCHEMA,
    example: { cpv: '72000000', window_months: 12, page: 1, size: 20 },
    output: OUTPUT_RENEWALS,
  },
  {
    name: 'research',
    description:
      'High-level EU public procurement intelligence for a topic: recent tenders, relevant renewal signals, company opportunities and active buyers, each with evidence and an evidence-strength confidence label. ' +
      'Deterministic over the licita database (no LLM). Costs $0.50 USDC per call (x402). ' +
      'Use when an agent needs a research brief on a topic rather than raw rows from search_tenders/get_renewals.',
    inputSchema: RESEARCH_INPUT_SCHEMA,
    example: { query: 'health sector IT services', limit: 5 },
    output: OUTPUT_RESEARCH,
  },
];

const MCP_EXTENSIONS: Record<string, { info: unknown; schema: unknown }> = {};
for (const tool of PAID_MCP_TOOLS) {
  MCP_EXTENSIONS[tool.name] = declareDiscoveryExtension({
    toolName: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    transport: 'sse', // Licita's MCP transport is SSE, not the streamable-http default
    example: tool.example,
    output: { example: tool.output },
  }).bazaar;
}

// --- combined registry --------------------------------------------------------

/** Bazaar extension per priced endpoint key (REST) and paid MCP tool name.
 *  REST keys use their ENDPOINT_PRICES key form ('GET /v1/search'); MCP tools
 *  use their tool name ('search_tenders'). */
export const BAZAAR_EXTENSIONS: Record<string, BazaarExtension> = {};
for (const key of PRICED_REST_KEYS) {
  const core = REST_EXTENSIONS[key];
  const template = DYNAMIC_REST_KEYS.has(key) ? routeTemplateFor(key) : undefined;
  BAZAAR_EXTENSIONS[key] = template ? { ...core, routeTemplate: template } : core;
}
for (const [name, core] of Object.entries(MCP_EXTENSIONS)) {
  BAZAAR_EXTENSIONS[name] = core;
}

/**
 * Bazaar discovery extension for an endpoint key (REST key or MCP tool name),
 * or undefined for free/unknown endpoints (GET /v1/demo is free and never
 * declared). Used by the payment providers to attach extensions.bazaar to the
 * 402 PaymentRequired.
 */
export function bazaarExtension(endpointKey: string): BazaarExtension | undefined {
  return BAZAAR_EXTENSIONS[endpointKey];
}
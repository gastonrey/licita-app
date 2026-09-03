// OpenAPI 3.1 document for the licita-agent API (SPEC §5, §7).
// Hand-maintained static object — must match the real routes in src/api/routes/*.

import { ENDPOINT_PRICES } from '../domain/types.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const provenance = {
  type: 'object',
  required: ['source', 'source_ref'],
  properties: {
    source: { type: 'string', example: 'ted' },
    source_ref: { type: 'string', example: '123456-2026' },
    url: { type: 'string', format: 'uri' },
  },
} as const;

const meta = {
  type: 'object',
  required: ['request_id', 'price_usd', 'paid', 'provenance'],
  properties: {
    request_id: { type: 'string', format: 'uuid' },
    price_usd: { type: 'string', example: '0.05' },
    paid: { type: 'boolean' },
    provenance: { type: 'array', items: provenance },
    page: { type: 'integer' },
    total: { type: 'integer' },
    caveats: { type: 'array', items: { type: 'string' } },
    score_explanation: { type: 'string' },
    methodology: {
      type: 'string',
      description:
        'Declares that the returned signals are a deterministic heuristic over historical awards/contract dates, NOT a calibrated probability.',
    },
    confidence_scale: {
      type: 'array',
      items: { type: 'string', enum: ['low', 'medium', 'high'] },
      description: 'The only confidence labels the API emits.',
    },
  },
} as const;

const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          enum: ['invalid_query', 'not_found', 'payment_required', 'rate_limited', 'internal'],
        },
        message: { type: 'string' },
        hint: { type: 'string', description: 'agent-actionable hint' },
      },
    },
  },
} as const;

const envelopeOf = (dataSchema: Record<string, unknown>) => ({
  type: 'object',
  required: ['data', 'meta'],
  properties: { data: dataSchema, meta },
});

const entityRef = {
  anyOf: [
    {
      type: 'object',
      required: ['id', 'name'],
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
    },
    { type: 'null' },
  ],
} as const;

const searchRow = {
  type: 'object',
  required: [
    'kind',
    'id',
    'source_ref',
    'title',
    'date',
    'buyer',
    'company',
    'value',
    'currency',
    'cpv',
    'tender_id',
    'tender_source_ref',
  ],
  properties: {
    kind: { type: 'string', enum: ['award', 'tender', 'contract'] },
    id: { type: 'integer' },
    source_ref: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] },
    date: { type: ['string', 'null'], format: 'date' },
    buyer: entityRef,
    company: entityRef,
    value: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'], example: 'EUR' },
    cpv: { type: ['string', 'null'], example: '72000000' },
    tender_id: {
      type: ['integer', 'null'],
      description: 'Tender this row belongs to (equals id for tender rows).',
    },
    tender_source_ref: {
      type: ['string', 'null'],
      description: 'Tender publication reference (e.g. the TED notice number).',
    },
  },
} as const;

const award = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    tender_id: { type: ['integer', 'null'] },
    source_ref: { type: ['string', 'null'] },
    award_date: { type: ['string', 'null'], format: 'date' },
    lot: { type: ['string', 'null'] },
    winner: entityRef,
    value: { type: ['number', 'null'] },
    currency: { type: ['string', 'null'] },
    bidders_count: { type: ['integer', 'null'] },
    framework: { type: 'boolean' },
    duration_months: { type: ['number', 'null'] },
    start_date: { type: ['string', 'null'], format: 'date' },
    end_date: { type: ['string', 'null'], format: 'date' },
  },
} as const;

const tenderContext = {
  type: 'object',
  properties: {
    id: { type: ['integer', 'null'] },
    source_ref: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] },
    cpv_main: { type: ['string', 'null'] },
    publication_date: { type: ['string', 'null'], format: 'date' },
    buyer: entityRef,
  },
} as const;

/** Award row as returned inside lists that join tender context (company/buyer histories). */
const awardWithTender = {
  ...award,
  properties: { ...award.properties, tender: tenderContext },
} as const;

const paymentRequired = {
  description:
    'Payment required (x402 v2). The response also carries a base64 PAYMENT-REQUIRED header whose JSON is { x402Version: 2, resource, accepts[] }; accepts[0] is the exact requirement (scheme "exact", CAIP-2 network, USDC asset, amount in base units, payTo, maxTimeoutSeconds, EIP-712 domain). Sign an EIP-3009 transferWithAuthorization and retry with header PAYMENT-SIGNATURE (v2; the legacy v1 X-PAYMENT header is still accepted). In dev mode obtain a proof via POST /v1/dev-faucet.',
  headers: {
    'PAYMENT-REQUIRED': {
      description: 'Base64 JSON payment requirements: { x402Version: 2, resource, accepts[] }.',
      schema: { type: 'string' },
    },
  },
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          x402Version: { type: 'integer', enum: [1, 2] },
          resource: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              description: { type: 'string' },
              mimeType: { type: 'string' },
            },
          },
          accepts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                scheme: { type: 'string' },
                network: { type: 'string' },
                asset: { type: 'string' },
                amount: { type: 'string', example: '20000' },
                payTo: { type: 'string' },
                maxTimeoutSeconds: { type: 'integer' },
                extra: { type: 'object' },
                resource: { type: 'string' },
              },
            },
          },
          hint: { type: 'string' },
        },
      },
    },
  },
} as const;

const errResp = (desc: string) => ({
  description: desc,
  content: { 'application/json': { schema: errorSchema } },
});

const stdResponses = (dataSchema: Record<string, unknown>, priced: boolean) => ({
  '200': {
    description: 'Success envelope',
    content: { 'application/json': { schema: envelopeOf(dataSchema) } },
  },
  ...(priced ? { '402': paymentRequired } : {}),
  '400': errResp('Invalid query parameters (invalid_query)'),
  '404': errResp('Not found (not_found)'),
  '429': errResp('Rate limited (rate_limited)'),
  '500': errResp('Internal error (internal)'),
});

/** POST /v1/research request body (matches researchBodySchema in research.ts). */
const researchBody = {
  type: 'object',
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: 'Topic to research: matched against tender full-text, company/buyer names and renewal signals.',
      example: 'health sector IT services',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 10,
      default: 5,
      description: 'Max findings to return (counts in the summary always cover the full set).',
    },
  },
} as const;

/** POST /v1/research data payload (researchData in research.ts). */
const researchData = {
  type: 'object',
  required: ['topic', 'confidence', 'summary', 'findings', 'windows'],
  properties: {
    topic: { type: 'string' },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description:
        'Evidence-strength heuristic over distinct finding types with a finding within the last 90 days (>=2 → high, 1 → medium, else low). NOT a probability estimate.',
    },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'title', 'detail', 'source', 'source_ref', 'timestamp', 'evidence'],
        properties: {
          type: { type: 'string', enum: ['tender', 'renewal', 'opportunity', 'buyer'] },
          title: { type: 'string' },
          detail: { type: 'string' },
          source: { type: 'string', example: 'ted' },
          source_ref: { type: ['string', 'null'], example: '130001-2026' },
          timestamp: { type: 'string', format: 'date' },
          evidence: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    windows: {
      type: 'object',
      properties: {
        tenders_days: { type: 'integer', example: 90 },
        renewals_days: { type: 'integer', example: 365 },
      },
    },
  },
} as const;

/** GET /v1/demo data payload (demoData in demo.ts) — free labeled samples. */
const demoData = {
  type: 'object',
  properties: {
    note: { type: 'string' },
    priced_endpoints: {
      type: 'array',
      items: {
        type: 'object',
        properties: { endpoint: { type: 'string' }, price_usd: { type: 'string' } },
      },
    },
    tender: {
      anyOf: [
        {
          type: 'object',
          required: ['sample'],
          properties: {
            sample: { type: 'boolean', const: true },
            title: { type: ['string', 'null'] },
            buyer: {
              anyOf: [
                {
                  type: 'object',
                  properties: { name: { type: 'string' }, country: { type: ['string', 'null'] } },
                },
                { type: 'null' },
              ],
            },
            cpv_main: { type: ['string', 'null'] },
            estimated_value: { type: ['number', 'null'] },
            currency: { type: ['string', 'null'] },
            published_at: { type: ['string', 'null'], format: 'date' },
            source: { type: 'string' },
            source_ref: { type: ['string', 'null'] },
          },
        },
        { type: 'null' },
      ],
    },
    renewal: {
      anyOf: [
        {
          type: 'object',
          required: ['sample'],
          properties: {
            sample: { type: 'boolean', const: true },
            signal_type: { type: 'string' },
            incumbent: { type: ['string', 'null'] },
            contract: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    title: { type: ['string', 'null'] },
                    end_date: { type: ['string', 'null'], format: 'date' },
                  },
                },
                { type: 'null' },
              ],
            },
            confidence: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
            basis: {},
            source: { type: 'string' },
            source_ref: { type: ['string', 'null'] },
          },
        },
        { type: 'null' },
      ],
    },
  },
} as const;

const demoRequestData = {
  type: 'object',
  required: ['id', 'email', 'channel', 'source_url', 'status', 'created_at'],
  properties: {
    id: { type: 'integer' }, email: { type: 'string', format: 'email' },
    channel: { type: 'string' }, source_url: { type: ['string', 'null'] },
    status: { type: 'string', enum: ['new', 'contacted', 'used', 'paid'] },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

/** GET /v1/stats data payload — P0.7 observability aggregates (kept loose). */
const statsData = {
  type: 'object',
  properties: {
    unique_clients: { type: 'integer' },
    requests_by_endpoint: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          endpoint: { type: 'string' },
          requests: { type: 'integer' },
          paid_requests: { type: 'integer' },
        },
      },
    },
    requests_by_source: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: ['rest', 'mcp'] },
          requests: { type: 'integer' },
        },
      },
    },
    zero_result_queries: {
      type: 'object',
      properties: { count: { type: 'integer' }, rate: { type: 'number', nullable: true } },
    },
    payment_required_responses: { type: 'integer' },
    payment_health: {
      type: 'object',
      description: 'Operator-only payment health breakdown. Distinguishes settled on-chain revenue from verify rejections, no-proof 402s, and facilitator unavailability.',
      properties: {
        settled: {
          type: 'object',
          properties: { count: { type: 'integer' }, amount_usd: { type: 'number' } },
        },
        verify_failed: { type: 'integer', description: 'Payment proof rejected by x402 verify (bad sig, expired, replay).' },
        payment_required: { type: 'integer', description: 'No proof header sent — client did not attempt payment.' },
        facilitator_unavailable: { type: 'integer', description: 'x402 facilitator/RPC unreachable or timed out.' },
        recent_failures: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ts: { type: 'string', format: 'date-time' },
              endpoint: { type: 'string' },
              method: { type: 'string' },
              status: { type: 'integer' },
              error: { type: 'string' },
              paid: { type: 'boolean' },
            },
          },
        },
      },
    },
    payments: {
      type: 'object',
      properties: {
        attempts: { type: 'integer' },
        successes: { type: 'integer' },
        revenue_usd: { type: 'number' },
        by_status: { type: 'object' },
        by_network_provider: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              network: { type: 'string' },
              count: { type: 'integer' },
              amount_usd: { type: 'number' },
            },
          },
        },
      },
    },
    repeat_clients: {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        paid_requests_total: { type: 'integer' },
        top: {
          type: 'array',
          items: {
            type: 'object',
            properties: { client_key: { type: 'string' }, paid_requests: { type: 'integer' } },
          },
        },
      },
    },
    top_searches: {
      type: 'array',
      items: { type: 'object', properties: { q: { type: 'string' }, requests: { type: 'integer' } } },
    },
    unique_user_agents: {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        top: {
          type: 'array',
          items: {
            type: 'object',
            properties: { user_agent: { type: 'string' }, requests: { type: 'integer' } },
          },
        },
      },
    },
    top_requested: {
      type: 'object',
      properties: {
        cpvs: { type: 'array' },
        buyers: { type: 'array' },
        companies: { type: 'array' },
      },
    },
    failed_queries: { type: 'integer' },
    failed_requests_rate: {
      type: 'object',
      properties: { count: { type: 'integer' }, total: { type: 'integer' }, rate: { type: 'number', nullable: true } },
    },
    data_null_rates: { type: 'object' },
    in_memory_metrics: { type: 'object' },
    caq_by_channel: { type: 'array' }, growth: { type: 'object' },
    revenue_new_vs_repeat: { type: 'object' }, demo_pipeline: { type: 'object' },
    endpoint_economics: { type: 'array' }, zero_result_by_endpoint: { type: 'array' },
  },
} as const;

/** GET /v1/stats/recent row — one request_logs entry (operator dashboard feed). */
const recentStatsRow = {
  type: 'object',
  properties: {
    ts: { type: 'string', format: 'date-time' },
    client_key: { type: ['string', 'null'] },
    endpoint: { type: ['string', 'null'] },
    method: { type: ['string', 'null'] },
    status: { type: ['integer', 'null'] },
    latency_ms: { type: ['integer', 'null'] },
    paid: { type: 'boolean' },
    source: { type: ['string', 'null'], enum: ['rest', 'mcp'] },
    user_agent: { type: ['string', 'null'] },
    q: { type: ['string', 'null'] },
    cpv: { type: ['string', 'null'] },
    buyer: { type: ['string', 'null'] },
    company: { type: ['string', 'null'] },
    error: { type: ['string', 'null'] },
  },
} as const;

// --- parameter schemas ------------------------------------------------------------

const qParam = (name: string, description: string, schema: Record<string, unknown>) => ({
  name,
  in: 'query',
  required: false,
  description,
  schema,
});

const pageParams = [
  qParam('page', 'Page number (1-based)', { type: 'integer', minimum: 1, default: 1 }),
  qParam('size', 'Page size (max 100)', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
];

const cpvParam = qParam('cpv', 'CPV code or prefix, e.g. "72" matches 72*', {
  type: 'string',
  pattern: '^\\d{2,8}(-\\d)?$',
});

const idPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Internal numeric id (obtain via /v1/search)',
  schema: { type: 'integer', minimum: 1 },
} as const;

/** x-client-key header shared by the billing paths (P2 prepaid credits). */
const xClientKeyHeader = {
  name: 'x-client-key',
  in: 'header',
  required: true,
  description: 'Prepaid credit account key. Buy a bundle at POST /v1/billing/credits/{amount}, then pay from balance.',
  schema: { type: 'string', minLength: 1, maxLength: 200 },
} as const;

/** GET /v1/billing data payload (billingGetHandler in billing.ts). */
const billingBalanceData = {
  type: 'object',
  required: ['client_key', 'balance_cents', 'balance_usd'],
  properties: {
    client_key: { type: 'string' },
    balance_cents: { type: 'integer' },
    balance_usd: { type: 'string', example: '5.00' },
  },
} as const;

/** POST /v1/billing/credits/{amount} data payload (billingPurchaseHandler). */
const billingPurchaseData = {
  type: 'object',
  required: ['client_key', 'added_cents', 'balance_cents', 'balance_usd'],
  properties: {
    client_key: { type: 'string' },
    added_cents: { type: 'integer' },
    balance_cents: { type: 'integer' },
    balance_usd: { type: 'string', example: '5.00' },
  },
} as const;

const desc = (key: string, text: string) =>
  `${text} Price: $${ENDPOINT_PRICES[key]} per call${ENDPOINT_PRICES[key] === '0.00' ? ' (free)' : ''}.`;

// --- paths --------------------------------------------------------------------------

function paths(): Record<string, unknown> {
  return {
    '/v1/search': {
      get: {
        operationId: 'search',
        security: [{ paymentSignature: [] }],
        summary: 'Search awards, tenders and contracts',
        description: desc(
          'GET /v1/search',
          'Full-text + structured search. q uses Postgres FTS (spanish) over tender title/description.',
        ),
        parameters: [
          qParam('q', 'Full-text query (plainto_tsquery, spanish)', { type: 'string', maxLength: 200 }),
          cpvParam,
          qParam('buyer', 'Buyer name fragment (case/accent-insensitive)', { type: 'string', minLength: 2, maxLength: 200 }),
          qParam('company', 'Company name fragment (case/accent-insensitive)', { type: 'string', minLength: 2, maxLength: 200 }),
          qParam('region', 'NUTS region code or prefix, e.g. "ES61"', { type: 'string', pattern: '^[A-Za-z]{2}[A-Za-z0-9]{0,3}$' }),
          qParam('from', 'Start date, ISO YYYY-MM-DD (award_date / publication_date / start_date per type)', { type: 'string', format: 'date' }),
          qParam('to', 'End date, ISO YYYY-MM-DD', { type: 'string', format: 'date' }),
          qParam('type', 'Row kind to search', { type: 'string', enum: ['award', 'tender', 'contract'], default: 'award' }),
          ...pageParams,
        ],
        responses: stdResponses({ type: 'array', items: searchRow }, true),
      },
    },
    '/v1/tenders/{id}': {
      get: {
        operationId: 'getTender',
        security: [{ paymentSignature: [] }],
        summary: 'Full tender with awards and provenance',
        description: desc('GET /v1/tenders/:id', 'Full tender record, its awards, and provenance including the TED notice URL.'),
        parameters: [idPathParam],
        responses: stdResponses(
          {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              source_ref: { type: ['string', 'null'] },
              notice_type: { type: ['string', 'null'] },
              publication_date: { type: ['string', 'null'], format: 'date' },
              title: { type: ['string', 'null'] },
              description: { type: ['string', 'null'] },
              cpv_main: { type: ['string', 'null'] },
              cpv_all: { type: 'array', items: { type: 'string' } },
              procedure_type: { type: ['string', 'null'] },
              deadline: { type: ['string', 'null'], format: 'date-time' },
              estimated_value: { type: ['number', 'null'] },
              currency: { type: ['string', 'null'] },
              nuts: { type: ['string', 'null'] },
              url: { type: ['string', 'null'], format: 'uri' },
              buyer: entityRef,
              awards: { type: 'array', items: award },
            },
          },
          true,
        ),
      },
    },
    '/v1/companies/{id}': {
      get: {
        operationId: 'getCompany',
        security: [{ paymentSignature: [] }],
        summary: 'Company profile with aggregate win stats',
        description: desc(
          'GET /v1/companies/:id',
          'Company profile plus cross-source identity (aliases, identifiers) and aggregates: wins, total awarded value (framework values are ceilings — see meta.caveats), top CPVs, top buyers.',
        ),
        parameters: [idPathParam],
        responses: stdResponses(
          {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              source_ref: { type: ['string', 'null'] },
              name: { type: 'string' },
              country: { type: ['string', 'null'] },
              nif: { type: ['string', 'null'] },
              aliases: {
                type: 'array',
                items: { type: 'string' },
                description: 'Alternative names observed for this company in source payloads.',
              },
              identifiers: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['scheme', 'value'],
                  properties: {
                    scheme: { type: 'string', enum: ['nif', 'ted', 'placsp'] },
                    value: { type: 'string' },
                  },
                },
                description:
                  'Cross-source identity: the normalized NIF plus each source\'s source_ref linked to this company.',
              },
              stats: {
                type: 'object',
                properties: {
                  wins: { type: 'integer' },
                  total_awarded_value: { type: ['number', 'null'] },
                  top_cpvs: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        code: { type: 'string' },
                        label_en: { type: ['string', 'null'] },
                        label_es: { type: ['string', 'null'] },
                        wins: { type: 'integer' },
                        total_value: { type: ['number', 'null'] },
                      },
                    },
                  },
                  top_buyers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' },
                        wins: { type: 'integer' },
                        total_value: { type: ['number', 'null'] },
                      },
                    },
                  },
                },
              },
            },
          },
          true,
        ),
      },
    },
    '/v1/companies/{id}/awards': {
      get: {
        operationId: 'getCompanyAwards',
        security: [{ paymentSignature: [] }],
        summary: 'Paginated awards won by a company',
        description: desc(
          'GET /v1/companies/:id/awards',
          'Paginated award list with tender context (tender id, source ref, buyer).',
        ),
        parameters: [idPathParam, ...pageParams],
        responses: stdResponses({ type: 'array', items: awardWithTender }, true),
      },
    },
    '/v1/companies/{id}/opportunities': {
      get: {
        operationId: 'getCompanyOpportunities',
        security: [{ paymentSignature: [] }],
        summary: 'Active tenders matching a company\'s historical CPV/buyer profile',
        description: desc(
          'GET /v1/companies/:id/opportunities',
          'Active/recent tenders (published within 90 days or future deadline) sharing cpv_main or buyer with the company\'s award history, ranked by a deterministic score explained in meta.score_explanation.',
        ),
        parameters: [idPathParam, ...pageParams],
        responses: stdResponses(
          {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                source_ref: { type: ['string', 'null'] },
                title: { type: ['string', 'null'] },
                publication_date: { type: ['string', 'null'], format: 'date' },
                deadline: { type: ['string', 'null'], format: 'date-time' },
                cpv_main: { type: ['string', 'null'] },
                estimated_value: { type: ['number', 'null'] },
                currency: { type: ['string', 'null'] },
                nuts: { type: ['string', 'null'] },
                url: { type: ['string', 'null'] },
                buyer: entityRef,
                score: { type: 'integer' },
                same_buyer: { type: 'boolean' },
                same_cpv: { type: 'boolean' },
              },
            },
          },
          true,
        ),
      },
    },
    '/v1/buyers/{id}/history': {
      get: {
        operationId: 'getBuyerHistory',
        security: [{ paymentSignature: [] }],
        summary: 'Buyer profile, award history, supplier concentration and recurrence',
        description: desc(
          'GET /v1/buyers/:id/history',
          'Buyer profile + recent awards + top-3 supplier concentration (share by count and by value) + recurrence summary (median months between awards per CPV division).',
        ),
        parameters: [idPathParam],
        responses: stdResponses(
          {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              source_ref: { type: ['string', 'null'] },
              name: { type: 'string' },
              country: { type: ['string', 'null'] },
              nuts: { type: ['string', 'null'] },
              org_type: { type: ['string', 'null'] },
              awards: { type: 'array', items: awardWithTender },
              awards_total: { type: 'integer' },
              awards_returned: { type: 'integer' },
              supplier_concentration: {
                type: 'object',
                properties: {
                  suppliers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' },
                        wins: { type: 'integer' },
                        total_value: { type: ['number', 'null'] },
                      },
                    },
                  },
                  distinct_suppliers: { type: 'integer' },
                  top3_share_by_count: { type: ['number', 'null'] },
                  top3_share_by_value: { type: ['number', 'null'] },
                },
              },
              recurrence: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    cpv_division: { type: 'string' },
                    awards: { type: 'integer' },
                    median_months_between_awards: { type: ['number', 'null'] },
                  },
                },
              },
            },
          },
          true,
        ),
      },
    },
    '/v1/renewals': {
      get: {
        operationId: 'getRenewals',
        security: [{ paymentSignature: [] }],
        summary: 'Forecast renewal/re-tender signals',
        description: desc(
          'GET /v1/renewals',
          'Forecast signals (framework_expiry | duration_expiry | recurrence) joined with contract, buyer and incumbent. ' +
            'Signals are a deterministic heuristic over historical awards and contract dates — NOT calibrated probabilities; ' +
            'meta.methodology and each signal\'s basis expose the evidence and confidence rule behind every row.',
        ),
        parameters: [
          cpvParam,
          qParam('buyer', 'Buyer name fragment (case/accent-insensitive)', { type: 'string', minLength: 2, maxLength: 200 }),
          qParam('window_months', 'Only signals whose window starts within this many months (default 12, max 36)', {
            type: 'integer', minimum: 1, maximum: 36, default: 12,
          }),
          qParam('min_confidence', 'Minimum confidence', { type: 'string', enum: ['low', 'medium', 'high'], default: 'low' }),
          ...pageParams,
        ],
        responses: stdResponses(
          {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                signal_type: { type: 'string', enum: ['framework_expiry', 'duration_expiry', 'recurrence'] },
                cpv: { type: ['string', 'null'] },
                window_start: { type: ['string', 'null'], format: 'date' },
                window_end: { type: ['string', 'null'], format: 'date' },
                confidence: { type: ['string', 'null'], enum: ['low', 'medium', 'high', null] },
                basis: {},
                computed_at: { type: ['string', 'null'], format: 'date-time' },
                buyer: entityRef,
                incumbent: entityRef,
                contract: {
                  anyOf: [
                    {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        title: { type: ['string', 'null'] },
                        value: { type: ['number', 'null'] },
                        currency: { type: ['string', 'null'] },
                        start_date: { type: ['string', 'null'], format: 'date' },
                        end_date: { type: ['string', 'null'], format: 'date' },
                      },
                    },
                    { type: 'null' },
                  ],
                },
              },
            },
          },
          true,
        ),
      },
    },
    '/v1/pricing': {
      get: {
        operationId: 'getPricing',
        summary: 'Machine-readable price ladder, payment flow and credit bundles',
        description:
          'Free endpoint listing all endpoint prices from the fixed price table, the x402 payment flow, and the prepaid credit bundle ladder (billing.mechanism=prepaid_credits).',
        responses: stdResponses(
          {
            type: 'object',
            properties: {
              currency: { type: 'string', enum: ['USD'] },
              payments_mode: { type: 'string', enum: ['dev', 'x402'] },
              endpoints: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    endpoint: { type: 'string', example: 'GET /v1/search' },
                    price_usd: { type: 'string', example: '0.02' },
                    free: { type: 'boolean' },
                  },
                },
              },
              billing: {
                type: 'object',
                description: 'Prepaid credit bundles (P2): one-time x402 purchase, then pay from balance with x-client-key.',
                properties: {
                  mechanism: { type: 'string', enum: ['prepaid_credits'] },
                  bundles: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        amount_usd: { type: 'string', example: '5.00' },
                        endpoint: { type: 'string', example: 'POST /v1/billing/credits/5' },
                      },
                    },
                  },
                  balance_endpoint: { type: 'string', example: 'GET /v1/billing' },
                  usage: { type: 'string' },
                },
              },
              payment_flow: { type: 'object' },
            },
          },
          false,
        ),
      },
    },
    '/v1/research': {
      post: {
        operationId: 'research',
        security: [{ paymentSignature: [] }],
        summary: 'Research a topic across EU procurement',
        description:
          'Deterministic high-level EU procurement intelligence for a topic: recent tenders (full-text match, 90-day window), renewal signals (12-month window), company opportunities and active buyers. Confidence is an evidence-strength heuristic over distinct finding types with recent data (>=2 types with a finding in the last 90 days → high; 1 → medium; else low) — NOT a probability estimate. Price is config-driven (RESEARCH_PRICE_USD, default $0.50 per call) and always paid.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: researchBody } },
        },
        responses: stdResponses(researchData, true),
      },
    },
    '/v1/demo': {
      get: {
        operationId: 'getDemo',
        summary: 'Free labeled sample of the paid data',
        description:
          'Free, zero-cost sample of what the paid API returns: the single most recent tender and the single most recent renewal signal (each under an explicit sample: true marker) plus the list of currently priced endpoints. Values are real rows — never fabricated.',
        responses: stdResponses(demoData, false),
      },
    },
    '/v1/demo/request': {
      post: {
        operationId: 'createDemoRequest', summary: 'Request a product demo',
        description: 'Free public solo-email demo request capture.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } } } },
        responses: { '201': { description: 'Demo request captured', content: { 'application/json': { schema: envelopeOf(demoRequestData) } } }, '400': errResp('Invalid email'), '429': errResp('Rate limited') },
      },
    },
    '/v1/billing': {
      get: {
        operationId: 'getBilling',
        summary: 'Prepaid credit balance for a client key',
        description:
          'Free. Requires header x-client-key. Returns the balance in cents and USD for the credit account, or 404 when no account exists yet. Buy credits at POST /v1/billing/credits/{amount} (5, 10 or 25) — a one-time x402 purchase, no subscription.',
        parameters: [xClientKeyHeader],
        responses: stdResponses(billingBalanceData, false),
      },
    },
    '/v1/billing/credits/{amount}': {
      post: {
        operationId: 'purchaseCredits',
        security: [{ paymentSignature: [] }],
        summary: 'Buy a prepaid credit bundle (5/10/25 USD)',
        description:
          'Paid (x402 v2, same flow as every priced endpoint): obtain the PAYMENT-REQUIRED requirement for POST /v1/billing/credits/{amount}, pay with an x402 client, retry with PAYMENT-SIGNATURE (legacy v1 X-PAYMENT accepted). The payment row is recorded (unique proof) and the account is credited atomically. Requires header x-client-key. Afterwards send x-client-key on every priced request to pay from balance.',
        parameters: [
          {
            name: 'amount',
            in: 'path',
            required: true,
            description: 'Bundle amount in USD.',
            schema: { type: 'integer', enum: [5, 10, 25] },
          },
          xClientKeyHeader,
        ],
        responses: stdResponses(billingPurchaseData, true),
      },
    },
    '/v1/stats': {
      get: {
        operationId: 'getStats',
        summary: 'Operator observability aggregates',
        description:
          'Free, operator-only. Requires header x-operator-key. One JSON document aggregating request_logs and payments: unique clients, requests by endpoint and by source (rest/mcp), zero-result queries, payment-required responses, payment health (settled/verify_failed/payment_required/facilitator_unavailable + recent failures), payment attempts/successes, revenue (by status and by network/provider), repeat paid clients, top searches, unique user agents, top requested CPVs/buyers/companies, failed queries + rate, data-null rates.',
        parameters: [
          {
            name: 'x-operator-key',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
          qParam('from', 'Start date, YYYY-MM-DD', { type: 'string', format: 'date' }),
          qParam('to', 'End date, YYYY-MM-DD', { type: 'string', format: 'date' }),
        ],
        responses: {
          '200': {
            description: 'Observability envelope',
            content: { 'application/json': { schema: envelopeOf(statsData) } },
          },
          '401': errResp('Missing/invalid operator key'),
        },
      },
    },
    '/v1/stats/demo': {
      get: {
        operationId: 'getDemoStats', summary: 'List demo requests (operator only)',
        parameters: [{ name: 'x-operator-key', in: 'header', required: true, schema: { type: 'string' } }, qParam('limit', 'Maximum rows, up to 200', { type: 'integer', maximum: 200 })],
        responses: { '200': { description: 'Demo request list', content: { 'application/json': { schema: envelopeOf({ type: 'object' }) } } }, '401': errResp('Missing/invalid operator key') },
      },
    },
    '/v1/stats/recent': {
      get: {
        operationId: 'getRecentStats',
        summary: 'Recent request-log rows (operator only)',
        description:
          'Free, operator-only. Requires header x-operator-key. Raw request_logs rows (ts, client_key, endpoint, method, status, latency_ms, paid, source, user_agent, q, cpv, buyer, company, error) ordered by ts DESC, newest first. Feeds the operator dashboard; not part of the public price ladder.',
        parameters: [
          {
            name: 'x-operator-key',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            description: 'Max rows to return (default 50, clamped to 200).',
            schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          },
        ],
        responses: {
          '200': {
            description: 'Observability envelope',
            content: {
              'application/json': { schema: envelopeOf({ type: 'array', items: recentStatsRow }) },
            },
          },
          '401': errResp('Missing/invalid operator key'),
        },
      },
    },
    '/openapi.json': {
      get: {
        operationId: 'getOpenApi',
        summary: 'This OpenAPI document',
        responses: { '200': { description: 'OpenAPI 3.1 JSON document' } },
      },
    },
    '/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Liveness/readiness probe',
        description:
          'Free, no payment hook. 200 { status: "ok", db: "up" } when a trivial SELECT 1 succeeds within a short timeout; 503 { status: "degraded", db: "down" } otherwise.',
        responses: {
          '200': { description: 'Service healthy; database reachable' },
          '503': { description: 'Service degraded; database unreachable' },
        },
      },
    },
  };
}

export function buildOpenApi(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Licita',
      version: '0.1.0',
      description:
        'Agent-native procurement intelligence API for the Spanish public sector (TED data, IT/software/cyber CPV vertical). ' +
        'All data endpoints return the envelope { data, meta: { request_id, price_usd, paid, provenance[] } }. ' +
        'Errors return { error: { code, message, hint } }. Paid endpoints use x402 v2: an unpaid request gets 402 with a ' +
        'base64 PAYMENT-REQUIRED header; sign the EIP-3009 transferWithAuthorization and retry with the PAYMENT-SIGNATURE ' +
        'header (legacy v1 X-PAYMENT still accepted). See /v1/pricing for the full flow. ' +
        'Discovery: paid 402s carry extensions.bazaar (x402 Bazaar extension) so facilitators can catalog this service, ' +
        'and the MCP surface is described statically at /.well-known/mcp/server-card.json (SEP-1649 server card).',
    },
    servers: [{ url: '/' }],
    paths: paths(),
    components: {
      schemas: {
        Error: errorSchema,
        Provenance: provenance,
        Meta: meta,
        SearchRow: searchRow,
        Award: award,
      },
      securitySchemes: {
        paymentSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'PAYMENT-SIGNATURE',
          description:
            'x402 v2 payment payload (base64 JSON) proving payment for this call. Obtained by paying the requirement in the 402 PAYMENT-REQUIRED header: an EIP-3009 transferWithAuthorization of USDC on the stated network. The legacy v1 X-PAYMENT header is also accepted.',
        },
      },
    },
  };
}

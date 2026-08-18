// Shared domain types — the interface contract between modules. Do not change unilaterally.

export interface Provenance {
  source: string;       // e.g. "ted"
  source_ref: string;   // e.g. TED publication number "123456-2026"
  url?: string;
}

export interface Envelope<T> {
  data: T;
  meta: {
    request_id: string;
    price_usd: string;
    paid: boolean;
    provenance: Provenance[];
    page?: number;
    total?: number;
  };
}

export interface ApiError {
  error: {
    code: 'invalid_query' | 'not_found' | 'payment_required' | 'rate_limited' | 'internal';
    message: string;
    hint?: string;
  };
}

// TED Search API v3 response (subset we consume). Fields arrive as arrays.
export interface TedNotice {
  'publication-number'?: string[];
  'notice-type'?: string[];
  'publication-date'?: string[];
  'buyer-name'?: Array<{ content?: string; lang?: string } | string>;
  'buyer-country'?: string[];
  'place-of-performance'?: string[];
  'classification-cpv'?: string[];
  'winner-name'?: Array<{ content?: string; lang?: string } | string>;
  'winner-country'?: string[];
  'total-value-lot'?: Array<{ content?: number | string; currency?: string } | number | string>;
  'received-submissions-type-val'?: Array<number | string>;
  'framework-agreement-lot'?: Array<boolean | string>;
  'duration-period-value-lot'?: Array<number | string>;
  'dispatch-date'?: string[];
  'deadline'?: string[];
  'document-sent-date'?: string[];
  links?: { notice?: Record<string, string> };
  [key: string]: unknown;
}

export interface TedSearchResponse {
  notices: TedNotice[];
  totalNoticeCount?: number;
  iterationNextToken?: string;
}

// Normalized rows ready for upsert (see migrations/001_core.sql).
export interface NormalizedAward {
  sourceRef: string;         // publication number
  noticeType: string | null;
  publicationDate: string | null;
  buyer: { sourceRef: string; name: string; country: string | null; nuts: string | null };
  title: string | null;
  description: string | null;
  cpvs: string[];
  winner: { sourceRef: string; name: string; country: string | null } | null;
  value: number | null;
  currency: string | null;
  awardDate: string | null;
  biddersCount: number | null;
  framework: boolean;
  durationMonths: number | null;
  url: string | null;
  raw: unknown;
}

// Payment contract (src/pay/*)
/**
 * Legacy x402 v1-shaped 402 body. Used by the dev provider (PAYMENTS_MODE=dev)
 * only — it is NOT what a production x402 deployment emits.
 */
export interface PaymentRequirementV1 {
  x402Version: 1;
  accepts: Array<{
    scheme: string;
    network: string;
    asset: string;
    amount: string; // USD, decimal string e.g. "0.05"
    payTo: string;
    resource: string;
  }>;
  hint: string;
}

/**
 * x402 v2 payment requirements (current protocol). Mirrors the wire
 * PaymentRequired object ({ x402Version: 2, resource, accepts[] }) so it can
 * be base64-encoded straight into the PAYMENT-REQUIRED response header;
 * `hint` is our operator-facing addition and is stripped from the header.
 * accepts[].amount is in asset base units (USDC = 6 decimals).
 * `extensions` carries protocol extensions (e.g. the bazaar discovery
 * extension) and `resource` carries sanitized Bazaar service metadata.
 */
export interface PaymentRequirementV2 {
  x402Version: 2;
  resource: {
    url: string;
    description?: string;
    mimeType?: string;
    serviceName?: string;
    tags?: string[];
  };
  accepts: Array<{
    scheme: string;
    network: string; // CAIP-2, e.g. "eip155:84532"
    asset: string; // token contract address (USDC for the network)
    amount: string; // base units, e.g. "20000" = $0.02
    payTo: string;
    maxTimeoutSeconds: number;
    extra: Record<string, unknown>; // EIP-3009 domain: { name, version }
  }>;
  hint: string;
  extensions?: Record<string, unknown>;
}

export type PaymentRequirement = PaymentRequirementV1 | PaymentRequirementV2;

export interface PaymentVerification {
  ok: boolean;
  clientKey?: string;
  amount?: string;
  reason?: string;
  /** x402: payer wallet address (pseudonymous on-chain identity). */
  payer?: string;
  /** x402: on-chain settlement transaction hash. */
  txHash?: string;
  /** Number of facilitator attempts used (verify + settle). 1 = no retries. */
  attempts?: number;
  /** Facilitator EXTENSION-RESPONSES (e.g. bazaar.status) echoed back on settle, when present. */
  bazaar?: unknown;
}

export interface PaymentProvider {
  readonly name: string;
  price(endpoint: string): string; // USD decimal string; "0.00" = free
  requiredResponse(endpoint: string): PaymentRequirement;
  verify(proof: string, endpoint: string): Promise<PaymentVerification>;
}

// Endpoint keys used for pricing (fixed — routes must use these)
export const ENDPOINT_PRICES: Record<string, string> = {
  'GET /v1/search': '0.02',
  'GET /v1/tenders/:id': '0.02',
  'GET /v1/companies/:id': '0.05',
  'GET /v1/companies/:id/awards': '0.05',
  'GET /v1/companies/:id/opportunities': '0.10',
  'GET /v1/buyers/:id/history': '0.05',
  'GET /v1/renewals': '0.25',
  'GET /v1/pricing': '0.00',
  'GET /v1/stats': '0.00',
  'GET /v1/demo': '0.00',
};

// POST /v1/research is deliberately NOT in ENDPOINT_PRICES: its price is
// config-owned (RESEARCH_PRICE_USD via src/pay/prices.ts) and always paid.

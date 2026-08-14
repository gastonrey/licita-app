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
export interface PaymentRequirement {
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

export interface PaymentVerification {
  ok: boolean;
  clientKey?: string;
  amount?: string;
  reason?: string;
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
};

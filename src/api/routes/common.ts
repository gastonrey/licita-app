// Shared helpers for all /v1 routes: envelope builders, error envelope,
// SQL param bag, validation preHandlers, row mappers. Pure where practical.

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ZodType } from 'zod';
import { ENDPOINT_PRICES, type ApiError, type Envelope, type Provenance } from '../../domain/types.js';
import type { AppConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import type { Logger } from '../../obs/log.js';
import type { Metrics } from '../../obs/metrics.js';

// Payment shape set on request by W3's paymentPreHandler (src/pay/middleware.ts).
export interface RequestPayment {
  paid: boolean;
  priceUsd: string;
  clientKey?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    payment?: RequestPayment;
    errorCode?: string;
    /** set by handlers when a paginated data response returned zero rows (P0.7) */
    zeroResult?: boolean;
    /** raw (unparsed) request body string, stashed by the URL-gated JSON
     *  content-type parser in server.ts for signature verification on the
     *  Creem webhook route (the signature covers the exact bytes). */
    rawBody?: string;
  }
}

export interface RouteCtx {
  config: AppConfig;
  db: Db;
  log: Logger;
  metrics: Metrics;
}

/** Factory signature of W3's paymentPreHandler — injected by server.ts so route
 * modules stay importable without src/pay. */
export type PaymentPreHandlerFactory = (endpointKey: string) => preHandlerHookHandler;

// --- errors ------------------------------------------------------------------

export type ErrorCode = ApiError['error']['code'];

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: ErrorCode,
    message: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorEnvelope(code: ErrorCode, message: string, hint?: string): ApiError {
  return { error: { code, message, ...(hint ? { hint } : {}) } };
}

export function notFound(what: string): HttpError {
  return new HttpError(404, 'not_found', `${what} not found`, 'Verify the id via GET /v1/search first.');
}

// --- envelope ----------------------------------------------------------------

export interface EnvelopeOpts {
  provenance?: Provenance[];
  page?: number;
  total?: number;
  /** extra meta fields, e.g. caveats, score_explanation */
  meta?: Record<string, unknown>;
}

export function envelope<T>(req: FastifyRequest, data: T, opts: EnvelopeOpts = {}): Envelope<T> {
  const meta: Envelope<T>['meta'] & Record<string, unknown> = {
    request_id: req.id,
    price_usd: req.payment?.priceUsd ?? '0.00',
    paid: req.payment?.paid ?? false,
    provenance: opts.provenance ?? [],
    ...(opts.page !== undefined ? { page: opts.page } : {}),
    ...(opts.total !== undefined ? { total: opts.total } : {}),
    ...(opts.meta ?? {}),
  };
  return { data, meta } as Envelope<T>;
}

// --- validation preHandler ----------------------------------------------------

/**
 * Fastify preHandler that validates req[source] against a zod schema and
 * replaces it with the parsed (coerced/defaulted) value. Throws HttpError
 * (400 invalid_query) on failure, mapped by the global error handler.
 */
export function validate<S extends ZodType>(
  schema: S,
  source: 'query' | 'params' | 'body',
): preHandlerHookHandler {
  return async (req) => {
    const raw = source === 'query' ? req.query : source === 'params' ? req.params : req.body;
    const parsed = schema.safeParse(raw ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || source}: ${i.message}`)
        .join('; ');
      throw new HttpError(
        400,
        'invalid_query',
        `Invalid ${source} parameters: ${issues}`,
        'Fix the parameters per GET /openapi.json and retry.',
      );
    }
    if (source === 'query') req.query = parsed.data as FastifyRequest['query'];
    else if (source === 'params') req.params = parsed.data as FastifyRequest['params'];
    else req.body = parsed.data as FastifyRequest['body'];
  };
}

// --- SQL helpers ---------------------------------------------------------------

/** Parameter bag for pure SQL builders. */
export class Params {
  readonly values: unknown[] = [];
  push(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

export function limitOffset(p: Params, page: number, size: number): string {
  return `LIMIT ${p.push(size)} OFFSET ${p.push((page - 1) * size)}`;
}

/** pg returns NUMERIC as string; normalize to number|null. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Date columns come back as Date or string; normalize to YYYY-MM-DD. */
export function dateStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** TED publication numbers look like "123456-2026". Anything else is not a notice id. */
const TED_PUBLICATION_RE = /^\d{1,9}-\d{4}$/;

/**
 * Absolute http(s) URL, or undefined when the value cannot be used as a link.
 * Relative paths and the literals "null" / "undefined" are rejected: the URL
 * parser would otherwise resolve them against a base and produce a "/null" path.
 * The original string is returned unchanged so upstream query encoding is kept.
 */
export function absoluteHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || /^(null|undefined)$/i.test(trimmed)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  if (path === '/null' || path.endsWith('/null')) return undefined;
  return trimmed;
}

/**
 * Canonical TED notice URL from a publication number (e.g. "123456-2026").
 * A stored value is used only when it is an absolute http(s) URL. A missing
 * or garbage stored value falls back to the publication number; non-TED refs
 * (PLACSP folder ids, the string "null") do not invent a TED link.
 */
export function tedUrl(sourceRef: string | null | undefined, stored?: string | null): string | undefined {
  const storedUrl = absoluteHttpUrl(stored);
  if (storedUrl) return storedUrl;
  const ref = sourceRef?.trim();
  if (!ref || !TED_PUBLICATION_RE.test(ref)) return undefined;
  return `https://ted.europa.eu/udl?uri=TED:NOTICE:${encodeURIComponent(ref)}:TEXT:EN:HTML`;
}

/**
 * Public notice URL for a TED or PLACSP row.
 * TED publication numbers become the canonical notice URL when no absolute
 * URL is stored. PLACSP detail links use an opaque idEvl token that cannot
 * be rebuilt from the folder id, so only a stored absolute URL is returned.
 * The result is null when nothing safe can be linked — never a relative path.
 */
export function publicNoticeUrl(
  source: string | null | undefined,
  sourceRef: string | null | undefined,
  stored?: string | null,
): string | null {
  const storedUrl = absoluteHttpUrl(stored);
  if (storedUrl) return storedUrl;
  if (source === 'placsp') return null;
  return tedUrl(sourceRef) ?? null;
}

export function provenanceFor(sourceCode: string, sourceRef: string | null, url?: string | null): Provenance[] {
  if (!sourceRef) return [];
  return [{ source: sourceCode, source_ref: sourceRef, ...(url ? { url } : {}) }];
}

/** Endpoint price lookup used for free/missing-payment fallbacks. */
export function priceOf(endpointKey: string): string {
  return ENDPOINT_PRICES[endpointKey] ?? '0.00';
}

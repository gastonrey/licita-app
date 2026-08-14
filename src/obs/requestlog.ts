// Async, fire-and-forget request_logs writer (SPEC §9). Never throws, never blocks responses.
//
// Data minimization: client_key carries the payment clientKey when the request
// was paid, otherwise a sha256(ip + OPERATOR_KEY) hash of the client IP. Raw
// IP addresses are never stored in new rows (hashIp).

import { createHash } from 'node:crypto';
import type { Db } from '../db/client.js';
import type { Logger } from './log.js';

export type RequestSource = 'rest' | 'mcp';

export interface RequestLogEntry {
  client_key: string | null;
  endpoint: string;
  method: string;
  status: number;
  latency_ms: number;
  cpv?: string | null;
  buyer?: string | null;
  company?: string | null;
  error?: string | null;
  paid: boolean;
  /** validated search query text (truncated to 200 chars) */
  q?: string | null;
  /** true when a search/renewals/awards/opportunities/history call returned empty data */
  zero_result?: boolean;
  /** client user-agent header (truncated to 200 chars) */
  user_agent?: string | null;
  source: RequestSource;
}

const INSERT_SQL = `
INSERT INTO request_logs (client_key, endpoint, method, status, latency_ms, cpv, buyer, company, error, paid, q, zero_result, user_agent, source)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
`;

export function entryValues(e: RequestLogEntry): unknown[] {
  return [
    e.client_key,
    e.endpoint,
    e.method,
    e.status,
    Math.max(0, Math.round(e.latency_ms)),
    e.cpv ?? null,
    e.buyer ?? null,
    e.company ?? null,
    e.error ?? null,
    e.paid,
    e.q ?? null,
    e.zero_result ?? false,
    e.user_agent ?? null,
    e.source,
  ];
}

/**
 * Pseudonymous client key for an IP: sha256(secret:ip) so the raw IP is never
 * persisted. Deterministic per (ip, secret) so repeated clients are still
 * countable across rows.
 */
export function hashIp(ip: string, secret: string): string {
  return `ip_${createHash('sha256').update(`${secret}:${ip}`).digest('hex').slice(0, 24)}`;
}

/** Truncate a string field to the column width (200). Null for empty input. */
export function strField(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : null;
  if (!s || s.length === 0) return null;
  return s.slice(0, 200);
}

/**
 * Fire-and-forget insert. Errors are swallowed (logged at warn) so logging can
 * never break a request path.
 */
export function logRequest(db: Db, log: Logger, entry: RequestLogEntry): void {
  try {
    const p = db.query(INSERT_SQL, entryValues(entry));
    p.catch((err: unknown) => {
      log.warn('request_logs insert failed', { error: String(err) });
    });
  } catch (err) {
    log.warn('request_logs insert failed', { error: String(err) });
  }
}

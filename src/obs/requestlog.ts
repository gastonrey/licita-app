// Async, fire-and-forget request_logs writer (SPEC §9). Never throws, never blocks responses.

import type { Db } from '../db/client.js';
import type { Logger } from './log.js';

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
}

const INSERT_SQL = `
INSERT INTO request_logs (client_key, endpoint, method, status, latency_ms, cpv, buyer, company, error, paid)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
  ];
}

/**
 * Fire-and-forget insert. Errors are swallowed (logged at warn) so logging can
 * never break a request path.
 */
export function logRequest(db: Db, log: Logger, entry: RequestLogEntry): void {
  db.query(INSERT_SQL, entryValues(entry)).catch((err: unknown) => {
    log.warn('request_logs insert failed', { error: String(err) });
  });
}

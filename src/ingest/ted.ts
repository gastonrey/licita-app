// TED Search API v3 harvester (SPEC §8).
// Anonymous POST https://api.ted.europa.eu/v3/notices/search, ITERATION mode,
// <= 5 req/s, exponential backoff on 429/5xx, idempotent-friendly page stream.
//
// Live-API quirks verified 2026-08-13 (see test/fixtures):
// - pagination mode field is `paginationMode: "ITERATION"` (not `mode`).
// - `buyer-name`/`winner-name` are language maps: { spa: ["..."] }.
// - `publication-date`/`dispatch-date` are scalar strings with tz offsets,
//   e.g. "2026-07-01+02:00"; `total-value` is a scalar number.
// - CPV prefix filter works as `classification-cpv=72*` or `IN (72* 48*)`.
// - value fields live at `total-value` + `total-value-cur` (there is no
//   `total-value-lot`; lot-level values are `result-value-lot` and are almost
//   never populated, so we read the notice-level total).

import type { TedNotice, TedSearchResponse } from '../domain/types.js';

export const TED_SEARCH_URL = 'https://api.ted.europa.eu/v3/notices/search';

// Fields requested per notice. fields.length * pageSize must stay <= 10000.
export const TED_FIELDS = [
  'publication-number',
  'notice-type',
  'publication-date',
  'dispatch-date',
  'buyer-name',
  'buyer-country',
  'buyer-identifier',
  'winner-name',
  'winner-country',
  'winner-identifier',
  'place-of-performance',
  'classification-cpv',
  'title-lot',
  'title-proc',
  'description-lot',
  'total-value',
  'total-value-cur',
  'received-submissions-type-val',
  'framework-agreement-lot',
  'duration-period-value-lot',
  'duration-period-unit-lot',
  'contract-duration-start-date-lot',
  'contract-duration-end-date-lot',
  'winner-decision-date',
  'contract-conclusion-date',
] as const;

export interface TedHarvestOptions {
  /** Harvest window: last N months (env INGEST_MONTHS, default 24). */
  months: number;
  /** Notices per page (max 250). */
  pageSize?: number;
  /** Safety cap of notices for smoke runs/tests. */
  maxNotices?: number;
  /** Minimum delay between request starts in ms (default 200 = 5 req/s). */
  requestDelayMs?: number;
  /** Max retries per request on 429/5xx (default 5). */
  maxRetries?: number;
  /** Backoff base in ms (retry wait = base * 2^attempt + jitter; default 1000). */
  backoffBaseMs?: number;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
  /** Injectable logger; defaults to JSON-lines on stdout. */
  log?: (entry: Record<string, unknown>) => void;
  /** Override "now" (tests). */
  now?: Date;
}

export interface TedHarvestStats {
  noticesSeen: number;
  pages: number;
  totalNoticeCount: number | null;
}

function defaultLog(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'info', ...entry, ts: new Date().toISOString() }));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** YYYYMMDD for the expert query, `months` back from `now`. */
export function windowStartYyyymmdd(months: number, now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCMonth(d.getUTCMonth() - months);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** Expert query per SPEC §8: ES buyer, award notices, IT CPV divisions 72xx/48xx. */
export function buildQuery(sinceYyyymmdd: string): string {
  return (
    `buyer-country=ESP AND notice-type=can-standard ` +
    `AND publication-date>=${sinceYyyymmdd} ` +
    `AND classification-cpv IN (72* 48*)`
  );
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`TED search HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

/** Single search call with exponential backoff on 429/5xx (max `maxRetries`). */
export async function tedSearch(
  body: Record<string, unknown>,
  opts: TedHarvestOptions = { months: 24 },
): Promise<TedSearchResponse> {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxRetries = opts.maxRetries ?? 5;
  const baseMs = opts.backoffBaseMs ?? 1000;
  const log = opts.log ?? defaultLog;
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetchFn(TED_SEARCH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network-level failure: retry with the same backoff policy.
      if (attempt >= maxRetries) throw err;
      const waitMs = 2 ** attempt * baseMs + Math.floor(Math.random() * 250);
      log({ msg: 'ted retry (network)', attempt: attempt + 1, waitMs, error: String(err) });
      await sleep(waitMs);
      attempt += 1;
      continue;
    }
    if (res.ok) {
      return (await res.json()) as TedSearchResponse;
    }
    const text = await res.text().catch(() => '');
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const waitMs = 2 ** attempt * baseMs + Math.floor(Math.random() * 250);
      log({ msg: 'ted retry', status: res.status, attempt: attempt + 1, waitMs });
      await sleep(waitMs);
      attempt += 1;
      continue;
    }
    throw new HttpError(res.status, text);
  }
}

/**
 * Stream award notices for the configured window using ITERATION mode
 * (Elasticsearch point-in-time: consistent pages, no 15k ceiling).
 * Safe to kill at any point: pages already processed are idempotently upserted.
 */
export async function* harvestTedAwards(
  opts: TedHarvestOptions,
): AsyncGenerator<TedNotice, TedHarvestStats, unknown> {
  const pageSize = Math.min(opts.pageSize ?? 250, 250);
  const delayMs = Math.max(opts.requestDelayMs ?? 200, 200); // <= 5 req/s, SPEC §8
  const log = opts.log ?? defaultLog;
  const query = buildQuery(windowStartYyyymmdd(opts.months, opts.now));
  log({ msg: 'ted harvest start', query, pageSize, maxNotices: opts.maxNotices ?? null });

  let token: string | undefined;
  let pages = 0;
  let seen = 0;
  let total: number | null = null;
  let lastRequestAt = 0;

  for (;;) {
    const wait = delayMs - (Date.now() - lastRequestAt);
    if (wait > 0 && lastRequestAt > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const body: Record<string, unknown> = {
      query,
      fields: [...TED_FIELDS],
      limit: pageSize,
      paginationMode: 'ITERATION',
      onlyLatestVersions: true,
    };
    if (token) body.iterationNextToken = token;

    const res = await tedSearch(body, opts);
    pages += 1;
    total = res.totalNoticeCount ?? total;
    const notices = res.notices ?? [];
    log({ msg: 'ted page', page: pages, notices: notices.length, totalNoticeCount: total, seen });

    for (const notice of notices) {
      if (opts.maxNotices !== undefined && seen >= opts.maxNotices) {
        log({ msg: 'ted harvest capped', seen });
        return { noticesSeen: seen, pages, totalNoticeCount: total };
      }
      seen += 1;
      yield notice;
    }

    // ITERATION ends when a page comes back empty or without a next token.
    if (notices.length === 0 || !res.iterationNextToken) break;
    token = res.iterationNextToken;
  }

  log({ msg: 'ted harvest done', seen, pages, totalNoticeCount: total });
  return { noticesSeen: seen, pages, totalNoticeCount: total };
}

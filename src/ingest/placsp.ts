// PLACSP harvester — official sindicación ATOM feeds (P0.3, SPEC §8).
//
// Feeds (verified live 2026-08-14; also the URLs listed on datos.gob.es):
// - licitaciones (all contracting bodies hosted on the platform, no menores):
//   sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom
// - contratos menores:
//   sindicacion_1143/contratosMenoresPerfilesContratantes.atom
//
// Paging is RFC 5005: each page links the next via <link rel="next"> with a
// timestamped file name (there is NO ?page=N). Pages are ~2-5 MB with up to
// a few hundred entries; each entry embeds the full CODICE 3.2 document, so
// no per-entry fetch is needed. Entries arrive newest→oldest by <updated>;
// the harvest stops when a page falls entirely outside the window
// (`months` back from now), at `maxPages` per feed, or at `maxDocs` total.
//
// Politeness: no rate limit is documented; we keep >= 500 ms between
// request starts (configurable, floor 100 ms) and back off on 429/5xx like
// the TED path. A failing page/feed never aborts the run: the error is
// logged and counted, and the harvest continues with the next feed.
// Kill-safe: entries already yielded are persisted idempotently downstream.

import { parseAtomFeed, type PlacspFeedEntry } from './placsp-parse.js';
import { addMonthsIso } from './normalize.js';
import { sleep } from './ted.js';

export const PLACSP_FEEDS = {
  licitaciones:
    'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom',
  menores:
    'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_1143/contratosMenoresPerfilesContratantes.atom',
} as const;

export type PlacspFeedName = keyof typeof PLACSP_FEEDS;

export interface PlacspHarvestOptions {
  /** Harvest window in months back from `now` (default 24). */
  months?: number;
  /** Max feed pages per feed (default 5). */
  maxPages?: number;
  /** Safety cap of entries yielded across all feeds (smoke runs/tests). */
  maxDocs?: number;
  /** Minimum delay between request starts in ms (default 500, floor 100). */
  requestDelayMs?: number;
  /** Max retries per request on 429/5xx/network errors (default 5). */
  maxRetries?: number;
  /** Backoff base in ms (retry wait = base * 2^attempt + jitter; default 1000). */
  backoffBaseMs?: number;
  /** Feeds to harvest (default: all). */
  feeds?: PlacspFeedName[];
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
  /** Injectable logger; defaults to JSON-lines on stdout. */
  log?: (entry: Record<string, unknown>) => void;
  /** Override "now" (tests). */
  now?: Date;
}

export interface PlacspHarvestStats {
  entriesSeen: number;
  deletedSkipped: number;
  pages: number;
  feedErrors: number;
}

function defaultLog(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: 'info', ...entry, ts: new Date().toISOString() }));
}

class PlacspHttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`PLACSP feed HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

/** Fetch one feed page with exponential backoff on 429/5xx/network errors. */
export async function placspFetchPage(
  url: string,
  opts: PlacspHarvestOptions = {},
): Promise<string> {
  const fetchFn = opts.fetchFn ?? fetch;
  const maxRetries = opts.maxRetries ?? 5;
  const baseMs = opts.backoffBaseMs ?? 1000;
  const log = opts.log ?? defaultLog;
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetchFn(url, { headers: { accept: 'application/atom+xml, application/xml' } });
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      const waitMs = 2 ** attempt * baseMs + Math.floor(Math.random() * 250);
      log({ msg: 'placsp retry (network)', attempt: attempt + 1, waitMs, error: String(err) });
      await sleep(waitMs);
      attempt += 1;
      continue;
    }
    const text = await res.text();
    if (res.ok) {
      // Unknown sindicación paths answer 200 with a tiny HTML redirect page;
      // that is a hard error, not a feed.
      if (!text.trimStart().startsWith('<') || !text.includes('<feed')) {
        throw new PlacspHttpError(res.status, `non-ATOM response from ${url}`);
      }
      return text;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const waitMs = 2 ** attempt * baseMs + Math.floor(Math.random() * 250);
      log({ msg: 'placsp retry', status: res.status, attempt: attempt + 1, waitMs });
      await sleep(waitMs);
      attempt += 1;
      continue;
    }
    throw new PlacspHttpError(res.status, text);
  }
}

/** YYYY-MM-DD `months` back from `now` (entry <updated> window cutoff). */
export function windowCutoffIso(months: number, now: Date = new Date()): string {
  return addMonthsIso(now.toISOString().slice(0, 10), -months);
}

/**
 * Stream feed entries newest→oldest across the configured feeds.
 * Malformed pages abort only their feed (logged + counted), never the run.
 */
export async function* harvestPlacsp(
  opts: PlacspHarvestOptions = {},
): AsyncGenerator<PlacspFeedEntry, PlacspHarvestStats, unknown> {
  const log = opts.log ?? defaultLog;
  const maxPages = opts.maxPages ?? 5;
  const delayMs = Math.max(opts.requestDelayMs ?? 500, 100);
  const cutoff = windowCutoffIso(opts.months ?? 24, opts.now);
  const feeds = opts.feeds ?? (Object.keys(PLACSP_FEEDS) as PlacspFeedName[]);
  const stats: PlacspHarvestStats = { entriesSeen: 0, deletedSkipped: 0, pages: 0, feedErrors: 0 };
  log({ msg: 'placsp harvest start', feeds, maxPages, maxDocs: opts.maxDocs ?? null, cutoff });

  let lastRequestAt = 0;
  const throttle = async (): Promise<void> => {
    const wait = delayMs - (Date.now() - lastRequestAt);
    if (wait > 0 && lastRequestAt > 0) await sleep(wait);
    lastRequestAt = Date.now();
  };

  for (const feed of feeds) {
    let url: string | null = PLACSP_FEEDS[feed];
    let feedPages = 0;
    while (url && feedPages < maxPages) {
      if (opts.maxDocs !== undefined && stats.entriesSeen >= opts.maxDocs) break;
      await throttle();
      let page;
      try {
        page = parseAtomFeed(await placspFetchPage(url, opts), feed);
      } catch (err) {
        stats.feedErrors += 1;
        log({ level: 'error', msg: 'placsp feed page failed', feed, url, error: String(err) });
        break; // next feed
      }
      feedPages += 1;
      stats.pages += 1;
      stats.deletedSkipped += page.deletedCount;

      let pageInWindow = 0;
      let pageOutOfWindow = 0;
      for (const entry of page.entries) {
        if (opts.maxDocs !== undefined && stats.entriesSeen >= opts.maxDocs) break;
        const entryDate = entry.updated?.slice(0, 10) ?? null;
        if (entryDate && entryDate < cutoff) {
          pageOutOfWindow += 1;
          continue;
        }
        pageInWindow += 1;
        stats.entriesSeen += 1;
        yield entry;
      }
      log({
        msg: 'placsp page',
        feed,
        page: feedPages,
        entries: page.entries.length,
        inWindow: pageInWindow,
        outOfWindow: pageOutOfWindow,
        deleted: page.deletedCount,
      });
      // Entries are newest→oldest: once a whole page is stale, stop paging.
      if (page.entries.length > 0 && pageInWindow === 0) break;
      url = page.nextUrl;
    }
  }

  log({ msg: 'placsp harvest done', ...stats });
  return stats;
}

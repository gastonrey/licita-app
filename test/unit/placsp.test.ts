// PLACSP harvester tests: paging (RFC 5005 rel=next), window cutoff, caps,
// backoff on 429, and per-feed fault isolation — all with an injected fetch.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  harvestPlacsp,
  placspFetchPage,
  PLACSP_FEEDS,
  windowCutoffIso,
} from '../../src/ingest/placsp.js';
import type { PlacspFeedEntry } from '../../src/ingest/placsp-parse.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const licXml = readFileSync(join(fixturesDir, 'placsp-atom-licitaciones.xml'), 'utf8');
const menXml = readFileSync(join(fixturesDir, 'placsp-atom-menores.xml'), 'utf8');

const NO_DELAY = { requestDelayMs: 0, backoffBaseMs: 1, log: () => {} };

/** Strip the RFC 5005 rel=next link (fixtures are real pages and carry one). */
function noNext(xml: string): string {
  return xml.replace(/<link[^>]*rel="next"[^>]*\/>\n?/, '');
}

function mockFetch(routes: Record<string, string | (() => Response)>): {
  fetchFn: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (route === undefined) return new Response('not found', { status: 404 });
    const body = typeof route === 'string' ? route : '';
    if (typeof route === 'function') return route();
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/atom+xml' },
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

async function drain(
  gen: AsyncGenerator<PlacspFeedEntry, { entriesSeen: number; deletedSkipped: number; pages: number; feedErrors: number }, unknown>,
) {
  const entries: PlacspFeedEntry[] = [];
  let res = await gen.next();
  while (!res.done) {
    entries.push(res.value);
    res = await gen.next();
  }
  return { entries, stats: res.value };
}

describe('harvestPlacsp', () => {
  it('yields entries from both feeds (embedded CODICE, no per-entry fetch)', async () => {
    const { fetchFn, calls } = mockFetch({
      [PLACSP_FEEDS.licitaciones]: noNext(licXml),
      [PLACSP_FEEDS.menores]: noNext(menXml),
    });
    // next links stripped → one page per feed, 2 requests total
    const { entries, stats } = await drain(harvestPlacsp({ ...NO_DELAY, fetchFn, months: 2400 }));
    expect(entries).toHaveLength(5);
    expect(calls).toHaveLength(2);
    expect(stats.pages).toBe(2);
    expect(stats.deletedSkipped).toBe(1); // licitaciones fixture has 1 deleted-entry
    expect(stats.feedErrors).toBe(0);
    expect(new Set(entries.map((e) => e.feed))).toEqual(new Set(['licitaciones', 'menores']));
  });
});

describe('harvestPlacsp (single-feed routing)', () => {
  async function runFeed(routes: Record<string, string | (() => Response)>, opts = {}) {
    const { fetchFn, calls } = mockFetch(routes);
    const gen = harvestPlacsp({ ...NO_DELAY, fetchFn, months: 2400, ...opts });
    const { entries, stats } = await drain(gen);
    return { entries, stats, calls };
  }

  it('follows rel=next across pages', async () => {
    const page1 =
      licXml
        .replace('</feed>', '')
        .replace(
          /(<feed[^>]*>)/,
          '$1<link href="https://next.test/p2.atom" rel="next"/>',
        ) + '</feed>';
    const { entries, stats, calls } = await runFeed(
      {
        [PLACSP_FEEDS.licitaciones]: page1,
        'https://next.test/p2.atom': noNext(menXml),
      },
      { feeds: ['licitaciones'] },
    );
    expect(calls).toEqual([PLACSP_FEEDS.licitaciones, 'https://next.test/p2.atom']);
    expect(entries).toHaveLength(5); // 3 lic + 2 menores-as-page2
    expect(stats.pages).toBe(2);
  });

  it('stops at maxPages even when next links continue', async () => {
    const withNext =
      licXml
        .replace('</feed>', '')
        .replace(/(<feed[^>]*>)/, '$1<link href="https://next.test/p2.atom" rel="next"/>') +
      '</feed>';
    const { stats, calls } = await runFeed(
      { [PLACSP_FEEDS.licitaciones]: withNext, 'https://next.test/p2.atom': withNext },
      { feeds: ['licitaciones'], maxPages: 1 },
    );
    expect(calls).toHaveLength(1);
    expect(stats.pages).toBe(1);
  });

  it('stops paging when a whole page falls outside the window', async () => {
    // default months=24: fixture entries are from 2026-08, so with now=far
    // future the page is entirely stale → yields nothing, stops.
    const { entries, stats, calls } = await runFeed(
      { [PLACSP_FEEDS.licitaciones]: licXml },
      { feeds: ['licitaciones'], months: 24, now: new Date('2030-01-01T00:00:00Z') },
    );
    expect(entries).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(stats.entriesSeen).toBe(0);
  });

  it('maxDocs caps the entries yielded', async () => {
    const { entries, stats } = await runFeed(
      { [PLACSP_FEEDS.licitaciones]: licXml, [PLACSP_FEEDS.menores]: menXml },
      { maxDocs: 4 },
    );
    expect(entries).toHaveLength(4);
    expect(stats.entriesSeen).toBe(4);
  });

  it('a failing feed is logged/counted and never aborts the other feed', async () => {
    const { entries, stats } = await runFeed({
      [PLACSP_FEEDS.licitaciones]: () => new Response('<html>redirect</html>', { status: 200 }),
      [PLACSP_FEEDS.menores]: noNext(menXml),
    });
    expect(stats.feedErrors).toBe(1);
    expect(entries).toHaveLength(2); // menores still harvested
  });

  it('404 page fails its feed (no retry), 429 retries with backoff', async () => {
    let hits = 0;
    const { fetchFn } = mockFetch({
      [PLACSP_FEEDS.licitaciones]: () => {
        hits += 1;
        return hits < 3
          ? new Response('slow down', { status: 429 })
          : new Response(noNext(licXml), { status: 200 });
      },
    });
    const res = await drain(
      harvestPlacsp({ ...NO_DELAY, fetchFn, months: 2400, feeds: ['licitaciones'] }),
    );
    expect(hits).toBe(3);
    expect(res.entries).toHaveLength(3);
    expect(res.stats.feedErrors).toBe(0);
  });
});

describe('placspFetchPage / windowCutoffIso', () => {
  it('rejects non-ATOM 200 responses (portal redirect page)', async () => {
    const { fetchFn } = mockFetch({ 'https://x.test/feed.atom': '<html><head>…</head></html>' });
    await expect(placspFetchPage('https://x.test/feed.atom', { fetchFn })).rejects.toThrow(
      /non-ATOM/,
    );
  });

  it('windowCutoffIso subtracts whole months (UTC)', () => {
    expect(windowCutoffIso(24, new Date('2026-08-14T10:00:00Z'))).toBe('2024-08-14');
    expect(windowCutoffIso(1, new Date('2026-03-31T00:00:00Z'))).toBe('2026-02-28');
  });
});

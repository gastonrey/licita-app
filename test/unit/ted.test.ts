// TED harvester tests: query building, window math, ITERATION paging and
// 429/5xx backoff — all with an injected fetch (no network in unit tests).
import { describe, expect, it, vi } from 'vitest';
import {
  TED_FIELDS,
  buildQuery,
  harvestTedAwards,
  tedSearch,
  windowStartYyyymmdd,
} from '../../src/ingest/ted.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('buildQuery / windowStartYyyymmdd', () => {
  it('builds the SPEC §8 expert query', () => {
    expect(buildQuery('20240813')).toBe(
      'buyer-country=ESP AND notice-type=can-standard ' +
        'AND publication-date>=20240813 AND classification-cpv IN (72* 48*)',
    );
  });

  it('window = last N months', () => {
    const now = new Date(Date.UTC(2026, 7, 13));
    expect(windowStartYyyymmdd(24, now)).toBe('20240813');
    expect(windowStartYyyymmdd(1, now)).toBe('20260713');
  });

  it('requests stay within the 10k field-cell budget', () => {
    expect(TED_FIELDS.length * 250).toBeLessThanOrEqual(10000);
  });
});

describe('tedSearch backoff', () => {
  it('retries 429/5xx with exponential backoff up to maxRetries', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate' }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse({ notices: [], totalNoticeCount: 0 }));
    const res = await tedSearch(
      { query: 'x' },
      { months: 24, fetchFn: fetchFn as unknown as typeof fetch, backoffBaseMs: 1, log: () => {} },
    );
    expect(res.notices).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries on persistent 429', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'rate' }, 429));
    await expect(
      tedSearch(
        { query: 'x' },
        {
          months: 24,
          fetchFn: fetchFn as unknown as typeof fetch,
          backoffBaseMs: 1,
          maxRetries: 2,
          log: () => {},
        },
      ),
    ).rejects.toThrow('HTTP 429');
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry 4xx query errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ message: 'bad field' }, 400));
    await expect(
      tedSearch(
        { query: 'x' },
        { months: 24, fetchFn: fetchFn as unknown as typeof fetch, backoffBaseMs: 1, log: () => {} },
      ),
    ).rejects.toThrow('HTTP 400');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries 502 and 503 gateway errors specifically (C2.3)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'bad gateway' }, 502))
      .mockResolvedValueOnce(jsonResponse({ error: 'service unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse({ notices: [], totalNoticeCount: 0 }));
    const res = await tedSearch(
      { query: 'x' },
      { months: 24, fetchFn: fetchFn as unknown as typeof fetch, backoffBaseMs: 1, log: () => {} },
    );
    expect(res.notices).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('opens the shared circuit after 3 consecutive 503s and closes it on success (C2.3)', async () => {
    const { createBackoffCircuit } = await import('../../src/ingest/backoff.js');
    const circuit = createBackoffCircuit({ threshold: 3, openMs: 1, now: () => 0 });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'down' }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: 'down' }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: 'down' }, 503))
      .mockResolvedValueOnce(jsonResponse({ notices: [], totalNoticeCount: 0 }));
    const res = await tedSearch(
      { query: 'x' },
      {
        months: 24,
        fetchFn: fetchFn as unknown as typeof fetch,
        backoffBaseMs: 1,
        log: () => {},
        circuit,
      },
    );
    expect(res.notices).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    // The circuit opened on the third failure and the successful 4th call reset it.
    expect(circuit.failures()).toBe(0);
    expect(circuit.isOpen()).toBe(false);
  });

  it('while open, the retry wait comes from the circuit, not the short backoff (C2.3)', async () => {
    const { createBackoffCircuit } = await import('../../src/ingest/backoff.js');
    // openMs 5 (fast test); the pure-module suite pins the production 60s default.
    const circuit = createBackoffCircuit({ threshold: 3, openMs: 5, now: () => 0 });
    const logs: Array<{ waitMs: number }> = [];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'down' }, 503));
    await expect(
      tedSearch(
        { query: 'x' },
        {
          months: 24,
          fetchFn: fetchFn as unknown as typeof fetch,
          backoffBaseMs: 1,
          maxRetries: 4,
          log: (e) => logs.push(e as { waitMs: number }),
          circuit,
        },
      ),
    ).rejects.toThrow('HTTP 503');
    // Wait 1-3 used the exponential backoff (attempt 0→1ms, 1→2ms, 2→4ms base);
    // wait 4 is the circuit open wait (5ms), never the 8ms base + jitter.
    expect(logs).toHaveLength(4);
    expect(logs[0].waitMs).toBeLessThan(250);
    expect(logs[1].waitMs).toBeLessThan(5000);
    expect(logs[2].waitMs).toBeLessThan(5000);
    expect(logs[3].waitMs).toBe(5);
  });
});

describe('harvestTedAwards (ITERATION)', () => {
  it('follows iterationNextToken until exhausted and passes onlyLatestVersions', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      if (!body.iterationNextToken) {
        return jsonResponse({
          notices: [{ 'publication-number': ['1-2026'] }, { 'publication-number': ['2-2026'] }],
          totalNoticeCount: 3,
          iterationNextToken: 'tok1',
        });
      }
      if (body.iterationNextToken === 'tok1') {
        return jsonResponse({
          notices: [{ 'publication-number': ['3-2026'] }],
          totalNoticeCount: 3,
          iterationNextToken: 'tok2',
        });
      }
      return jsonResponse({ notices: [], totalNoticeCount: 3 }); // exhausted
    });
    const gen = harvestTedAwards({
      months: 24,
      fetchFn: fetchFn as unknown as typeof fetch,
      requestDelayMs: 0,
      maxNotices: 10,
      log: () => {},
      now: new Date(Date.UTC(2026, 7, 13)),
    });
    const refs: string[] = [];
    for await (const n of gen) refs.push((n['publication-number'] as string[])[0]);
    // third page (empty, no token) ends iteration
    expect(refs).toEqual(['1-2026', '2-2026', '3-2026']);
    expect(bodies[0].paginationMode).toBe('ITERATION');
    expect(bodies[0].onlyLatestVersions).toBe(true);
    expect(bodies[0].iterationNextToken).toBeUndefined();
    expect(bodies[1].iterationNextToken).toBe('tok1');
    expect(String(bodies[0].query)).toContain('publication-date>=20240813');
  });

  it('respects maxNotices cap', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        notices: [
          { 'publication-number': ['1-2026'] },
          { 'publication-number': ['2-2026'] },
        ],
        iterationNextToken: 'tok',
      }),
    );
    const gen = harvestTedAwards({
      months: 24,
      fetchFn: fetchFn as unknown as typeof fetch,
      requestDelayMs: 0,
      maxNotices: 1,
      log: () => {},
    });
    const refs: string[] = [];
    for await (const n of gen) refs.push((n['publication-number'] as string[])[0]);
    expect(refs).toEqual(['1-2026']);
  });
});

// Behavior test for the "Recent activity" pagination on /dashboard.
//
// Runs the dashboard's self-contained inline <script> inside jsdom with a
// stubbed fetch, then clicks the pager repeatedly and asserts that the page
// counter advances AND the row list changes on EVERY click (page 1 -> 2 -> 3),
// and that the disabled state of Prev/Next follows the current page.
//
// Regression: clicking the pager used to update the rows once but never
// re-rendered the pager itself, so the counter stayed on "Page 1 of N" and the
// next click re-applied the same page (pagination then appeared stuck).

import { describe, expect, it, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import Fastify from 'fastify';
import { registerDashboard } from '../../src/web/dashboard.js';
import { makeTestConfig } from './testconfig.js';

// PAGE_SIZE in the dashboard script is 10 rows per page.
const RECENT_COUNT = 25; // => 3 pages exactly (10 + 10 + 5).

function recentRow(i: number) {
  return {
    ts: '2026-09-07T10:00:00.000Z',
    client_key: 'client_' + String(i).padStart(2, '0'),
    endpoint: 'GET /v1/search?q=' + i,
    status: 200,
    paid: false,
    source: 'rest',
    user_agent: 'pager-test',
    latency_ms: 12,
  };
}

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body });
}

function statsEnvelope() {
  return {
    data: {
      payments: { revenue_usd: 0 },
      unique_clients: RECENT_COUNT,
      total_requests: RECENT_COUNT,
      payment_required_responses: 0,
      failed_requests_rate: { rate: 0, total: RECENT_COUNT },
      payment_health: { settled: 0, verify_failed: 0, payment_required: 0, facilitator_unavailable: 0, recent_failures: [] },
      growth: {
        weekly_active_paying_agents: 0,
        funnel: {},
        source_labels: ['discovered'],
        free_demo_calls: 0,
        research_calls: 0,
        research_paid_calls: 0,
        research_conversion: 0,
        paid_agents: 0,
        repeat_paid_agents: 0,
        calls_per_agent: 0,
        revenue_per_agent: 0,
        time_to_second_purchase_days: 0,
      },
      mcp_discovery: { handshakes: 0, tools_list: 0, clients: 0, discovered_clients: 0 },
      requests_by_endpoint: [{ endpoint: 'GET /v1/search', requests: RECENT_COUNT, paid_requests: 0 }],
      daily_traffic: [],
      endpoint_economics: [],
      zero_result_by_endpoint: [],
    },
  };
}

function scriptSource(html: string): string {
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  if (!match) throw new Error('dashboard inline script not found in served HTML');
  return match[1];
}

async function waitFor(fn: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (fn()) return;
    } catch {
      // retry — the element/handler from the previous render is gone
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor timed out');
}

const openWindows: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const w of openWindows) w.close();
  openWindows.length = 0;
});

async function bootDashboard() {
  const app = Fastify({ logger: false });
  registerDashboard(app, makeTestConfig());
  const html = (await app.inject({ method: 'GET', url: '/dashboard' })).body;
  await app.close();

  const dom = new JSDOM(html, {
    url: 'http://localhost:3000/dashboard',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  openWindows.push(dom.window);

  dom.window.fetch = async (url: string | URL) => {
    const u = String(url);
    if (u.startsWith('/v1/stats/recent')) {
      return jsonResponse({ data: Array.from({ length: RECENT_COUNT }, (_, i) => recentRow(i)) });
    }
    if (u.startsWith('/v1/stats/demo')) {
      return jsonResponse({ data: { requests: [], by_status: {} } });
    }
    if (u.startsWith('/v1/stats')) {
      return jsonResponse(statsEnvelope());
    }
    throw new Error('unexpected fetch: ' + u);
  };

  dom.window.sessionStorage.setItem('licita_operator_key', 'pager-test-key');
  dom.window.eval(scriptSource(html));

  // Boot fires load() asynchronously; wait until the pager rendered once.
  await waitFor(() => dom.window.document.querySelector('#pager-recent')?.textContent.includes('Page 1 of 3'));
  return dom.window;
}

describe('dashboard Recent activity pagination', () => {
  it('advances the page counter and changes the list on every Next click', async () => {
    const window = await bootDashboard();
    const document = window.document;
    const pager = () => document.querySelector<HTMLElement>('#pager-recent');
    const recentText = () => document.querySelector('#recent')?.textContent ?? '';
    const next = () => pager()?.querySelector<HTMLButtonElement>('button[aria-label="Next page"]');
    const prev = () => pager()?.querySelector<HTMLButtonElement>('button[aria-label="Previous page"]');

    // Page 1 of 3: first slice visible, Prev disabled.
    expect(pager()?.textContent).toContain('Page 1 of 3');
    expect(recentText()).toContain('client_00');
    expect(recentText()).not.toContain('client_10');
    expect(prev()?.disabled).toBe(true);
    expect(next()?.disabled).toBe(false);

    // First click -> page 2.
    next()?.click();
    await waitFor(() => pager()?.textContent.includes('Page 2 of 3'));
    expect(recentText()).toContain('client_10');
    expect(recentText()).not.toContain('client_00');
    expect(prev()?.disabled).toBe(false);

    // Second click -> page 3 (must NOT stay stuck on page 2).
    next()?.click();
    await waitFor(() => pager()?.textContent.includes('Page 3 of 3'));
    expect(recentText()).toContain('client_20');
    expect(recentText()).not.toContain('client_10');
    expect(next()?.disabled).toBe(true);

    // Going back works page by page too.
    prev()?.click();
    await waitFor(() => pager()?.textContent.includes('Page 2 of 3'));
    expect(recentText()).toContain('client_10');
    expect(next()?.disabled).toBe(false);
  });
});
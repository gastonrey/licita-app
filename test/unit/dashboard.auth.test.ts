// Operator console auth must not bounce.
//
// /stats and /operator are HTML entry points. They redirect once, on the same
// origin, to the dashboard document. The operator key lives in sessionStorage
// and must not be copied into the Location header (that would leak it and
// would also drop it on the next hop). The dashboard document never navigates
// again: no key shows the form once, a rejected key is deleted and the error
// stays on that form, and ?view= / detail= deep links keep a valid key signed in.

import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import Fastify from 'fastify';
import { registerDashboard } from '../../src/web/dashboard.js';
import { makeTestConfig } from './testconfig.js';

const KEY = 'licita_operator_key';

function scriptSource(html: string): string {
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  if (!match) throw new Error('dashboard inline script not found');
  return match[1];
}

async function page(url = '/dashboard'): Promise<string> {
  const app = Fastify({ logger: false });
  registerDashboard(app, makeTestConfig());
  const res = await app.inject({ method: 'GET', url });
  await app.close();
  return res.body;
}

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function statsBody() {
  return {
    data: {
      payments: { revenue_usd: 0 },
      unique_clients: 0,
      total_requests: 0,
      payment_required_responses: 0,
      failed_requests_rate: { rate: 0, total: 0 },
      payment_health: { settled: { count: 0, amount_usd: 0 }, verify_failed: 0, payment_required: 0, facilitator_unavailable: 0, recent_failures: [] },
      growth: {},
      mcp_discovery: {},
      requests_by_endpoint: [],
      daily_traffic: [],
      endpoint_economics: [],
      zero_result_by_endpoint: [],
    },
  };
}

const openWindows: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const w of openWindows) w.close();
  openWindows.length = 0;
});

interface Boot {
  window: JSDOM['window'];
  intervalFns: Array<() => void>;
  pushes: string[];
  fetches: string[];
}

async function boot(url: string, options: { key?: string | null; status?: number } = {}): Promise<Boot> {
  const html = await page('/dashboard');
  const vc = new VirtualConsole();
  const errors: string[] = [];
  vc.on('jsdomError', (error: Error) => errors.push(String(error)));
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  openWindows.push(dom.window);
  const intervalFns: Array<() => void> = [];
  const pushes: string[] = [];
  const fetches: string[] = [];
  const status = options.status ?? 200;
  dom.window.setInterval = ((fn: TimerHandler) => {
    intervalFns.push(fn as () => void);
    return 1;
  }) as typeof setInterval;
  dom.window.clearInterval = (() => undefined) as typeof clearInterval;
  const pushState = dom.window.history.pushState.bind(dom.window.history);
  dom.window.history.pushState = ((...args: Parameters<History['pushState']>) => {
    pushes.push(String(args[2] ?? ''));
    return pushState(...args);
  }) as History['pushState'];
  dom.window.fetch = (async (input: RequestInfo | URL) => {
    fetches.push(String(input));
    if (status !== 200) return jsonResponse(status, { error: { code: 'invalid_query' } });
    const u = String(input);
    if (u.startsWith('/v1/stats/recent')) return jsonResponse(200, { data: [] });
    if (u.startsWith('/v1/stats/demo')) return jsonResponse(200, { data: { requests: [], by_status: {} } });
    if (u.startsWith('/v1/stats/payments')) return jsonResponse(200, { data: { attempts: [] } });
    if (u.startsWith('/v1/stats/readiness')) return jsonResponse(200, { data: {} });
    if (u.startsWith('/v1/stats')) return jsonResponse(200, statsBody());
    throw new Error('unexpected fetch ' + u);
  }) as typeof fetch;
  if (options.key) dom.window.sessionStorage.setItem(KEY, options.key);
  dom.window.addEventListener('error', (event) => errors.push(event.message));
  dom.window.eval(scriptSource(html));
  if (errors.length) throw new Error(errors.join('\n'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { window: dom.window, intervalFns, pushes, fetches };
}

describe('operator console entry routes', () => {
  async function app() {
    const server = Fastify({ logger: false });
    registerDashboard(server, makeTestConfig());
    return server;
  }

  it('sends /stats to the dashboard stats view once, on the same origin', async () => {
    const server = await app();
    const cases: Array<[string, string]> = [
      ['/stats', '/dashboard?view=overview'],
      ['/stats/', '/dashboard?view=overview'],
      ['/stats?from=2026-08-01&to=2026-08-17', '/dashboard?view=overview&from=2026-08-01&to=2026-08-17'],
      ['/stats?view=payments', '/dashboard?view=payments'],
      ['/stats?tab=leads', '/dashboard?tab=leads'],
    ];
    for (const [from, to] of cases) {
      const res = await server.inject({ method: 'GET', url: from });
      expect(res.statusCode, from).toBe(302);
      expect(res.headers.location, from).toBe(to);
      expect(String(res.headers.location), from).not.toMatch(/^https?:/);
      const landed = await server.inject({ method: 'GET', url: String(res.headers.location) });
      expect(landed.statusCode, from).toBe(200);
      expect(landed.headers.location, from).toBeUndefined();
      expect(landed.headers['content-type']).toMatch(/text\/html/);
    }
    await server.close();
  });

  it('drops the operator key and any off-site target from the /stats redirect', async () => {
    const server = await app();
    const res = await server.inject({
      method: 'GET',
      url: '/stats?key=operator-secret&next=https://evil.example/phish&view=leads',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/dashboard?view=leads');
    expect(res.headers.location).not.toContain('operator-secret');
    expect(res.headers.location).not.toContain('evil.example');
    await server.close();
  });

  it('sends /operator to /dashboard without a second hop', async () => {
    const server = await app();
    const root = await server.inject({ method: 'GET', url: '/operator' });
    expect(root.statusCode).toBe(302);
    expect(root.headers.location).toBe('/dashboard');
    const slash = await server.inject({ method: 'GET', url: '/operator/' });
    expect(slash.statusCode).toBe(302);
    expect(slash.headers.location).toBe('/dashboard');
    const view = await server.inject({ method: 'GET', url: '/operator?view=leads&from=2026-01-01' });
    expect(view.statusCode).toBe(302);
    expect(view.headers.location).toBe('/dashboard?view=leads&from=2026-01-01');
    const landed = await server.inject({ method: 'GET', url: String(view.headers.location) });
    expect(landed.statusCode).toBe(200);
    expect(landed.headers.location).toBeUndefined();
    await server.close();
  });

  it('serves /dashboard?view= as the console itself, not a redirect', async () => {
    const server = await app();
    const res = await server.inject({ method: 'GET', url: '/dashboard?view=payments' });
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).not.toMatch(/location\.(href|assign|replace)/);
    expect(res.body).toContain('<form id="login-form" method="post">');
    await server.close();
  });
});

describe('operator console session', () => {
  it('shows the form once when sessionStorage has no key and does not navigate', async () => {
    const url = 'http://localhost:3000/dashboard?view=payments';
    const bootPromise = boot(url);
    const { window: w, intervalFns } = await bootPromise;
    expect(intervalFns).toHaveLength(0);
    expect(w.location.href).toBe(url);
    expect(w.document.getElementById('login')?.hidden).toBe(false);
    expect(w.document.getElementById('dash')?.hidden).toBe(true);
    expect(w.document.getElementById('login-msg')?.textContent).toBe('');
    expect(w.sessionStorage.getItem(KEY)).toBeNull();
    for (const fn of intervalFns) fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(w.location.href).toBe(url);
    expect(w.document.getElementById('login')?.hidden).toBe(false);
    expect(w.document.getElementById('login-msg')?.textContent).toBe('');
  });

  it('clears an invalid stored key and keeps the error on the form', async () => {
    const url = 'http://localhost:3000/dashboard?view=leads';
    const { window: w, intervalFns, fetches } = await boot(url, { key: 'wrong-key', status: 401 });
    expect(fetches.some((u) => u.startsWith('/v1/stats'))).toBe(true);
    expect(w.sessionStorage.getItem(KEY)).toBeNull();
    expect(w.document.getElementById('login')?.hidden).toBe(false);
    expect(w.document.getElementById('dash')?.hidden).toBe(true);
    expect(w.document.getElementById('login-msg')?.textContent).toBe('Invalid or missing operator key');
    expect(w.location.href).toBe(url);
    expect(intervalFns).toHaveLength(0);
    for (const fn of [...intervalFns]) fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(w.document.getElementById('login-msg')?.textContent).toBe('Invalid or missing operator key');
    expect(w.location.href).toBe(url);
  });

  it('opens the requested view when the stored key is accepted', async () => {
    const url = 'http://localhost:3000/dashboard?view=payments';
    const { window: w, pushes, intervalFns } = await boot(url, { key: 'good-key' });
    expect(w.document.getElementById('login')?.hidden).toBe(true);
    expect(w.document.getElementById('dash')?.hidden).toBe(false);
    expect(w.sessionStorage.getItem(KEY)).toBe('good-key');
    expect(w.location.href).toBe(url);
    expect(w.document.getElementById('panel-payments')?.hidden).toBe(false);
    expect(w.document.querySelector('[data-tab-button="payments"]')?.getAttribute('aria-selected')).toBe('true');
    expect(pushes).toEqual([]);
    expect(intervalFns).toHaveLength(1);
    w.document.querySelector<HTMLButtonElement>('[data-tab-button="growth"]')?.click();
    expect(pushes).toEqual(['/dashboard?view=growth']);
    expect(w.location.pathname + w.location.search).toBe('/dashboard?view=growth');
    pushes.length = 0;
    w.history.pushState({}, '', '/dashboard?view=payments');
    pushes.length = 0;
    w.document.getElementById('refresh')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pushes).toEqual([]);
    expect(w.location.href).toBe(url);
    w.dispatchEvent(new w.PopStateEvent('popstate'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pushes).toEqual([]);
    expect(w.document.getElementById('login')?.hidden).toBe(true);
  });

  it('does not dump a valid key back to the form for a detail deep link', async () => {
    const url = 'http://localhost:3000/dashboard?view=overview&detail=endpoints';
    const { window: w } = await boot(url, { key: 'good-key' });
    expect(w.document.getElementById('login')?.hidden).toBe(true);
    expect(w.document.getElementById('dash')?.hidden).toBe(false);
    expect(w.sessionStorage.getItem(KEY)).toBe('good-key');
    expect(w.location.href).toBe(url);
  });

  it('keeps a stored key on the console when stats fail for a reason other than 401', async () => {
    const url = 'http://localhost:3000/dashboard?view=growth';
    const { window: w } = await boot(url, { key: 'good-key', status: 500 });
    expect(w.sessionStorage.getItem(KEY)).toBe('good-key');
    expect(w.document.getElementById('login')?.hidden).toBe(true);
    expect(w.document.getElementById('dash')?.hidden).toBe(false);
    expect(w.document.getElementById('last-updated')?.textContent).toContain('500');
    expect(w.location.href).toBe(url);
  });
});

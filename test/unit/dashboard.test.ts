// GET /dashboard: self-contained operator page — 200 text/html with the
// operator title and inline style/script blocks. No DB required.

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerDashboard } from '../../src/web/dashboard.js';
import { makeTestConfig } from './testconfig.js';

function buildApp() {
  const app = Fastify({ logger: false });
  registerDashboard(app, makeTestConfig());
  return app;
}

describe('GET /dashboard', () => {
  it('serves an operator dashboard as text/html', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    await app.close();
  });

  it('contains the operator title and the self-contained auth + data blocks', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    const html = res.body;
    expect(html).toContain('<title>Dashboard — Licita (operator)</title>');
    expect(html).toContain('licita_operator_key');
    expect(html).toContain('x-operator-key');
    expect(html).toContain('/v1/stats/recent?limit=200');
    expect(html).toContain('Auto-refresh 15s');
    expect(html).toContain('MCP discovery');
    expect(html).toContain('mcp_discovery');
    expect(html).toContain('Growth cohorts');
    expect(html).toContain('Weekly active paying agents');
    expect(html).toContain('growth-funnel');
    expect(html).toContain('growth-rows');
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
    await app.close();
  });

  it('is not gated by payment or operator auth on the page itself', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(200); // no X-PAYMENT, no x-operator-key needed
    await app.close();
  });

  it('contains interactive chart elements (clickable dots, tooltip, bar chart)', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    const html = res.body;
    expect(html).toContain('chart-tooltip');
    expect(html).toContain('endpoint-bars');
    expect(html).toContain('chart-filter-banner');
    expect(html).toContain('chart-hint');
    expect(html).toContain('endpoint-bars-rest');
    await app.close();
  });

  it('exposes URL state for day filter (restores selected day from ?day=)', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    const html = res.body;
    // The state init reads ?day=... and the chart's hint mentions recent activity filtering
    expect(html).toContain('filter recent activity to that day');
    // The day URL param round-trips via syncUrl
    expect(html).toMatch(/params\.set\(.day.|params\.delete\(.day.\)/);
    await app.close();
  });

  it('renders the Payment health card on the Overview tab with all four tiles', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    const html = res.body;
    // Section + tile container + four labels.
    expect(html).toContain('<h2>Payment health</h2>');
    expect(html).toContain('id="payment-health-tiles"');
    expect(html).toContain('id="payment-health-failures"');
    expect(html).toContain('Settled');
    expect(html).toContain('Verify failed');
    expect(html).toContain('Payment required (no proof)');
    expect(html).toContain('Facilitator unavailable');
    expect(html).toContain('Recent payment failures');
    // CSS hooks for tile states and the responsive collapse.
    expect(html).toContain('.payment-health-grid');
    expect(html).toContain('.payment-tile');
    expect(html).toContain('.payment-tile.is-ok');
    expect(html).toContain('.payment-tile.is-warn');
    expect(html).toContain('.payment-tile.is-err');
    await app.close();
  });

  it('renderPaymentHealth tiles have id hooks so a future build that omits the field renders empty', async () => {
    // The Payment health container is wired even when the stats payload
    // predates the field — older envelopes must render zero state, not 500.
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    const html = res.body;
    expect(html).toContain('id="payment-health-summary"');
    expect(html).toContain('aria-live="polite"');
    // All four tile labels exist regardless of payload.
    expect(html).toMatch(/Settled.*Verify failed.*Payment required \(no proof\).*Facilitator unavailable/s);
    await app.close();
  });
});

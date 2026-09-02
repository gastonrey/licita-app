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
});

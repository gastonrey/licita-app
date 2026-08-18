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
    expect(html).toContain('<title>Dashboard — licita-agent (operator)</title>');
    expect(html).toContain('licita_operator_key');
    expect(html).toContain('x-operator-key');
    expect(html).toContain('/v1/stats/recent?limit=50');
    expect(html).toContain('Auto-refresh 15s');
    expect(html).toContain('MCP discovery');
    expect(html).toContain('mcp_discovery');
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
});
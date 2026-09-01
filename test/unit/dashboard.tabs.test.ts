import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerDashboard } from '../../src/web/dashboard.js';
import { makeTestConfig } from './testconfig.js';

describe('dashboard tabs', () => {
  it('renders navigable tab content and date-filter data URLs', async () => {
    const app = Fastify({ logger: false });
    registerDashboard(app, makeTestConfig());
    const html = (await app.inject({ method: 'GET', url: '/dashboard' })).body;
    for (const label of ['Overview', 'Growth', 'Leads', 'Endpoint economics', 'Data gaps']) expect(html).toContain(label);
    expect(html).toContain('data-tab="overview"');
    expect(html).toContain('data-tab="economics"');
    expect(html).toContain("'/v1/stats' + range");
    expect(html).toContain("fetch('/v1/stats/demo");
    expect(html).toContain('encodeURIComponent(from)');
    expect(html).toContain('section[hidden]');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('URLSearchParams');
    expect(html).toContain('history.pushState');
    expect(html).toContain('popstate');
    expect(html).toContain('Intl.NumberFormat');
    expect(html).toContain('aria-controls="panel-overview"');
    expect(html).toContain("params.set('from', $('from').value)");
    expect(html).toContain('filter-chip');
    expect(html).toContain('Retry');
    expect(html).toContain('stale');
    expect(html).toContain('table-wrap');
    expect(html).toContain('Not available');
    expect(html).toContain('Loading…');
    await app.close();
  });

  it('documents safe state and mobile table behavior', async () => {
    const app = Fastify({ logger: false });
    registerDashboard(app, makeTestConfig());
    const html = (await app.inject({ method: 'GET', url: '/dashboard' })).body;
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Open details');
    expect(html).toContain('Clear filters');
    expect(html).toContain('addEventListener(\'click\'' );
    expect(html).toContain('id="panel-overview"');
    expect(html).toContain('data-view="data-quality"');
    await app.close();
  });

  it('serves the lead review page without gating the HTML response', async () => {
    const app = Fastify({ logger: false });
    registerDashboard(app, makeTestConfig());
    const res = await app.inject({ method: 'GET', url: '/dashboard/demo' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('Demo pipeline');
    for (const field of ['Source URL', 'Created', 'Converted', 'Status: new']) expect(res.body).toContain(field);
    expect(res.body).toContain("fetch('/v1/stats/demo?limit=200'");
    expect(res.body).toContain('id="leads"');
    await app.close();
  });

  it('exposes each dashboard surface with its user-visible data region', async () => {
    const app = Fastify({ logger: false });
    registerDashboard(app, makeTestConfig());
    const html = (await app.inject({ method: 'GET', url: '/dashboard' })).body;
    for (const [tab, marker] of [
      ['overview', 'Weekly active paying agents'],
       ['growth', 'Cohort counts'],
      ['leads', 'Demo pipeline'],
       ['economics', 'Per call'],
      ['gaps', 'Data gaps'],
    ]) {
      expect(html).toContain(`data-tab="${tab}"`);
      expect(html).toContain(marker);
    }
    await app.close();
  });
});

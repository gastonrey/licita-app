// GET /dashboard payments tab (payments-dashboard-visibility): the Payments
// panel must lead with answer-first visibility — funnel + KPIs + honest empty
// states — not a bare raw table. These are static-structure needle tests (the
// page is self-contained; behavior is exercised in browser verification).

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerDashboard } from '../../src/web/dashboard.js';
import { makeTestConfig } from './testconfig.js';

function html(): string {
  const app = Fastify({ logger: false });
  registerDashboard(app, makeTestConfig());
  return app.inject({ method: 'GET', url: '/dashboard' }).then((res) => res.body);
}

describe('GET /dashboard payments tab visibility', () => {
  it('renders the payments funnel with checkout → webhook → payer → settled stages', async () => {
    const body = await html();
    expect(body).toContain('id="payments-funnel"');
    expect(body).toContain('Checkout initiated');
    expect(body).toContain('Webhook confirmed');
    expect(body).toContain('Paying agents');
    expect(body).toContain('Settled');
  });

  it('renders payment KPIs: settled revenue, settled payments, distinct payers, failed attempts', async () => {
    const body = await html();
    expect(body).toContain('Settled revenue');
    expect(body).toContain('Settled payments');
    expect(body).toContain('Distinct payers');
    expect(body).toContain('Failed attempts');
  });

  it('has nodes wired for funnel and KPI values (payments-funnel + payments-kpis)', async () => {
    const body = await html();
    expect(body).toContain('id="payments-funnel"');
    expect(body).toContain('id="payments-kpis"');
  });

  it('renders friendly failure-reason badges (no-proof / proof-rejected / facilitator-down)', async () => {
    const body = await html();
    expect(body).toContain('No proof sent');
    expect(body).toContain('Proof rejected');
    expect(body).toContain('Facilitator down');
  });

  it('renders honest empty states: zero settled payments and zero attempts are explicit', async () => {
    const body = await html();
    expect(body).toContain('No settled payments yet');
    expect(body).toContain('Nobody has attempted payment yet');
  });

  it('keeps the existing attempts table and Payment health overview card intact', async () => {
    const body = await html();
    expect(body).toContain('id="payment-attempts"');
    expect(body).toContain('Payment health');
  });
});

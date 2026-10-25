// Customer weekly radar: real CPV 48/72 rows, one send per UTC week,
// stored unsubscribe, and no Resend calls unless the test asks for the
// default sender (and then fetch is mocked).

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import {
  customerRadarSubject,
  renderCustomerRadarEmail,
  sendCustomerRadarDigest,
  signupFilters,
  unsubscribeToken,
  verifyUnsubscribeToken,
  weekStartIso,
  type RadarMailMessage,
} from '../../src/obs/customer-radar.js';
import type { NotifyLogger } from '../../src/obs/notify.js';
import { resetPayments } from '../../src/pay/middleware.js';
import { makeTestConfig } from './testconfig.js';
import { makeTestDb } from './testdb.js';

const MIG007 = readFileSync(new URL('../../migrations/007_demo_requests.sql', import.meta.url), 'utf8');
const MIG008 = readFileSync(new URL('../../migrations/008_demo_funnel.sql', import.meta.url), 'utf8');
const MIG012 = readFileSync(new URL('../../migrations/012_radar_digest.sql', import.meta.url), 'utf8');

const SECRET = 'test-operator-key';

function log(): NotifyLogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function isoInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function dbWithLeads(now = new Date('2026-10-25T12:00:00Z')) {
  const db = await makeTestDb();
  await db.query(MIG007);
  await db.query(MIG008);
  await db.query(MIG012);
  await db.query(`INSERT INTO sources (id, code, name) VALUES (1, 'ted', 'TED'), (2, 'placsp', 'PLACSP')`);
  await db.query(
    `INSERT INTO buyers (id, source_id, source_ref, name, name_norm, nuts) VALUES
      (1, 1, 'b1', 'Ayuntamiento de Test', 'ayuntamiento de test', 'ES511'),
      (2, 2, 'b2', 'Ministerio de Software', 'ministerio de software', 'ES300')`,
  );
  await db.query(
    `INSERT INTO companies (id, source_id, source_ref, name, name_norm) VALUES (1, 1, 'c1', 'Soft SL', 'soft sl')`,
  );
  await db.query(
    `INSERT INTO tenders (id, source_id, source_ref, title, cpv_main, publication_date, buyer_id) VALUES
      (1, 1, '111-2026', 'Servicios de ciberseguridad', '72000000', $1, 1),
      (2, 2, '333-2026', 'Licencias de software', '48000000', $1, 2)`,
    [isoInDays(-10)],
  );
  await db.query(
    `INSERT INTO awards (id, tender_id, source_ref, award_date) VALUES (1, 1, 'a1', $1), (2, 2, 'a2', $1)`,
    [isoInDays(-400)],
  );
  await db.query(
    `INSERT INTO contracts (id, award_id, buyer_id, company_id, cpv, title, value, currency, end_date) VALUES
      (1, 1, 1, 1, '72000000', 'Mantenimiento ciber', 120000, 'EUR', $1),
      (2, 2, 2, NULL, '48000000', 'Licencias de software', NULL, NULL, $2)`,
    [isoInDays(80), isoInDays(90)],
  );
  await db.query(
    `INSERT INTO forecast_signals (id, buyer_id, cpv, incumbent_company_id, contract_id, signal_type, window_start, window_end, confidence, basis) VALUES
      (1, 1, '72000000', 1, 1, 'duration_expiry', $1, $2, 'medium', '{"rule":"explicit_end_date"}'::jsonb),
      (2, 2, '48000000', NULL, 2, 'duration_expiry', $3, $4, 'low', '{"rule":"explicit_end_date"}'::jsonb),
      (3, 2, '45000000', NULL, NULL, 'duration_expiry', $1, $2, 'low', '{"rule":"explicit_end_date"}'::jsonb)`,
    [isoInDays(30), isoInDays(120), isoInDays(40), isoInDays(130)],
  );
  await db.query(
    `INSERT INTO demo_requests (email, channel, source_url) VALUES
      ('all@b.com', 'homepage', '/v1/demo/request?source=homepage'),
      ('only72@b.com', 'homepage', '/v1/demo/request?source=homepage&cpv=72&region=ES511'),
      ('none@b.com', 'radar', '/v1/demo/request?source=radar&region=ZZ'),
      ('out@b.com', 'homepage', NULL),
      ('done@b.com', 'homepage', NULL)`,
  );
  await db.query(`UPDATE demo_requests SET unsubscribed_at = now() WHERE email = 'out@b.com'`);
  const week = weekStartIso(now);
  await db.query(
    `INSERT INTO radar_digest_sends (email, week_start) VALUES ('done@b.com', CAST($1 AS date))`,
    [week],
  );
  return db;
}

describe('customer radar helpers', () => {
  it('pins the UTC week to Monday', () => {
    expect(weekStartIso(new Date('2026-10-25T12:00:00Z'))).toBe('2026-10-19');
    expect(weekStartIso(new Date('2026-10-19T00:00:00Z'))).toBe('2026-10-19');
  });

  it('signs the unsubscribe token and rejects a tampered one', () => {
    const token = unsubscribeToken(' A@B.com ', SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe('a@b.com');
    expect(verifyUnsubscribeToken(token, 'other')).toBeNull();
    expect(verifyUnsubscribeToken(`${token}x`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('nope', SECRET)).toBeNull();
  });

  it('reads only a valid CPV and region from the signup URL', () => {
    expect(signupFilters('/v1/demo/request?cpv=72&region=ES511')).toEqual({ cpv: '72', region: 'ES511' });
    expect(signupFilters('/v1/demo/request?cpv=45&region=!!!')).toEqual({});
    expect(signupFilters(null)).toEqual({});
  });

  it('renders a Spanish mail with buyer, amount, source, date, radar and unsubscribe', () => {
    const html = renderCustomerRadarEmail({
      rows: [{
        title: 'Mantenimiento ciber',
        buyer: 'Ayuntamiento de Test',
        value: 120000,
        currency: 'EUR',
        source: 'ted',
        windowStart: '2026-11-24',
      }],
      total: 1,
      filter: { cpv: '72' },
      radarUrl: 'https://eutendersai.com/radar',
      unsubscribeUrl: 'https://eutendersai.com/radar/baja?token=abc',
    });
    expect(customerRadarSubject(1)).toBe('Relicita: 1 renovación de software e IT');
    expect(html).toContain('Ayuntamiento de Test');
    expect(html).toContain('120.000');
    expect(html).toContain('€');
    expect(html).toContain('Fuente: TED');
    expect(html).toContain('Fecha estimada de renovación');
    expect(html).toContain('https://eutendersai.com/radar');
    expect(html).toContain('https://eutendersai.com/radar/baja?token=abc');
    expect(html).toContain('date de baja');
    expect(html).not.toContain('no está activado');
  });
});

describe('sendCustomerRadarDigest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mails active signups once per week and never calls fetch when deliver is injected', async () => {
    const db = await dbWithLeads();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const sent: RadarMailMessage[] = [];
    const now = new Date('2026-10-25T12:00:00Z');
    const first = await sendCustomerRadarDigest({
      db,
      log: log(),
      resendApiKey: 're_test',
      from: 'Relicita <radar@example.com>',
      baseUrl: 'https://eutendersai.com',
      operatorKey: SECRET,
      now,
      deliver: async (message) => {
        sent.push(message);
        return true;
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(first.blocked).toBeNull();
    expect(first.sent).toBe(3);
    expect(first.already_sent).toBe(1);
    expect(first.failed).toBe(0);
    const tos = sent.map((message) => message.to).sort();
    expect(tos).toEqual(['all@b.com', 'none@b.com', 'only72@b.com']);
    expect(sent.every((message) => message.html.includes('/radar/baja?token='))).toBe(true);
    expect(sent.every((message) => message.html.includes('https://eutendersai.com/radar'))).toBe(true);

    const all = sent.find((message) => message.to === 'all@b.com');
    expect(all?.html).toContain('Ayuntamiento de Test');
    expect(all?.html).toContain('Licencias de software');
    expect(all?.html).toContain('Fuente: TED');
    expect(all?.html).toContain('Fuente: PLACSP');
    expect(all?.html).toContain('No consta');
    expect(all?.html.match(/<li /g)?.length).toBe(2);

    const only = sent.find((message) => message.to === 'only72@b.com');
    expect(only?.html).toContain('Mantenimiento ciber');
    expect(only?.html).not.toContain('Licencias de software');
    expect(only?.subject).toBe('Relicita: 1 renovación de software e IT');

    const empty = sent.find((message) => message.to === 'none@b.com');
    expect(empty?.html).toContain('no hay renovaciones');
    expect(empty?.subject).toBe('Relicita: sin renovaciones de software e IT esta semana');

    const second = await sendCustomerRadarDigest({
      db,
      log: log(),
      resendApiKey: 're_test',
      from: 'Relicita <radar@example.com>',
      baseUrl: 'https://eutendersai.com',
      operatorKey: SECRET,
      now,
      deliver: async () => {
        throw new Error('should not send');
      },
    });
    expect(second.sent).toBe(0);
    expect(second.already_sent).toBe(4);
    await db.end();
  });

  it('releases the claim when delivery fails so a later run can send', async () => {
    const db = await dbWithLeads();
    const now = new Date('2026-10-25T12:00:00Z');
    const env = {
      db,
      log: log(),
      resendApiKey: 're_test',
      from: 'Relicita <radar@example.com>',
      baseUrl: 'https://eutendersai.com',
      operatorKey: SECRET,
      now,
    };
    const failed = await sendCustomerRadarDigest({
      ...env,
      deliver: async (message) => message.to !== 'all@b.com',
    });
    expect(failed.failed).toBe(1);
    expect(failed.sent).toBe(2);
    const pending = await db.query(`SELECT email FROM radar_digest_sends WHERE email = 'all@b.com'`);
    expect(pending.rows).toEqual([]);

    const retried = await sendCustomerRadarDigest({
      ...env,
      deliver: async () => true,
    });
    expect(retried.sent).toBe(1);
    expect(retried.already_sent).toBe(3);
    await db.end();
  });

  it('does not call Resend or record a send when the API key is missing', async () => {
    const db = await dbWithLeads();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const result = await sendCustomerRadarDigest({
      db,
      log: log(),
      resendApiKey: '',
      from: 'Relicita <radar@example.com>',
      baseUrl: 'https://eutendersai.com',
      operatorKey: SECRET,
      now: new Date('2026-10-25T12:00:00Z'),
    });
    expect(result.blocked).toBe('missing_resend');
    expect(result.sent).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const extra = await db.query(`SELECT count(*)::int AS n FROM radar_digest_sends`);
    expect(extra.rows[0].n).toBe(1);
    await db.end();
  });

  it('posts to Resend only through the default sender, which tests mock', async () => {
    const db = await makeTestDb();
    await db.query(MIG007);
    await db.query(MIG008);
    await db.query(MIG012);
    await db.query(`INSERT INTO demo_requests (email, channel) VALUES ('one@b.com', 'homepage')`);
    let url = '';
    let auth = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      auth = String((init?.headers as Record<string, string>).Authorization);
      return new Response('{"id":"mail"}', { status: 200 });
    }) as unknown as typeof fetch;
    const result = await sendCustomerRadarDigest({
      db,
      log: log(),
      resendApiKey: 're_test_customer_radar',
      from: 'Relicita <radar@example.com>',
      baseUrl: 'https://eutendersai.com',
      operatorKey: SECRET,
      now: new Date('2026-10-25T12:00:00Z'),
    });
    expect(result.sent).toBe(1);
    expect(url).toBe('https://api.resend.com/emails');
    expect(auth).toBe('Bearer re_test_customer_radar');
    await db.end();
  });

  it('applies migration 012 twice', async () => {
    const db = await makeTestDb();
    await db.query(MIG007);
    await db.query(MIG008);
    await db.query(MIG012);
    await expect(db.query(MIG012)).resolves.toBeTruthy();
    await db.end();
  });
});

describe('customer radar HTTP', () => {
  afterEach(() => {
    resetPayments();
    vi.restoreAllMocks();
  });

  it('unsubscribes from a one-click link and the operator run skips that address', async () => {
    const db = await dbWithLeads(new Date());
    const config = makeTestConfig({
      operatorKey: SECRET,
      resendApiKey: 're_test_customer_radar',
      digestFromEmail: 'Relicita <radar@example.com>',
      baseUrl: 'https://eutendersai.com',
    });
    const app = await buildServer(config, db);
    const token = unsubscribeToken('all@b.com', SECRET);
    const bad = await app.inject({ method: 'GET', url: '/radar/baja?token=nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain('Enlace no válido');

    const ok = await app.inject({ method: 'GET', url: `/radar/baja?token=${encodeURIComponent(token)}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('text/html');
    expect(ok.body).toContain('Baja hecha');
    const stored = await db.query(`SELECT unsubscribed_at FROM demo_requests WHERE email = 'all@b.com'`);
    expect(stored.rows[0].unsubscribed_at).toBeTruthy();

    const again = await app.inject({ method: 'GET', url: `/radar/baja?token=${encodeURIComponent(token)}` });
    expect(again.statusCode).toBe(200);

    const denied = await app.inject({ method: 'POST', url: '/v1/radar/digest' });
    expect(denied.statusCode).toBe(401);

    globalThis.fetch = vi.fn(async () => new Response('{"id":"mail"}', { status: 200 })) as unknown as typeof fetch;
    const run = await app.inject({
      method: 'POST',
      url: '/v1/radar/digest',
      headers: { 'x-operator-key': SECRET },
    });
    expect(run.statusCode).toBe(200);
    const body = run.json();
    expect(body.data.sent).toBe(2);
    expect(body.data.already_sent).toBe(1);
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const payloads = calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)) as { to: string[] });
    expect(payloads.map((payload) => payload.to[0]).sort()).toEqual(['none@b.com', 'only72@b.com']);

    const repeat = await app.inject({
      method: 'POST',
      url: '/v1/radar/digest',
      headers: { 'x-operator-key': SECRET },
    });
    expect(repeat.json().data.sent).toBe(0);
    await app.close();
    await db.end();
  });

  it('refuses to send when Resend is not configured', async () => {
    const db = await dbWithLeads(new Date());
    const app = await buildServer(makeTestConfig({ operatorKey: SECRET, resendApiKey: '' }), db);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/radar/digest',
      headers: { 'x-operator-key': SECRET },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.hint).toBe('missing_resend');
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
    await db.end();
  });
});

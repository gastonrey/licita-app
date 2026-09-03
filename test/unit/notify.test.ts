// P0.x: Lead notification (operator email via Resend HTTP API).
//
// Behavior contract:
// - No-op when RESEND_API_KEY is empty (dev/test runs without secrets).
// - When set, POST to https://api.resend.com/emails with the lead payload.
// - Never throws, never blocks. On non-2xx or network error: warn-log and move on.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/client.js';
import { createLogger, type Logger } from '../../src/obs/log.js';
import { notifyNewLead, type NotifyConfig, type NotifyLead } from '../../src/obs/notify.js';

const TEST_Db = {} as Db; // not exercised by notifyNewLead's no-op path
const baseLead: NotifyLead = { id: 42, email: 'lead@example.com', channel: 'homepage', source_url: 'https://example.com/about' };

function cfg(overrides: Partial<NotifyConfig> = {}): NotifyConfig {
  return {
    notifyEmail: 'ops@licita.test',
    resendApiKey: 're_test_abcdefghijklmnopqrstuvwxyz0123456789',
    resendFrom: 'Licita <operator@licita.test>',
    ...overrides,
  };
}

function makeSilentLogger(): Logger {
  return {
    level: 'error',
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe('notifyNewLead', () => {
  let originalFetch: typeof globalThis.fetch;
  let log: Logger;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    log = makeSilentLogger();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('is a no-op when RESEND_API_KEY is empty (no HTTP call)', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    notifyNewLead(TEST_Db, log, baseLead, cfg({ resendApiKey: '' }));
    // wait a tick for the (skipped) promise to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs to api.resend.com/emails with bearer auth + JSON body when key is set', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response('{"id":"abc"}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;

    notifyNewLead(TEST_Db, log, baseLead, cfg());
    // wait for the (microtask) fetch promise to settle
    await new Promise((r) => setTimeout(r, 5));

    expect(capturedUrl).toBe('https://api.resend.com/emails');
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe('Bearer re_test_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(headers?.['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.from).toBe('Licita <operator@licita.test>');
    expect(body.to).toEqual(['ops@licita.test']);
    expect(body.subject).toBe('New demo lead: lead@example.com');
    expect(body.html).toContain('lead@example.com');
    expect(body.html).toContain('homepage');
    expect(body.html).toContain('https://example.com/about');
    expect(body.html).toContain('42');
  });

  it('does not throw on non-2xx (logs warn)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"message":"forbidden"}', { status: 500 })) as unknown as typeof globalThis.fetch;
    const warnSpy = vi.fn();
    const errorLog: Logger = { ...log, warn: warnSpy };
    expect(() => notifyNewLead(TEST_Db, errorLog, baseLead, cfg())).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(warnSpy).toHaveBeenCalled();
    const call = warnSpy.mock.calls[0];
    expect(call[0]).toBe('lead notification failed');
    const fields = call[1] as { leadId: number; status: number; body: string };
    expect(fields.leadId).toBe(42);
    expect(fields.status).toBe(500);
    expect(typeof fields.body).toBe('string');
  });

  it('does not throw on network error (logs warn)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof globalThis.fetch;
    const warnSpy = vi.fn();
    const errorLog: Logger = { ...log, warn: warnSpy };
    expect(() => notifyNewLead(TEST_Db, errorLog, baseLead, cfg())).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(warnSpy).toHaveBeenCalled();
    const call = warnSpy.mock.calls[0];
    expect(call[0]).toBe('lead notification error');
    const fields = call[1] as { leadId: number; error: string };
    expect(fields.leadId).toBe(42);
    expect(fields.error).toContain('ECONNRESET');
  });

  it('uses a real createLogger without crashing when the request rejects', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof globalThis.fetch;
    // Sanity check: a real Logger from createLogger accepts the warn call.
    const realLog = createLogger('warn');
    expect(() => notifyNewLead(TEST_Db, realLog, baseLead, cfg())).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
  });
});

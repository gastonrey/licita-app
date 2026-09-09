// C1.2 digest config surface (fiat-revenue-rails): SCHEDULED_GENERATION_EVENTS,
// DIGEST_ENABLED, DIGEST_CRON, DIGEST_FROM_EMAIL, DIGEST_BCC — loadConfig
// defaults/reads + validateConfig production fail-closed rule.

import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { validateConfig } from '../../src/config.validate.js';
import { makeTestConfig } from './testconfig.js';

const DIGEST_ENV_KEYS = [
  'SCHEDULED_GENERATION_EVENTS',
  'DIGEST_ENABLED',
  'DIGEST_CRON',
  'DIGEST_FROM_EMAIL',
  'DIGEST_BCC',
] as const;

const saved = new Map<string, string | undefined>();
beforeEachSave();
function beforeEachSave() {
  for (const key of DIGEST_ENV_KEYS) saved.set(key, process.env[key]);
}

afterEach(() => {
  for (const key of DIGEST_ENV_KEYS) {
    const orig = saved.get(key);
    if (orig === undefined) delete process.env[key];
    else process.env[key] = orig;
  }
});

describe('loadConfig (digest keys)', () => {
  it('defaults: generation on, digest off, cron Monday 09:00, empty from/bcc', () => {
    for (const key of DIGEST_ENV_KEYS) delete process.env[key];
    const cfg = loadConfig();
    expect(cfg.scheduledGenerationEvents).toBe(true);
    expect(cfg.digestEnabled).toBe(false);
    expect(cfg.digestCron).toBe('0 9 * * 1');
    expect(cfg.digestFromEmail).toBe('');
    expect(cfg.digestBcc).toBe('');
  });

  it('parses the env flags and values when set', () => {
    process.env.SCHEDULED_GENERATION_EVENTS = 'false';
    process.env.DIGEST_ENABLED = 'true';
    process.env.DIGEST_CRON = '0 6 * * 2';
    process.env.DIGEST_FROM_EMAIL = 'digest@licita.example';
    process.env.DIGEST_BCC = 'ops@licita.example';
    const cfg = loadConfig();
    expect(cfg.scheduledGenerationEvents).toBe(false);
    expect(cfg.digestEnabled).toBe(true);
    expect(cfg.digestCron).toBe('0 6 * * 2');
    expect(cfg.digestFromEmail).toBe('digest@licita.example');
    expect(cfg.digestBcc).toBe('ops@licita.example');
  });
});

describe('validateConfig (digest fail-closed)', () => {
  const prodDigestOn = (overrides = {}) =>
    makeTestConfig({
      nodeEnv: 'production',
      paymentsMode: 'x402',
      baseUrl: 'https://licita.example',
      x402: { facilitatorUrl: 'https://facilitator.example.com', payTo: '0x1234567890abcdef1234567890abcdef12345678', network: 'eip155:84532' },
      payHmacSecret: '',
      operatorKey: 'real-operator-secret',
      digestEnabled: true,
      digestFromEmail: 'digest@licita.example',
      digestBcc: 'ops@licita.example',
      ...overrides,
    });

  it('passes in production when DIGEST_ENABLED=true and from/bcc are set', () => {
    expect(() => validateConfig(prodDigestOn())).not.toThrow();
  });

  it('fails in production when DIGEST_ENABLED=true but DIGEST_FROM_EMAIL is missing, naming it', () => {
    expect(() => validateConfig(prodDigestOn({ digestFromEmail: '' }))).toThrow(/DIGEST_FROM_EMAIL/);
  });

  it('fails in production when DIGEST_ENABLED=true but DIGEST_BCC is missing, naming it', () => {
    expect(() => validateConfig(prodDigestOn({ digestBcc: '' }))).toThrow(/DIGEST_BCC/);
  });

  it('lists both missing digest vars in one violation batch', () => {
    let message = '';
    try {
      validateConfig(prodDigestOn({ digestFromEmail: '', digestBcc: '' }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('DIGEST_FROM_EMAIL');
    expect(message).toContain('DIGEST_BCC');
  });

  it('does not require digest vars in production when DIGEST_ENABLED=false', () => {
    expect(() =>
      validateConfig(prodDigestOn({ digestEnabled: false, digestFromEmail: '', digestBcc: '' })),
    ).not.toThrow();
  });

  it('does not require digest vars outside production (dev/test rate-guard applies)', () => {
    expect(() =>
      validateConfig(
        makeTestConfig({ digestEnabled: true, digestFromEmail: '', digestBcc: '' }),
      ),
    ).not.toThrow();
  });
});
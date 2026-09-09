// C1.4 Weekly digest scheduler (fiat-revenue-rails RD): cron parsing, UTC
// next-run math, and the enablement gate (DIGEST_ENABLED + SCHEDULED_GENERATION_EVENTS).
// The runner uses injected send/now so tests never touch real timers or Resend.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config.js';
import type { DigestSendEnv } from '../../src/obs/digest.js';
import type { NotifyLogger } from '../../src/obs/notify.js';
import { makeTestConfig } from './testconfig.js';
import {
  msUntilNextDigest,
  parseDigestCron,
  startDigestScheduler,
} from '../../src/obs/digest-runner.js';

// Thursday 2026-09-10 12:00 UTC.
const NOW = new Date('2026-09-10T12:00:00.000Z');
const MONDAY_0900 = new Date('2026-09-14T09:00:00.000Z');

function silentLogger(): NotifyLogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

describe('parseDigestCron', () => {
  it('parses the default DIGEST_CRON shape (minute hour dayOfWeek)', () => {
    expect(parseDigestCron('0 9 * * 1')).toEqual({ minute: 0, hour: 9, dayOfWeek: 1 });
    expect(parseDigestCron('30 8 * * 5')).toEqual({ minute: 30, hour: 8, dayOfWeek: 5 });
  });

  it('rejects malformed or out-of-scope cron values', () => {
    expect(parseDigestCron(undefined)).toBeNull();
    expect(parseDigestCron('')).toBeNull();
    expect(parseDigestCron('0 9 * *')).toBeNull(); // 4 fields
    expect(parseDigestCron('0 9 1 * 1')).toBeNull(); // day-of-month plans out of scope
    expect(parseDigestCron('0 9 * 3 1')).toBeNull(); // month plans out of scope
    expect(parseDigestCron('99 9 * * 1')).toBeNull(); // minute out of range
    expect(parseDigestCron('0 25 * * 1')).toBeNull(); // hour out of range
    expect(parseDigestCron('0 9 * * 7')).toBeNull(); // dow out of range (0-6)
    expect(parseDigestCron('not a cron')).toBeNull();
  });
});

describe('msUntilNextDigest', () => {
  it('computes ms to the next weekly occurrence (Thursday → Monday 09:00)', () => {
    const got = msUntilNextDigest({ minute: 0, hour: 9, dayOfWeek: 1 }, NOW);
    expect(got).toBe(MONDAY_0900.getTime() - NOW.getTime());
  });

  it('fires today when the target time is still ahead', () => {
    const monday0800 = new Date('2026-09-14T08:00:00.000Z');
    expect(msUntilNextDigest({ minute: 0, hour: 9, dayOfWeek: 1 }, monday0800)).toBe(3600_000);
  });

  it('rolls to next week when the target time today already passed', () => {
    const monday1000 = new Date('2026-09-14T10:00:00.000Z');
    const nextMonday = new Date('2026-09-21T09:00:00.000Z');
    expect(msUntilNextDigest({ minute: 0, hour: 9, dayOfWeek: 1 }, monday1000)).toBe(
      nextMonday.getTime() - monday1000.getTime(),
    );
  });
});

describe('startDigestScheduler', () => {
  let config: AppConfig;
  let send: ReturnType<typeof vi.fn>;
  let db: unknown;

  beforeEach(() => {
    send = vi.fn(async (env: DigestSendEnv) => env.from.length > 0);
    db = {};
    config = makeTestConfig({
      scheduledGenerationEvents: true,
      digestEnabled: true,
      digestCron: '0 9 * * 1',
      digestFromEmail: 'digest@licita.example',
      digestBcc: 'ops@licita.example',
      resendApiKey: 're_test_digest_scheduler',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms and fires the digest once at the next cron occurrence, then weekly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const delay = MONDAY_0900.getTime() - NOW.getTime();

    const handle = startDigestScheduler(config, db as never, {
      send,
      now: () => NOW,
      log: silentLogger(),
    });

    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);

    const env = send.mock.calls[0][0] as DigestSendEnv;
    expect(env.from).toBe('digest@licita.example');
    expect(env.bcc).toBe('ops@licita.example');
    expect(env.resendApiKey).toBe('re_test_digest_scheduler');
    expect(env.db).toBe(db);

    // Weekly cadence: a second fire after 7 days.
    await vi.advanceTimersByTimeAsync(7 * 24 * 3600 * 1000);
    expect(send).toHaveBeenCalledTimes(2);

    handle.stop();
  });

  it('never arms when DIGEST_ENABLED is false', async () => {
    vi.useFakeTimers();
    const handle = startDigestScheduler(
      { ...config, digestEnabled: false },
      db as never,
      { send, now: () => NOW, log: silentLogger() },
    );
    await vi.advanceTimersByTimeAsync(14 * 24 * 3600 * 1000);
    expect(send).not.toHaveBeenCalled();
    handle.stop();
  });

  it('never arms when SCHEDULED_GENERATION_EVENTS is false', async () => {
    vi.useFakeTimers();
    const handle = startDigestScheduler(
      { ...config, scheduledGenerationEvents: false },
      db as never,
      { send, now: () => NOW, log: silentLogger() },
    );
    await vi.advanceTimersByTimeAsync(14 * 24 * 3600 * 1000);
    expect(send).not.toHaveBeenCalled();
    handle.stop();
  });

  it('never arms on an invalid DIGEST_CRON', async () => {
    vi.useFakeTimers();
    const handle = startDigestScheduler(
      { ...config, digestCron: '0 9 1 * 1' },
      db as never,
      { send, now: () => NOW, log: silentLogger() },
    );
    await vi.advanceTimersByTimeAsync(14 * 24 * 3600 * 1000);
    expect(send).not.toHaveBeenCalled();
    handle.stop();
  });
});
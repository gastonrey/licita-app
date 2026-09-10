// C2.4 Ingest-scheduler graceful degradation (fiat-revenue-rails RD): the
// daily cron arming math, the fire cadence, and the two resilience pins —
// a throwing runner never breaks the next scheduled run, and stop() cancels
// pending timers. The production scheduler already catches runner errors and
// clears timers; these tests lock that contract against regressions.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../src/config.js';
import type { Db } from '../../src/db/client.js';
import { msUntilNextHourUtc, startScheduler } from '../../src/ingest/scheduler.js';
import { makeTestConfig } from './testconfig.js';

// Thursday 2026-09-10 12:00 UTC; default ingestCronHour=4 → next fire
// 2026-09-11 04:00 UTC, i.e. 16h = 57_600_000 ms away.
const NOW = new Date('2026-09-10T12:00:00.000Z');
const FIRST_FIRE = new Date('2026-09-11T04:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function visibleConfig(): AppConfig {
  return makeTestConfig({ ingestCronHour: 4, ingestOnBoot: false });
}

describe('msUntilNextHourUtc', () => {
  it('fires later today when the target hour is still ahead', () => {
    expect(msUntilNextHourUtc(18, new Date('2026-09-10T12:00:00Z'))).toBe(6 * 3600_000);
  });

  it('rolls to tomorrow when the target hour already passed', () => {
    expect(msUntilNextHourUtc(4, NOW)).toBe(FIRST_FIRE.getTime() - NOW.getTime());
    expect(msUntilNextHourUtc(0, new Date('2026-09-10T23:00:00Z'))).toBe(3600_000);
  });
});

describe('startScheduler', () => {
  let runner: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    runner = vi.fn(async () => 'ok');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fires once at the next cron hour, then every 24h', async () => {
    const db = {} as Db;
    const handle = startScheduler(visibleConfig(), db, runner);

    await vi.advanceTimersByTimeAsync(FIRST_FIRE.getTime() - NOW.getTime() - 1);
    expect(runner).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runner).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(runner).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it('a throwing run is logged and never breaks the next scheduled run', async () => {
    runner
      .mockRejectedValueOnce(new Error('upstream ingest exploded'))
      .mockResolvedValueOnce('ok');
    const handle = startScheduler(visibleConfig(), {} as Db, runner);

    await vi.advanceTimersByTimeAsync(FIRST_FIRE.getTime() - NOW.getTime());
    expect(runner).toHaveBeenCalledTimes(1); // first run failed inside tick()

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(runner).toHaveBeenCalledTimes(2); // cadence survived the failure
    handle.stop();
  });

  it('stop() before the first fire cancels the pending run', async () => {
    const handle = startScheduler(visibleConfig(), {} as Db, runner);
    handle.stop();
    await vi.advanceTimersByTimeAsync(3 * DAY_MS);
    expect(runner).not.toHaveBeenCalled();
  });

  it('stop() after the first fire cancels the daily interval', async () => {
    const handle = startScheduler(visibleConfig(), {} as Db, runner);
    await vi.advanceTimersByTimeAsync(FIRST_FIRE.getTime() - NOW.getTime());
    expect(runner).toHaveBeenCalledTimes(1);
    handle.stop();
    await vi.advanceTimersByTimeAsync(3 * DAY_MS);
    expect(runner).toHaveBeenCalledTimes(1); // no further runs after stop()
  });
});
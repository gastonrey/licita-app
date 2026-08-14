// Daily ingest scheduler (SPEC §8): setTimeout to next INGEST_CRON_HOUR, then
// setInterval every 24h. Errors are caught inside the loop and logged as JSON;
// the scheduler never crashes the host process.

import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { runIngestOnce } from './cli.js';

export interface SchedulerHandle {
  stop(): void;
}

/** Milliseconds from `now` until the next occurrence of `hour` (UTC, 0-23). */
export function msUntilNextHourUtc(hour: number, now: Date = new Date()): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

export function startScheduler(
  config: AppConfig,
  db: Db,
  runner: () => Promise<unknown> = () => runIngestOnce(config, db),
): SchedulerHandle {
  const hour = config.ingestCronHour;
  let interval: NodeJS.Timeout | null = null;
  let stopped = false;

  const tick = async (): Promise<void> => {
    try {
      log({ level: 'info', msg: 'scheduled ingest start', hour });
      await runner();
      log({ level: 'info', msg: 'scheduled ingest done' });
    } catch (err) {
      log({ level: 'error', msg: 'scheduled ingest failed', error: String(err) });
    }
  };

  const delay = msUntilNextHourUtc(hour);
  log({ level: 'info', msg: 'ingest scheduler armed', hour, firstRunInMs: delay });
  const timeout = setTimeout(() => {
    if (stopped) return;
    void tick();
    interval = setInterval(() => void tick(), 24 * 60 * 60 * 1000);
    interval.unref?.();
  }, delay);
  timeout.unref?.();

  return {
    stop(): void {
      stopped = true;
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    },
  };
}

// C1.4 Weekly digest scheduler (fiat-revenue-rails RD).
//
// Arms a weekly timer at the next DIGEST_CRON occurrence (UTC), then
// re-arms every 7 days. Clones the ingest scheduler posture: setTimeout to
// the first run, setInterval afterwards, .unref() so tests/CI hosts can exit,
// errors caught inside the loop (the scheduler never crashes the host).
//
// Enablement gate (fail-closed): the digest only arms when BOTH
// DIGEST_ENABLED=true AND SCHEDULED_GENERATION_EVENTS=true (the same switch
// that gates scheduled generation) AND DIGEST_CRON parses to a weekly
// spec. Otherwise startDigestScheduler returns a no-op handle. Production
// config validation additionally requires DIGEST_FROM_EMAIL/DIGEST_BCC, so
// an enabled digest always has an addressable recipient set.

import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { sendWeeklyDigest, type DigestSendEnv } from './digest.js';
import type { NotifyLogger } from './notify.js';

export interface DigestSchedulerHandle {
  stop(): void;
}

/** Parsed weekly cron spec. dayOfWeek follows JS Date.getUTCDay(): 0=Sunday. */
export interface DigestCronSpec {
  minute: number;
  hour: number;
  dayOfWeek: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Parse a 5-field cron ('minute hour dom month dow') into a weekly spec.
 * Only `* *` dom/month plans are in scope (DIGEST_CRON is weekly); anything
 * else, or any malformed value, yields null and the scheduler stays unarmed.
 */
export function parseDigestCron(cron: string | undefined): DigestCronSpec | null {
  if (!cron || cron.trim() === '') return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dom, month, dow] = parts;
  if (dom !== '*' || month !== '*') return null;
  const m = Number(minute);
  const h = Number(hour);
  const d = Number(dow);
  if (!Number.isInteger(m) || m < 0 || m > 59) return null;
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isInteger(d) || d < 0 || d > 6) return null;
  return { minute: m, hour: h, dayOfWeek: d };
}

/** Milliseconds from `now` until the next occurrence of `spec` (UTC). */
export function msUntilNextDigest(spec: DigestCronSpec, now: Date = new Date()): number {
  const todayAtTarget = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    spec.hour,
    spec.minute,
    0,
    0,
  );
  for (let i = 0; i < 8; i += 1) {
    const candidate = todayAtTarget + i * DAY_MS;
    if (candidate > now.getTime() && new Date(candidate).getUTCDay() === spec.dayOfWeek) {
      return candidate - now.getTime();
    }
  }
  return WEEK_MS; // unreachable (7 distinct weekdays); safety net
}

function jsonLog(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

export interface DigestSchedulerDeps {
  /** Injection seam for the send path (defaults to sendWeeklyDigest). */
  send?: (env: DigestSendEnv) => Promise<boolean>;
  /** Injection seam for the clock (defaults to new Date()). */
  now?: () => Date;
  log?: NotifyLogger;
}

/**
 * Arm the weekly digest. Returns a no-op handle when the gate is closed.
 */
export function startDigestScheduler(
  config: AppConfig,
  db: Db,
  deps: DigestSchedulerDeps = {},
): DigestSchedulerHandle {
  const send = deps.send ?? sendWeeklyDigest;
  const now = deps.now ?? (() => new Date());
  const log: NotifyLogger = deps.log ?? {
    debug: (msg, fields) => jsonLog({ level: 'debug', msg, ...fields }),
    info: (msg, fields) => jsonLog({ level: 'info', msg, ...fields }),
    warn: (msg, fields) => jsonLog({ level: 'warn', msg, ...fields }),
    error: (msg, fields) => jsonLog({ level: 'error', msg, ...fields }),
  };

  const spec = parseDigestCron(config.digestCron);
  if (!spec || !config.digestEnabled || !config.scheduledGenerationEvents) {
    log.debug('weekly digest scheduler not armed (gate closed)', {
      digestEnabled: config.digestEnabled,
      scheduledGenerationEvents: config.scheduledGenerationEvents,
      digestCron: config.digestCron,
    });
    return { stop(): void {} };
  }

  let timeout: NodeJS.Timeout | null = null;
  let interval: NodeJS.Timeout | null = null;
  let stopped = false;

  const tick = async (): Promise<void> => {
    try {
      log.info('weekly digest start', { cron: config.digestCron });
      await send({
        db,
        log,
        resendApiKey: config.resendApiKey,
        from: config.digestFromEmail,
        bcc: config.digestBcc,
        baseUrl: config.baseUrl,
        now: now(),
      });
      log.info('weekly digest done');
    } catch (err) {
      log.error('weekly digest failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const delay = msUntilNextDigest(spec, now());
  log.info('weekly digest scheduler armed', { cron: config.digestCron, firstRunInMs: delay });
  timeout = setTimeout(() => {
    if (stopped) return;
    void tick();
    interval = setInterval(() => void tick(), WEEK_MS);
    interval.unref?.();
  }, delay);
  timeout.unref?.();

  return {
    stop(): void {
      stopped = true;
      if (timeout) clearTimeout(timeout);
      if (interval) clearInterval(interval);
    },
  };
}
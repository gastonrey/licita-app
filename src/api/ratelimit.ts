// In-memory per-client token bucket rate limiter (SPEC §9: 60 req/min).
// Pure & injectable clock for unit tests. The bucket map is BOUNDED
// (maxKeys, default 10_000): on insert when full, the entry with the oldest
// last-activity timestamp is evicted (an evicted client simply gets a fresh
// full bucket). A periodic, unref'd sweep drops buckets that have been idle
// long enough to be fully refilled — they carry no rate-limit memory.

export interface RateLimitResult {
  allowed: boolean;
  /** seconds until at least one token is available (0 when allowed) */
  retryAfterSec: number;
  remaining: number;
  limit: number;
}

export interface RateLimiterOptions {
  /** bucket capacity (max burst). Default 60. */
  capacity?: number;
  /** tokens refilled per minute. Default 60. */
  refillPerMinute?: number;
  /** max distinct keys tracked before eviction. Default 10_000. */
  maxKeys?: number;
  /** sweep interval in ms (real time). Default 60_000. */
  sweepIntervalMs?: number;
  /** clock in ms, injectable for tests */
  now?: () => number;
}

export interface RateLimiter {
  take(key: string): RateLimitResult;
  /** number of tracked buckets (for tests/diagnostics) */
  size(): number;
}

interface Bucket {
  tokens: number;
  lastMs: number;
}

export function createRateLimiter(opts: RateLimiterOptions = {}): RateLimiter {
  const capacity = opts.capacity ?? 60;
  const refillPerMinute = opts.refillPerMinute ?? 60;
  const maxKeys = opts.maxKeys ?? 10_000;
  const now = opts.now ?? Date.now;
  const refillPerMs = refillPerMinute / 60_000;
  const buckets = new Map<string, Bucket>();

  // A bucket idle for this long has fully refilled: it is equivalent to a
  // fresh client, so dropping it loses nothing.
  const idleTtlMs = capacity / refillPerMs;

  function sweep(): void {
    const t = now();
    for (const [key, b] of buckets) {
      if (t - b.lastMs >= idleTtlMs) buckets.delete(key);
    }
  }

  const timer = setInterval(sweep, opts.sweepIntervalMs ?? 60_000);
  timer.unref(); // never keep the process alive for the sweeper

  /** Evict the bucket with the oldest last-activity timestamp. */
  function evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestMs = Infinity;
    for (const [key, b] of buckets) {
      if (b.lastMs < oldestMs) {
        oldestMs = b.lastMs;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) buckets.delete(oldestKey);
  }

  return {
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxKeys) evictOldest();
        b = { tokens: capacity, lastMs: t };
        buckets.set(key, b);
      }
      // refill
      const elapsed = Math.max(0, t - b.lastMs);
      b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
      b.lastMs = t;

      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { allowed: true, retryAfterSec: 0, remaining: Math.floor(b.tokens), limit: capacity };
      }
      const needMs = (1 - b.tokens) / refillPerMs;
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil(needMs / 1000)),
        remaining: 0,
        limit: capacity,
      };
    },
    size() {
      return buckets.size;
    },
  };
}

// In-memory per-client token bucket rate limiter (SPEC §9: 60 req/min).
// Pure & injectable clock for unit tests.

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
  const now = opts.now ?? Date.now;
  const refillPerMs = refillPerMinute / 60_000;
  const buckets = new Map<string, Bucket>();

  return {
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
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

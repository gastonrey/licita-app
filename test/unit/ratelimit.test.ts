import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../src/api/ratelimit.js';

describe('rate limiter token bucket', () => {
  it('allows up to capacity then rejects with retryAfter', () => {
    let now = 0;
    const rl = createRateLimiter({ capacity: 60, refillPerMinute: 60, now: () => now });
    for (let i = 0; i < 60; i++) {
      expect(rl.take('k').allowed, `request ${i + 1}`).toBe(true);
    }
    const r = rl.take('k');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it('refills over time', () => {
    let now = 0;
    const rl = createRateLimiter({ capacity: 2, refillPerMinute: 60, now: () => now });
    expect(rl.take('k').allowed).toBe(true);
    expect(rl.take('k').allowed).toBe(true);
    expect(rl.take('k').allowed).toBe(false);
    now += 1000; // 1 token per second at 60/min
    expect(rl.take('k').allowed).toBe(true);
    expect(rl.take('k').allowed).toBe(false);
    now += 60_000;
    // bucket capped at capacity
    expect(rl.take('k').remaining).toBe(1);
  });

  it('tracks keys independently', () => {
    const rl = createRateLimiter({ capacity: 1, refillPerMinute: 60, now: () => 0 });
    expect(rl.take('a').allowed).toBe(true);
    expect(rl.take('a').allowed).toBe(false);
    expect(rl.take('b').allowed).toBe(true);
    expect(rl.size()).toBe(2);
  });

  it('default limiter is 60 req/min', () => {
    const rl = createRateLimiter();
    const r = rl.take('k');
    expect(r.limit).toBe(60);
    expect(r.remaining).toBe(59);
  });
});

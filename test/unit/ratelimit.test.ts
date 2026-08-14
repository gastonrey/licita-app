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

describe('rate limiter bounds', () => {
  it('never exceeds maxKeys; evicts the oldest bucket on insert when full', () => {
    let now = 0;
    const rl = createRateLimiter({ capacity: 1, refillPerMinute: 60, maxKeys: 3, now: () => now });
    rl.take('a');
    now += 10;
    rl.take('b');
    now += 10;
    rl.take('c');
    expect(rl.size()).toBe(3);
    // 'a' is the oldest (lastMs 0); inserting 'd' must evict 'a', keeping size at 3.
    now += 10;
    rl.take('d');
    expect(rl.size()).toBe(3);
    // 'b' and 'c' still have exhausted buckets (1 capacity each, consumed).
    expect(rl.take('b').allowed).toBe(false);
    expect(rl.take('c').allowed).toBe(false);
    // 'a' was evicted → comes back as a fresh, full bucket.
    now += 10;
    expect(rl.take('a').allowed).toBe(true);
  });

  it('touching a key refreshes its eviction age', () => {
    let now = 0;
    const rl = createRateLimiter({ capacity: 60, refillPerMinute: 60, maxKeys: 2, now: () => now });
    rl.take('a');
    now += 10;
    rl.take('b');
    now += 10;
    rl.take('a'); // 'a' is now newer than 'b'
    now += 10;
    rl.take('c'); // evicts 'b', not 'a'
    expect(rl.take('a').remaining).toBeLessThan(59); // 'a' kept its consumed bucket
    expect(rl.size()).toBe(2);
  });

  it('periodic sweep removes buckets idle long enough to be fully refilled', async () => {
    let now = 0;
    // capacity 60 @ 60/min → fully refilled after 60s idle.
    const rl = createRateLimiter({ maxKeys: 100, sweepIntervalMs: 5, now: () => now });
    rl.take('a');
    rl.take('b');
    expect(rl.size()).toBe(2);
    now += 120_000; // both buckets idle past the refill window
    await new Promise((r) => setTimeout(r, 30)); // let the real interval tick
    expect(rl.size()).toBe(0);
  });
});

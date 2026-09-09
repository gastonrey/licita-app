// C2.3 Ingest-resilience primitives (fiat-revenue-rails): bounded-jitter
// exponential backoff and the circuit-lite guard shared by the TED/PLACSP
// fetch paths. Pure, injectable-clock — no timers or network in this suite.
//
// Contract pinned here:
// - backoffDelayMs: 2^attempt * baseMs + jitter in [0, jitterMaxMs)
// - circuit stays closed before `threshold` consecutive failures;
//   on the threshold failure it opens and forces a fixed `openMs` wait;
//   a success closes it and resets the failure count.

import { describe, expect, it } from 'vitest';
import { backoffDelayMs, createBackoffCircuit } from '../../src/ingest/backoff.js';

describe('backoffDelayMs (exponential + bounded jitter)', () => {
  it('grows exponentially from the base (attempt 0 → base, attempt 2 → 4×base)', () => {
    // rand()=0 → pure exponential floor
    expect(backoffDelayMs(0, 1000, 250, () => 0)).toBe(1000);
    expect(backoffDelayMs(1, 1000, 250, () => 0)).toBe(2000);
    expect(backoffDelayMs(2, 1000, 250, () => 0)).toBe(4000);
    expect(backoffDelayMs(3, 1000, 250, () => 0)).toBe(8000);
  });

  it('jitter stays inside [0, jitterMaxMs): never negative, never reaching the cap', () => {
    // rand()=0.999… → exp floor + jitterMax-1; rand()=0 → exp floor.
    const floor = backoffDelayMs(2, 1000, 250, () => 0);
    const nearCap = backoffDelayMs(2, 1000, 250, () => 0.999999);
    expect(nearCap).toBe(floor + 249);
    expect(nearCap).toBeLessThan(floor + 250);
    expect(floor).toBeGreaterThanOrEqual(4000);
    // Default jitter cap is 250ms (the shared harvester default).
    const def = backoffDelayMs(0, 1000);
    expect(def).toBeGreaterThanOrEqual(1000);
    expect(def).toBeLessThan(1250);
  });
});

describe('createBackoffCircuit (circuit-lite)', () => {
  it('stays closed until the 3rd consecutive failure, then forces the open wait', () => {
    let now = 0;
    const c = createBackoffCircuit({ threshold: 3, openMs: 60_000, now: () => now });
    expect(c.isOpen()).toBe(false);
    expect(c.waitMs()).toBe(0);
    c.recordFailure();
    c.recordFailure();
    expect(c.failures()).toBe(2);
    expect(c.isOpen()).toBe(false); // 2 failures: still below threshold
    expect(c.waitMs()).toBe(0);
    c.recordFailure();
    expect(c.failures()).toBe(3);
    expect(c.isOpen()).toBe(true); // threshold reached: circuit opened
    expect(c.waitMs()).toBe(60_000);
  });

  it('the open wait shrinks as time passes and never exceeds openMs', () => {
    let now = 0;
    const c = createBackoffCircuit({ threshold: 3, openMs: 60_000, now: () => now });
    c.recordFailure();
    c.recordFailure();
    c.recordFailure();
    now += 10_000;
    expect(c.waitMs()).toBe(50_000);
    now += 50_000;
    expect(c.waitMs()).toBe(0); // fully elapsed → closed again
    expect(c.isOpen()).toBe(false);
  });

  it('a success closes the circuit and resets the consecutive-failure count', () => {
    const c = createBackoffCircuit({ threshold: 3, openMs: 60_000, now: () => 0 });
    c.recordFailure();
    c.recordFailure();
    c.recordFailure();
    expect(c.isOpen()).toBe(true);
    c.recordSuccess();
    expect(c.failures()).toBe(0);
    expect(c.isOpen()).toBe(false);
    expect(c.waitMs()).toBe(0);
  });

  it('failures keep the circuit open without extending the window', () => {
    let now = 0;
    const c = createBackoffCircuit({ threshold: 3, openMs: 60_000, now: () => now });
    c.recordFailure();
    c.recordFailure();
    c.recordFailure();
    expect(c.waitMs()).toBe(60_000);
    now += 30_000;
    c.recordFailure(); // 4th failure while open
    c.recordFailure(); // 5th failure while open
    expect(c.failures()).toBe(5);
    expect(c.waitMs()).toBe(30_000); // window NOT extended by later failures
  });
});
// C2.3 Ingest-resilience primitives shared by the TED and PLACSP fetch paths:
// exponential retry delay with bounded jitter, and a circuit-lite guard that
// opens after `threshold` consecutive failures and forces a fixed cooldown
// before the next attempt. Pure and injectable-clock — no timers, no network —
// so the unit suite can pin the bounds exactly.

/** Exponential retry delay in ms: 2^attempt * baseMs + floor(rand() * jitterMaxMs).
 *  Jitter stays within [0, jitterMaxMs): never negative, never reaching the cap;
 *  default jitter cap 250ms matches the harvesters' historical behavior. */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  jitterMaxMs = 250,
  rand: () => number = Math.random,
): number {
  return 2 ** attempt * baseMs + Math.floor(rand() * jitterMaxMs);
}

export interface BackoffCircuitOptions {
  /** Consecutive failures before the circuit opens (default 3). */
  threshold?: number;
  /** Forced wait while open, in ms (default 60_000 = circuit-lite cooldown). */
  openMs?: number;
  /** Clock in ms, injectable for tests. */
  now?: () => number;
}

export interface BackoffCircuit {
  /** Consecutive failures recorded so far. */
  failures(): number;
  /** True while the cooldown window is active. */
  isOpen(): boolean;
  /** ms to wait before the next attempt: 0 when closed, remaining cooldown when open. */
  waitMs(): number;
  /** Record a failed attempt; returns the consecutive-failure count after it. */
  recordFailure(): number;
  /** A successful response closes the circuit and resets the counter. */
  recordSuccess(): void;
}

export function createBackoffCircuit(opts: BackoffCircuitOptions = {}): BackoffCircuit {
  const threshold = opts.threshold ?? 3;
  const openMs = opts.openMs ?? 60_000;
  const now = opts.now ?? Date.now;
  let failures = 0;
  /** 0 = closed; otherwise the timestamp when the cooldown ends. */
  let openUntilMs = 0;

  return {
    failures: () => failures,
    isOpen: () => openUntilMs > now(),
    waitMs: () => {
      const remaining = openUntilMs - now();
      return remaining > 0 ? Math.min(remaining, openMs) : 0;
    },
    recordFailure: () => {
      failures += 1;
      // Open the circuit exactly when the threshold is crossed; later failures
      // while open do NOT extend the window (bounded cooldown).
      if (failures >= threshold && openUntilMs <= now()) {
        openUntilMs = now() + openMs;
      }
      return failures;
    },
    recordSuccess: () => {
      failures = 0;
      openUntilMs = 0;
    },
  };
}
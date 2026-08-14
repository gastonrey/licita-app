// In-memory metrics counters with label support + snapshot. Process-local (SPEC §9).

export interface Metrics {
  inc(name: string, labels?: Record<string, string>, n?: number): void;
  snapshot(): Record<string, number>;
  reset(): void;
}

function keyOf(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`);
  return `${name}{${parts.join(',')}}`;
}

export function createMetrics(): Metrics {
  const counters = new Map<string, number>();
  return {
    inc(name, labels, n = 1) {
      const key = keyOf(name, labels);
      counters.set(key, (counters.get(key) ?? 0) + n);
    },
    snapshot() {
      const out: Record<string, number> = {};
      for (const [k, v] of [...counters.entries()].sort()) out[k] = v;
      return out;
    },
    reset() {
      counters.clear();
    },
  };
}

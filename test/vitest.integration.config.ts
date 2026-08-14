// Integration-test config (W4). Boots the REAL wired app against a REAL
// embedded PostgreSQL + a live TED ingest slice. NOT part of the default
// `npm test` (unit) run — execute explicitly:
//
//   npx vitest run -c test/vitest.integration.config.ts
//
// The suite skips gracefully when the TED Search API is unreachable.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    // embedded-pg initdb + ingest + app boot all happen in beforeAll.
    hookTimeout: 300_000,
    testTimeout: 120_000,
    // single fork: one shared embedded postgres on port 5433.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});

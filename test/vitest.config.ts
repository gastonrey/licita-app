// Unit-test config (test/unit/**). W2's server smoke test runs separately via
// test/vitest.smoke.config.ts (it aliases src/pay/middleware.js to a stub).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
  },
});

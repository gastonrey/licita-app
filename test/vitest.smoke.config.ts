// Throwaway vitest config for the server smoke test: aliases src/pay/middleware.js
// (owned by W3, not yet merged) to the stub in test/stubs/.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const stub = fileURLToPath(new URL('./stubs/pay-middleware.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /.*pay\/middleware\.js$/, replacement: stub }],
  },
  test: {
    include: ['test/api-smoke/server.smoke.test.ts'],
  },
});

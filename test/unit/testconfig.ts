// Shared valid dev-mode AppConfig for unit/smoke tests. Keeps the AppConfig
// literals in one place so required-field additions don't fan out edits.
import type { AppConfig } from '../../src/config.js';

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    logLevel: 'error',
    nodeEnv: 'test',
    pg: { host: '', port: 0, user: '', password: '', database: '' },
    paymentsMode: 'dev',
    payHmacSecret: 'test-secret',
    x402: { facilitatorUrl: 'https://facilitator.test', network: 'eip155:84532' },
    operatorKey: 'test-operator-key',
    trustProxy: false,
    rateLimitMaxKeys: 1000,
    ingestMonths: 24,
    ingestOnBoot: false,
    ingestCronHour: 4,
    placsp: { enabled: false, maxPages: 5, delayMs: 500, schedule: false },
    ...overrides,
  };
}

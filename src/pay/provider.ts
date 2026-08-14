// Payment provider selection (SPEC §6). DevPaymentProvider is the default
// (PAYMENTS_MODE=dev, HMAC faucet tokens for local development).
// X402PaymentProvider (src/pay/x402Provider.ts) is the real x402 v2 flow:
// facilitator verify+settle via the official @x402/core + @x402/evm packages.

import type { PaymentProvider } from '../domain/types.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { DevPaymentProvider } from './devProvider.js';
import { X402PaymentProvider } from './x402Provider.js';

export { X402PaymentProvider } from './x402Provider.js';

/** Select the active payment provider from PAYMENTS_MODE. */
export function createPaymentProvider(config: AppConfig, db?: Db): PaymentProvider {
  if (config.paymentsMode === 'x402') return new X402PaymentProvider(config.x402, db);
  return new DevPaymentProvider({ secret: config.payHmacSecret, db });
}

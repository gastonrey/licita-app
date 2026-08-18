// Payment provider selection (SPEC §6). DevPaymentProvider is the default
// (PAYMENTS_MODE=dev, HMAC faucet tokens for local development).
// X402PaymentProvider (src/pay/x402Provider.ts) is the real x402 v2 flow:
// facilitator verify+settle via the official @x402/core + @x402/evm packages.

import type { PaymentProvider } from '../domain/types.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { DevPaymentProvider } from './devProvider.js';
import { X402PaymentProvider } from './x402Provider.js';
import { priceOverrides } from './prices.js';

export { X402PaymentProvider } from './x402Provider.js';

/** Select the active payment provider from PAYMENTS_MODE. Config-driven price
 *  overrides (RESEARCH_PRICE_USD) are injected here so every provider resolves
 *  prices identically (overrides → ENDPOINT_PRICES → "0.00"). */
export function createPaymentProvider(config: AppConfig, db?: Db): PaymentProvider {
  const prices = priceOverrides(config);
  if (config.paymentsMode === 'x402') {
    return new X402PaymentProvider(config.x402, db, { prices });
  }
  return new DevPaymentProvider({ secret: config.payHmacSecret, db, prices });
}

// Payment provider selection (SPEC §6). DevPaymentProvider is the default
// (PAYMENTS_MODE=dev); X402PaymentProvider is a clean seam for a real x402
// facilitator integration (Coinbase facilitator, USDC/Base) — it is NOT a fake
// implementation: verify always fails with reason 'x402_not_configured' until
// the facilitator round-trip is implemented.

import {
  ENDPOINT_PRICES,
  type PaymentProvider,
  type PaymentRequirement,
  type PaymentVerification,
} from '../domain/types.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { DevPaymentProvider } from './devProvider.js';

/** Thrown by X402PaymentProvider internals when facilitator config is missing. */
export class PaymentNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentNotConfiguredError';
  }
}

/**
 * Stub for the real x402 flow. Reads X402_FACILITATOR_URL / X402_PAY_TO /
 * X402_NETWORK from config and shapes 402 responses accordingly, but verify()
 * never succeeds: settling real payments requires the facilitator round-trip
 * (POST {paymentPayload, paymentRequirements} to the facilitator's /verify and
 * /settle endpoints), which is intentionally left unimplemented in the MVP.
 */
export class X402PaymentProvider implements PaymentProvider {
  readonly name = 'x402';
  private readonly x402: AppConfig['x402'];

  constructor(x402: AppConfig['x402']) {
    this.x402 = x402;
  }

  price(endpoint: string): string {
    return ENDPOINT_PRICES[endpoint] ?? '0.00';
  }

  requiredResponse(endpoint: string): PaymentRequirement {
    const amount = this.price(endpoint);
    const configured = Boolean(this.x402.facilitatorUrl && this.x402.payTo && this.x402.network);
    return {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: this.x402.network ?? 'base',
          asset: 'USDC',
          amount,
          payTo: this.x402.payTo ?? 'not-configured',
          resource: endpoint,
        },
      ],
      hint: configured
        ? `Create an exact x402 payment payload for this resource and retry with header X-PAYMENT; settlement via facilitator ${this.x402.facilitatorUrl}.`
        : 'x402 is selected but not fully configured (X402_FACILITATOR_URL / X402_PAY_TO / X402_NETWORK). Payments cannot be completed on this deployment yet.',
    };
  }

  /** Never verifies in the MVP — a clean seam, not a fake success path. */
  async verify(_proof: string, _endpoint: string): Promise<PaymentVerification> {
    if (!this.x402.facilitatorUrl || !this.x402.payTo || !this.x402.network) {
      return { ok: false, reason: 'x402_not_configured' };
    }
    // TODO(real x402): forward {proof, paymentRequirements} to
    // `${facilitatorUrl}/verify`, then `/settle`, and record the payment row.
    return { ok: false, reason: 'x402_not_configured' };
  }
}

/** Select the active payment provider from PAYMENTS_MODE. */
export function createPaymentProvider(config: AppConfig, db?: Db): PaymentProvider {
  if (config.paymentsMode === 'x402') return new X402PaymentProvider(config.x402);
  return new DevPaymentProvider({ secret: config.payHmacSecret, db });
}

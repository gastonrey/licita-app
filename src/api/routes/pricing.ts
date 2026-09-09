// GET /v1/pricing — free, machine-readable price ladder + payment flow (SPEC §5/§6).

import type { FastifyReply, FastifyRequest } from 'fastify';
import { CREDIT_BUNDLE_ENDPOINTS, CREDIT_BUNDLES, ENDPOINT_PRICES } from '../../domain/types.js';
import { envelope, type RouteCtx } from './common.js';

export interface PricingEntry {
  endpoint: string;
  price_usd: string;
  free: boolean;
}

/** Pure builder (unit-tested). @param stripe stripe deploy state (B2.6):
 *  pricing is honest — the subscription arm reflects the actual deployment:
 *  disabled → available:false; enabled → the CONFIGURED monthly price. */
export function buildPricing(
  paymentsMode: string,
  stripe?: { enabled: boolean; priceCents: number },
): {
  currency: string;
  payments_mode: string;
  endpoints: PricingEntry[];
  payment_flow: Record<string, unknown>;
  billing: Record<string, unknown>;
  subscription: Record<string, unknown>;
} {
  return {
    currency: 'USD',
    payments_mode: paymentsMode,
    endpoints: Object.entries(ENDPOINT_PRICES).map(([endpoint, price]) => ({
      endpoint,
      price_usd: price,
      free: price === '0.00',
    })),
    billing: {
      mechanism: 'prepaid_credits',
      bundles: CREDIT_BUNDLE_ENDPOINTS.map((endpoint) => ({
        amount_usd: (CREDIT_BUNDLES[endpoint] / 100).toFixed(2),
        endpoint,
      })),
      balance_endpoint: 'GET /v1/billing',
      usage: 'Send x-client-key on every priced request to pay from balance.',
    },
    // B2.6 pricing honesty: never invent a subscription that is not deployed.
    // The monthly price is ALWAYS derived from config (PRICE_CENTS), never
    // hardcoded, so the published number matches the Stripe line item.
    subscription:
      stripe?.enabled === true
        ? {
            available: true,
            provider: 'stripe',
            currency: 'EUR',
            price_monthly_cents: stripe.priceCents,
            price_monthly: (stripe.priceCents / 100).toFixed(2),
            checkout_endpoint: 'POST /v1/stripe/checkout',
            mechanics:
              'Subscribers get one-time credits per payment: calls debit the credit account (X-PAYMENT: <lct key>), never a per-call fee. The preserved 25 trial calls remain usable.',
          }
        : {
            available: false,
            provider: 'stripe',
            reason: 'Stripe billing is not enabled on this deployment (STRIPE_ENABLED=false).',
          },
    payment_flow: {
      protocol: 'x402',
      version: 2,
      steps: [
        '1. Call a paid endpoint without payment → HTTP 402 with a base64 PAYMENT-REQUIRED response header (v2): JSON { x402Version: 2, resource, accepts[] } describing the exact USDC requirement (scheme "exact", EIP-3009 transferWithAuthorization).',
        '2. Sign the EIP-3009 transferWithAuthorization of USDC for accepts[0].amount on the stated network with an x402 client (or viem), producing a base64 payment payload.',
        '3. Retry the original request with header PAYMENT-SIGNATURE: <payload> (v2). The server verifies AND settles the payment with its facilitator before serving content; proofs are single-use. The legacy v1 X-PAYMENT header is still accepted.',
        '4. Dev caveat (PAYMENTS_MODE=dev only): POST /v1/dev-faucet {"endpoint": "<METHOD PATH>"} → { proof }; retry with X-PAYMENT: <proof>. The faucet is NOT available in production.',
        '5. Successful responses include meta.price_usd and meta.paid=true.',
      ],
      /** v2 response header carrying the base64 payment requirements. */
      required_header: 'PAYMENT-REQUIRED',
      /** v2 request header carrying the base64 payment payload. */
      signature_header: 'PAYMENT-SIGNATURE',
      /** Legacy v1 request header, still accepted. Kept for machine-shape stability. */
      header: 'X-PAYMENT',
      faucet: paymentsMode === 'dev' ? 'POST /v1/dev-faucet {"endpoint": "<METHOD PATH>"}' : null,
    },
  };
}

export function pricingHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send(envelope(req, buildPricing(ctx.config.paymentsMode, ctx.config.stripe)));
  };
}

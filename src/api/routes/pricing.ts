// GET /v1/pricing — free, machine-readable price ladder + payment flow (SPEC §5/§6).

import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENDPOINT_PRICES } from '../../domain/types.js';
import { envelope, type RouteCtx } from './common.js';

export interface PricingEntry {
  endpoint: string;
  price_usd: string;
  free: boolean;
}

/** Pure builder (unit-tested). */
export function buildPricing(paymentsMode: string): {
  currency: string;
  payments_mode: string;
  endpoints: PricingEntry[];
  payment_flow: Record<string, unknown>;
} {
  return {
    currency: 'USD',
    payments_mode: paymentsMode,
    endpoints: Object.entries(ENDPOINT_PRICES).map(([endpoint, price]) => ({
      endpoint,
      price_usd: price,
      free: price === '0.00',
    })),
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
    return reply.send(envelope(req, buildPricing(ctx.config.paymentsMode)));
  };
}

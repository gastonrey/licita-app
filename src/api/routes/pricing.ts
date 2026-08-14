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
      protocol: 'x402-compatible',
      steps: [
        '1. Call a paid endpoint without payment → HTTP 402 with body { x402Version, accepts[], hint }.',
        '2. In dev mode (PAYMENTS_MODE=dev): POST /v1/dev-faucet with {"endpoint": "<METHOD PATH>"} → { proof }.',
        '3. Retry the original request with header X-PAYMENT: <proof>. Proofs are single-use and expire after 5 minutes.',
        '4. Successful responses include meta.price_usd and meta.paid=true.',
      ],
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

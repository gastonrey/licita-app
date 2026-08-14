// THROWAWAY test stub for W3's src/pay/middleware.ts — used only via vitest alias
// (test/vitest.smoke.config.ts). Never imported from src/ in production.
// Mimics the contract: enforces payment per endpoint key, sets request.payment.

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ENDPOINT_PRICES } from '../../src/domain/types.js';

export function paymentPreHandler(endpointKey: string): preHandlerHookHandler {
  const price = ENDPOINT_PRICES[endpointKey] ?? '0.00';
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const proof = req.headers['x-payment'];
    if (proof === 'test-proof') {
      req.payment = { paid: true, priceUsd: price, clientKey: 'test-client' };
      return;
    }
    await reply.code(402).send({
      x402Version: 1,
      accepts: [
        { scheme: 'exact', network: 'dev', asset: 'USD', amount: price, payTo: 'dev-faucet', resource: endpointKey },
      ],
      hint: 'POST /v1/dev-faucet {endpoint} -> {proof}; retry with header X-PAYMENT: <proof>',
    });
  };
}

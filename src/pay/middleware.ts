// paymentPreHandler(endpointKey) — Fastify preHandler enforcing x402-shaped
// payment on priced /v1 endpoints (SPEC §6). Runs BEFORE zod validation.
//
// Wiring note: buildServer (src/api/server.ts) owns payment initialization —
// it calls initPayments(config, db) before registering routes, so REST
// payments never depend on mountMcp. There is NO lazy fallback: using the
// middleware before initPayments throws a clear error.

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import type { PaymentProvider, PaymentRequirement } from '../domain/types.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { createLogger, type Logger } from '../obs/log.js';
import { createPaymentProvider } from './provider.js';
import type { RequestPayment } from '../api/routes/common.js';

declare module 'fastify' {
  interface FastifyRequest {
    payment?: RequestPayment;
  }
}

interface PaymentRuntime {
  provider: PaymentProvider;
  db: Db;
  log: Logger;
}

let runtime: PaymentRuntime | null = null;

/**
 * Initialize the payment runtime with the shared config + db pool. Called by
 * buildServer during app wiring; idempotent (last call wins).
 */
export function initPayments(
  config: AppConfig,
  db: Db,
  providerOverride?: PaymentProvider,
): PaymentProvider {
  runtime = {
    provider: providerOverride ?? createPaymentProvider(config, db),
    db,
    log: createLogger(config.logLevel),
  };
  return runtime.provider;
}

/** Test hook: clear the module runtime so each test can re-init cleanly. */
export function resetPayments(): void {
  runtime = null;
}

function getRuntime(): PaymentRuntime {
  if (!runtime) {
    throw new Error(
      'Payment runtime is not initialized: buildServer must call initPayments(config, db) before routes handle requests.',
    );
  }
  return runtime;
}

/** The initialized provider (e.g. for mountMcp). Throws if initPayments was not called. */
export function getPaymentProvider(): PaymentProvider {
  return getRuntime().provider;
}

function paymentRequiredBody(requirement: PaymentRequirement, message: string) {
  return {
    ...requirement,
    error: {
      code: 'payment_required' as const,
      message,
      hint: requirement.hint,
    },
  };
}

/**
 * x402 v2: the 402 response must also carry the payment requirements as a
 * base64 PAYMENT-REQUIRED header (v2 clients read the header, not the body).
 * The `hint` field is our operator-facing addition and is not part of the
 * protocol object. v1-shaped requirements (dev mode) emit no header, keeping
 * the dev path byte-identical.
 */
function paymentRequiredHeaders(
  requirement: PaymentRequirement,
  message: string,
): Record<string, string> {
  if (requirement.x402Version !== 2) return {};
  const { hint: _hint, ...protocol } = requirement;
  return {
    'PAYMENT-REQUIRED': encodePaymentRequiredHeader({ ...protocol, error: message } as PaymentRequired),
  };
}

/**
 * Fastify preHandler enforcing payment for `endpointKey` (an ENDPOINT_PRICES
 * key like 'GET /v1/search'). Free endpoints ('0.00') mark the request paid
 * and continue. Payment proofs are read from the PAYMENT-SIGNATURE header
 * (x402 v2) or the X-PAYMENT header (v1 legacy; also the dev-token header).
 * Priced endpoints without a valid proof get a 402 in x402 shape plus the
 * standard error envelope (v2 responses also carry a base64 PAYMENT-REQUIRED
 * header); the preHandler sends it and halts the chain. On valid proof the
 * payment row is recorded by the provider (unique proof insert — replay →
 * verify fails with reason 'replay').
 */
export function paymentPreHandler(endpointKey: string): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const provider = getPaymentProvider();
    const price = provider.price(endpointKey);
    if (price === '0.00') {
      req.payment = { paid: true, priceUsd: '0.00' };
      return;
    }

    const proofHeader = req.headers['payment-signature'] ?? req.headers['x-payment'];
    const proof = Array.isArray(proofHeader) ? proofHeader[0] : proofHeader;
    if (typeof proof !== 'string' || proof.length === 0) {
      const requirement = provider.requiredResponse(endpointKey);
      req.errorCode = 'payment_required';
      const message = `Payment required: ${endpointKey} costs $${price} per call.`;
      await reply
        .code(402)
        .headers(paymentRequiredHeaders(requirement, message))
        .send(paymentRequiredBody(requirement, message));
      return; // halt: response sent
    }

    const rt = getRuntime();
    const verification = await rt.provider.verify(proof, endpointKey);
    if (!verification.ok) {
      req.errorCode = 'payment_required';
      rt.log.info('payment_attempt_failed', {
        endpoint: endpointKey,
        reason: verification.reason ?? 'invalid',
        ...(verification.attempts ? { attempts: verification.attempts } : {}),
      });
      const requirement = rt.provider.requiredResponse(endpointKey);
      const message = `Payment proof rejected (${verification.reason ?? 'invalid'}). Proofs are single-use and expire after 5 minutes.`;
      await reply
        .code(402)
        .headers(paymentRequiredHeaders(requirement, message))
        .send(paymentRequiredBody(requirement, message));
      return; // halt: response sent
    }

    rt.log.info('payment_success', {
      endpoint: endpointKey,
      amount: verification.amount ?? price,
      client_key: verification.clientKey,
      provider: rt.provider.name,
      ...(verification.attempts ? { attempts: verification.attempts } : {}),
      ...(verification.txHash ? { tx_hash: verification.txHash } : {}),
      ...(verification.bazaar !== undefined ? { bazaar: verification.bazaar } : {}),
    });
    req.payment = {
      paid: true,
      priceUsd: verification.amount ?? price,
      ...(verification.clientKey ? { clientKey: verification.clientKey } : {}),
    };
  };
}

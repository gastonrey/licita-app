// paymentPreHandler(endpointKey) — Fastify preHandler enforcing x402-shaped
// payment on priced /v1 endpoints (SPEC §6). Runs BEFORE zod validation.
//
// Wiring note: src/api/server.ts (W2) calls paymentPreHandler(key) without
// config/db, so this module keeps a runtime singleton. Production wiring calls
// initPayments(config, db) from mountMcp (src/mcp/server.ts) before listen;
// as a fallback the singleton is lazily built from env on first paid request.

import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ENDPOINT_PRICES, type PaymentProvider } from '../domain/types.js';
import { loadConfig, type AppConfig } from '../config.js';
import { createDb, type Db } from '../db/client.js';
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
 * mountMcp during app wiring; idempotent (last call wins).
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
    // Fallback for contexts where initPayments was never called (e.g. a bare
    // buildServer without mountMcp). Pool is lazy — no connection until query.
    const config = loadConfig();
    initPayments(config, createDb(config));
  }
  return runtime as PaymentRuntime;
}

/** Provider usable without a db (for building 402 bodies). */
function getProvider(): PaymentProvider {
  if (runtime) return runtime.provider;
  const config = loadConfig();
  return createPaymentProvider(config);
}

function paymentRequiredBody(provider: PaymentProvider, endpointKey: string, message: string) {
  const requirement = provider.requiredResponse(endpointKey);
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
 * Fastify preHandler enforcing payment for `endpointKey` (an ENDPOINT_PRICES
 * key like 'GET /v1/search'). Free endpoints ('0.00') mark the request paid
 * and continue. Priced endpoints without a valid X-PAYMENT proof get a 402 in
 * x402 shape plus the standard error envelope; the preHandler sends it and
 * halts the chain. On valid proof the payment row is recorded by the provider
 * (unique proof insert — replay → verify fails with reason 'replay').
 */
export function paymentPreHandler(endpointKey: string): preHandlerHookHandler {
  const price = ENDPOINT_PRICES[endpointKey] ?? '0.00';
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (price === '0.00') {
      req.payment = { paid: true, priceUsd: '0.00' };
      return;
    }

    const proof = req.headers['x-payment'];
    if (typeof proof !== 'string' || proof.length === 0) {
      const provider = getProvider();
      req.errorCode = 'payment_required';
      await reply
        .code(402)
        .send(
          paymentRequiredBody(
            provider,
            endpointKey,
            `Payment required: ${endpointKey} costs $${price} per call.`,
          ),
        );
      return; // halt: response sent
    }

    const rt = getRuntime();
    const verification = await rt.provider.verify(proof, endpointKey);
    if (!verification.ok) {
      req.errorCode = 'payment_required';
      rt.log.info('payment_attempt_failed', {
        endpoint: endpointKey,
        reason: verification.reason ?? 'invalid',
      });
      await reply
        .code(402)
        .send(
          paymentRequiredBody(
            rt.provider,
            endpointKey,
            `Payment proof rejected (${verification.reason ?? 'invalid'}). Proofs are single-use and expire after 5 minutes.`,
          ),
        );
      return; // halt: response sent
    }

    rt.log.info('payment_success', {
      endpoint: endpointKey,
      amount: verification.amount ?? price,
      client_key: verification.clientKey,
      provider: rt.provider.name,
    });
    req.payment = {
      paid: true,
      priceUsd: verification.amount ?? price,
      ...(verification.clientKey ? { clientKey: verification.clientKey } : {}),
    };
  };
}

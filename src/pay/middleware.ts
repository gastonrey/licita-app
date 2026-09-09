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
import { randomUUID } from 'node:crypto';
import {
  CREDIT_BUNDLE_ENDPOINTS,
  type PaymentProvider,
  type PaymentRequirement,
} from '../domain/types.js';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { createLogger, type Logger } from '../obs/log.js';
import { createPaymentProvider } from './provider.js';
import { KEY_PREFIX, hashKey, hashKeyLog } from './keys.js';
import type { RequestPayment } from '../api/routes/common.js';

declare module 'fastify' {
  interface FastifyRequest {
    payment?: RequestPayment;
    /**
     * Granular reason a paid endpoint rejected the request. Surfaces in
     * `request_logs.error` for the operator dashboard so the "Payment health"
     * card can distinguish "no proof sent" from "proof rejected by verify"
     * and "facilitator unreachable". The public 402 envelope still says
     * `code: 'payment_required'` (OpenAPI) — this is a per-request tag.
     * Trial keys (B1.3) add 'quota_exhausted' / 'key_expired'.
     */
    paymentFailureKind?:
      | 'payment_required'
      | 'verify_failed'
      | 'facilitator_unavailable'
      | 'quota_exhausted'
      | 'key_expired';
  }
}

interface PaymentRuntime {
  provider: PaymentProvider;
  db: Db;
  log: Logger;
  /** Public origin used to build upgrade hints (config.baseUrl). */
  baseUrl: string;
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
    baseUrl: config.baseUrl,
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

export interface CreditDebitResult {
  ok: boolean;
  clientKey?: string;
  /** 'credit' (prepaid account) or 'trial' (api_clients quota key). */
  provider?: 'credit' | 'trial';
  clientId?: number;
  /** Set when an api_clients row exists but is exhausted/expired (B1.3). */
  errorCode?: 'trial_exhausted';
  kind?: 'quota_exhausted' | 'key_expired';
  message?: string;
  hint?: string;
}

/**
 * Atomic prepaid-balance debit for a priced call (P2). Succeeds only when the
 * client account exists AND balance_cents >= cost; the conditional UPDATE
 * guards against double-spend under concurrency (one winner per balance).
 * On success the payment row (provider 'credit', fresh UUID proof) is written
 * in the same transaction. When no row matches (no account / insufficient
 * funds) the transaction rolls back and { ok: false } is returned so callers
 * fall through to the per-call proof flow; a DB error rolls back and throws
 * (fail closed). Bundle purchase endpoints never debit — they top up instead.
 *
 * B1.3 seam (fiat-revenue-rails): keys with the lct_ prefix (trial/pro
 * api_clients rows) are handled by a quota-governed branch that runs BEFORE
 * the credit UPDATE:
 *  - active row (not expired, calls_remaining >= cost) → atomically decrement
 *    by 1, record a provider 'trial' payment row (0.00), return the hash-on-log
 *    label as clientKey (Decision 6 — never the raw secret);
 *  - exhausted/expired row → { ok:false, errorCode:'trial_exhausted', kind,
 *    message, hint } so callers can answer 403;
 *  - unknown key or legacy agent row (quota columns NULL) → { ok:false } so
 *    callers keep the existing proof flow (402 for unknown keys in dev mode).
 *    lct_ keys never reach the credit balance path.
 */
export async function tryCreditDebit(
  db: Db,
  endpointKey: string,
  price: string,
  clientKey: string,
  baseUrl = '',
): Promise<CreditDebitResult> {
  if (CREDIT_BUNDLE_ENDPOINTS.includes(endpointKey as (typeof CREDIT_BUNDLE_ENDPOINTS)[number])) {
    return { ok: false };
  }
  const costCents = Math.round(Number(price) * 100);
  if (!Number.isFinite(costCents) || costCents <= 0) return { ok: false };
  const proof = randomUUID();
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // B1.3 trial api_clients branch — BEFORE the credit UPDATE so a trial key
    // can never be double-charged against a prepaid balance.
    if (clientKey.startsWith(KEY_PREFIX)) {
      const row = await client.query(
        `SELECT id, calls_remaining, expires_at FROM api_clients WHERE key_hash = $1`,
        [hashKey(clientKey)],
      );
      if (row.rows.length === 1) {
        const r = row.rows[0] as {
          id: number;
          calls_remaining: number | null;
          expires_at: Date | null;
        };
        // Legacy agent rows (001 shape, quota columns NULL) keep the old flow.
        const legacy = r.calls_remaining === null && r.expires_at === null;
        if (!legacy) {
          const failed = (
            kind: 'quota_exhausted' | 'key_expired',
            message: string,
          ): CreditDebitResult => ({
            ok: false,
            errorCode: 'trial_exhausted',
            kind,
            message,
            hint: `Upgrade: see ${baseUrl}/pricing or POST /v1/stripe/checkout`,
          });
          const expired = r.expires_at !== null && new Date(r.expires_at).getTime() <= Date.now();
          const active = !expired && r.calls_remaining !== null && r.calls_remaining >= costCents;
          if (!active) {
            await client.query('ROLLBACK');
            return expired
              ? failed('key_expired', `Trial key expired: ${hashKeyLog(clientKey)} is no longer valid.`)
              : failed(
                  'quota_exhausted',
                  `Trial quota exhausted: ${hashKeyLog(clientKey)} can no longer call ${endpointKey}.`,
                );
          }
          const updated = await client.query(
            `UPDATE api_clients
             SET calls_remaining = calls_remaining - 1
             WHERE key_hash = $1 AND calls_remaining >= $2
             RETURNING id`,
            [hashKey(clientKey), costCents],
          );
          if (updated.rows.length === 0) {
            // lost a concurrent race for the last affordable call
            await client.query('ROLLBACK');
            return failed(
              'quota_exhausted',
              `Trial quota exhausted: ${hashKeyLog(clientKey)} can no longer call ${endpointKey}.`,
            );
          }
          await client.query(
            `INSERT INTO payments (client_id, endpoint, amount_usd, provider, proof, status)
             VALUES ($1, $2, '0.00', 'trial', $3, 'success')`,
            [r.id, endpointKey, proof],
          );
          await client.query('COMMIT');
          return { ok: true, clientKey: hashKeyLog(clientKey), provider: 'trial', clientId: r.id };
        }
      }
      // Unknown lct_ key or legacy agent row: roll back and let the caller use
      // the proof flow. Never touch the credit account with an lct_ key.
      await client.query('ROLLBACK');
      return { ok: false };
    }

    const updated = await client.query(
      `UPDATE credit_accounts
       SET balance_cents = balance_cents - $2::int, updated_at = now()
       WHERE client_key = $1 AND balance_cents >= $2::int
       RETURNING balance_cents`,
      [clientKey, costCents],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false };
    }
    await client.query(
      `INSERT INTO payments (client_id, endpoint, amount_usd, provider, proof, status)
       VALUES (NULL, $1, $2, 'credit', $3, 'success')`,
      [endpointKey, price, proof],
    );
    await client.query('COMMIT');
    return { ok: true, clientKey };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
    const rt = getRuntime();
    const provider = rt.provider;
    const price = provider.price(endpointKey);
    if (price === '0.00') {
      req.payment = { paid: true, priceUsd: '0.00' };
      return;
    }

    // Prepaid balance debit (P2): when the request carries x-client-key and the
    // endpoint is not a credit bundle, try to pay from balance first. Failure
    // (no account / insufficient funds) falls through to the per-call proof.
    const clientKeyHeader = req.headers['x-client-key'];
    const clientKey = Array.isArray(clientKeyHeader) ? clientKeyHeader[0] : clientKeyHeader;
    const canDebit =
      typeof clientKey === 'string' &&
      clientKey.length > 0 &&
      !CREDIT_BUNDLE_ENDPOINTS.includes(endpointKey as (typeof CREDIT_BUNDLE_ENDPOINTS)[number]);
    if (canDebit) {
      const debit = await tryCreditDebit(rt.db, endpointKey, price, clientKey);
      if (debit.ok) {
        rt.log.info('payment_success', {
          endpoint: endpointKey,
          amount: price,
          client_key: debit.clientKey,
          provider: 'credit',
        });
        req.payment = { paid: true, priceUsd: price, clientKey: debit.clientKey };
        return;
      }
    }

    const proofHeader = req.headers['payment-signature'] ?? req.headers['x-payment'];
    const proof = Array.isArray(proofHeader) ? proofHeader[0] : proofHeader;

    // B1.3: trial/pro api_clients keys travel in X-PAYMENT (lct_ prefix).
    // Probe the quota-governed branch before the proof flow: active key → paid;
    // exhausted/expired key → 403 trial_exhausted (quota gate, not a payment
    // gate); unknown key → unchanged 402 proof flow below.
    const trialKey = typeof proof === 'string' && proof.startsWith(KEY_PREFIX) ? proof : undefined;
    if (trialKey !== undefined) {
      const debit = await tryCreditDebit(rt.db, endpointKey, price, trialKey, rt.baseUrl);
      if (debit.ok) {
        rt.log.info('payment_success', {
          endpoint: endpointKey,
          amount: price,
          client_key: debit.clientKey,
          provider: debit.provider ?? 'trial',
        });
        req.payment = { paid: true, priceUsd: price, clientKey: debit.clientKey };
        return;
      }
      if (debit.errorCode === 'trial_exhausted' && debit.kind && debit.message) {
        req.errorCode = 'trial_exhausted';
        req.paymentFailureKind = debit.kind === 'key_expired' ? 'key_expired' : 'quota_exhausted';
        rt.log.info('payment_attempt_failed', {
          endpoint: endpointKey,
          reason: debit.kind,
          client_key: hashKeyLog(trialKey),
        });
        await reply.code(403).send({
          error: {
            code: 'trial_exhausted' as const,
            message: debit.message,
            hint: debit.hint,
          },
        });
        return; // halt: quota gate answered, no proof flow
      }
      // unknown lct_ key or legacy agent row: { ok:false } without errorCode →
      // fall through to the existing proof flow (402 in dev mode).
    }

    if (typeof proof !== 'string' || proof.length === 0) {
      const requirement = provider.requiredResponse(endpointKey);
      req.errorCode = 'payment_required';
      req.paymentFailureKind = 'payment_required';
      const message =
        `Payment required: ${endpointKey} costs $${price} per call.` +
        (canDebit
          ? ' Prepaid balance insufficient — buy credits at POST /v1/billing/credits/5 (or /10 /25).'
          : '');
      await reply
        .code(402)
        .headers(paymentRequiredHeaders(requirement, message))
        .send(paymentRequiredBody(requirement, message));
      return; // halt: response sent
    }

    const verification = await rt.provider.verify(proof, endpointKey);
    if (!verification.ok) {
      req.errorCode = 'payment_required';
      // Map the provider's granular reason to the per-request log tag. The
      // provider returns 'verify_failed' (protocol rejection), 'replay'
      // (proof already used), or 'facilitator_unavailable' (network/timeout).
      const reason = verification.reason ?? 'verify_failed';
      req.paymentFailureKind =
        reason === 'facilitator_unavailable' ? 'facilitator_unavailable' : 'verify_failed';
      rt.log.info('payment_attempt_failed', {
        endpoint: endpointKey,
        reason,
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

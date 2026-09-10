// Billing routes (P2 prepaid credit bundles). GET /v1/billing is free and
// reads the balance for the x-client-key header. POST /v1/billing/credits/:amount
// (amount ∈ 5|10|25) is a PRICED endpoint: paymentPreHandler enforces the
// x402/dev proof and records the payment row; this handler then credits the
// account. The bundle endpoints never debit (they top up) — replay is blocked
// by the provider's unique payments.proof insert.
//
// B2.3/B2.5 (fiat-revenue-rails): Creem MoR surface, flag-gated by
// CREEM_ENABLED (off → 404):
//  - POST /v1/creem/webhook  — signature-verified checkout completion.
//  - POST /v1/creem/checkout — creates a Creem checkout session (303 URL).

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { envelope, HttpError, validate, type RouteCtx } from './common.js';
import { completeCheckout } from '../../pay/billing.js';
import { checkoutCompleted, createCheckoutSession, verifyWebhookSignature } from '../../pay/creem.js';

export const billingAmountSchema = z.object({
  amount: z.enum(['5', '10', '25'], { errorMap: () => ({ message: 'amount must be 5, 10 or 25' }) }),
});

export const billingAmountValidation = validate(billingAmountSchema, 'params');

// --- Creem MoR surface (B2.3/B2.5) ----------------------------------------

export const creemCheckoutSchema = z.object({
  email: z.string().trim().email('email must be a valid email address'),
  /** Where Creem returns the subscriber after payment. Defaults to
   *  {baseUrl}/?checkout=success (Decision 8) when omitted. */
  successUrl: z.string().url('successUrl must be an absolute URL').optional(),
  /** Where Creem returns the subscriber after cancel. Defaults to
   *  {baseUrl}/pricing (Decision 8) when omitted. */
  cancelUrl: z.string().url('cancelUrl must be an absolute URL').optional(),
});

export const creemCheckoutValidation = validate(creemCheckoutSchema, 'body');

function creemDisabled(): HttpError {
  return new HttpError(404, 'not_found', 'Creem billing is not enabled on this deployment.');
}

/**
 * POST /v1/creem/webhook — Creem sends signed events here. Verifies the
 * HMAC signature (raw-body HMAC-SHA256) against CREEM_WEBHOOK_SECRET,
 * then completes checkout for checkout.completed events. 200 {ok:true}
 * after successful processing; 400 unparseable; 401 bad signature;
 * 404 when CREEM_ENABLED=false. Non-completed events are acknowledged
 * without side effects.
 */
export function creemWebhookHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const creem = ctx.config.creem;
    if (!creem?.enabled) {
      throw creemDisabled();
    }
    const sig = req.headers['creem-signature'];
    const signature = Array.isArray(sig) ? sig[0] : sig;
    if (!req.rawBody) {
      throw new HttpError(400, 'invalid_query', 'Webhook requires a raw JSON body.');
    }
    let event: Record<string, unknown>;
    try {
      event = verifyWebhookSignature(req.rawBody, signature ?? '', creem.webhookSecret);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new HttpError(400, 'invalid_query', 'Webhook body is not valid JSON.');
      }
      throw new HttpError(401, 'invalid_signature', 'Creem webhook signature verification failed.');
    }
    if (event.eventType === 'checkout.completed') {
      let completed;
      try {
        completed = checkoutCompleted(event);
      } catch {
        throw new HttpError(400, 'invalid_query', 'checkout.completed event is malformed.');
      }
      await completeCheckout(ctx.db, ctx.config, { email: completed.email, eventId: completed.eventId });
      ctx.metrics.inc('subscription_activated_total');
    }
    return reply.send({ ok: true });
  };
}

/**
 * POST /v1/creem/checkout — creates a Creem checkout session for the
 * configured product (CREEM_PRODUCT_ID) and returns
 * the session URL as 303 {url}. 404 when CREEM_ENABLED=false (tagged
 * paymentFailureKind 'payment_disabled' for operator request logs).
 */
export function creemCheckoutHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const creem = ctx.config.creem;
    if (!creem?.enabled) {
      req.paymentFailureKind = 'payment_disabled';
      throw creemDisabled();
    }
    const body = req.body as { email: string; successUrl?: string; cancelUrl?: string };
    const url =
      body.successUrl ??
      `${ctx.config.baseUrl.replace(/\/+$/, '')}/?checkout=success`;
    const cancelUrl =
      body.cancelUrl ?? `${ctx.config.baseUrl.replace(/\/+$/, '')}/pricing`;
    const sessionUrl = await createCheckoutSession(ctx.config, {
      email: body.email,
      successUrl: url,
      cancelUrl,
    });
    ctx.metrics.inc('checkout_started_total');
    return reply.code(303).send(envelope(req, { url: sessionUrl }));
  };
}

/** The x-client-key header, required on every billing call (422 when absent). */
function clientKeyOf(req: FastifyRequest): string {
  const header = req.headers['x-client-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== 'string' || key.length === 0) {
    throw new HttpError(
      422,
      'invalid_query',
      'Missing x-client-key header.',
      'Send x-client-key: <your key> to identify the credit account; buy credits at POST /v1/billing/credits/5 (or /10 /25).',
    );
  }
  return key;
}

/** GET /v1/billing — free, requires x-client-key. 404 when no account exists. */
export function billingGetHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const key = clientKeyOf(req);
    const res = await ctx.db.query(
      'SELECT client_key, balance_cents FROM credit_accounts WHERE client_key = $1',
      [key],
    );
    if (res.rows.length === 0) {
      throw new HttpError(
        404,
        'not_found',
        `No credit account for client key "${key}".`,
        'Buy a bundle at POST /v1/billing/credits/5 (or /10 /25) to create one.',
      );
    }
    const balance_cents = Number(res.rows[0].balance_cents);
    return reply.send(
      envelope(req, {
        client_key: key,
        balance_cents,
        balance_usd: (balance_cents / 100).toFixed(2),
      }),
    );
  };
}

/**
 * POST /v1/billing/credits/:amount — priced (ENDPOINT_PRICES), so the payment
 * preHandler already verified the proof and set req.payment.priceUsd. Credits
 * the account with an atomic upsert; the payment row was recorded by the
 * provider (unique proof) so replay of the same proof is naturally blocked.
 */
export function billingPurchaseHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const key = clientKeyOf(req);
    const priceUsd = req.payment?.priceUsd;
    const addedCents = Math.round(Number(priceUsd) * 100);
    if (!Number.isFinite(addedCents) || addedCents <= 0) {
      throw new HttpError(
        400,
        'invalid_query',
        'No priced credit bundle matched this request.',
        'Amount must be 5, 10 or 25: POST /v1/billing/credits/:amount.',
      );
    }
    const res = await ctx.db.query(
      `INSERT INTO credit_accounts (client_key, balance_cents)
       VALUES ($1, $2)
       ON CONFLICT (client_key) DO UPDATE
         SET balance_cents = credit_accounts.balance_cents + EXCLUDED.balance_cents,
             updated_at = now()
       RETURNING balance_cents`,
      [key, addedCents],
    );
    const balance_cents = Number(res.rows[0].balance_cents);
    return reply.send(
      envelope(req, {
        client_key: key,
        added_cents: addedCents,
        balance_cents,
        balance_usd: (balance_cents / 100).toFixed(2),
      }),
    );
  };
}

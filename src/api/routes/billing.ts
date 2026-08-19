// Billing routes (P2 prepaid credit bundles). GET /v1/billing is free and
// reads the balance for the x-client-key header. POST /v1/billing/credits/:amount
// (amount ∈ 5|10|25) is a PRICED endpoint: paymentPreHandler enforces the
// x402/dev proof and records the payment row; this handler then credits the
// account. The bundle endpoints never debit (they top up) — replay is blocked
// by the provider's unique payments.proof insert.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { envelope, HttpError, validate, type RouteCtx } from './common.js';

export const billingAmountSchema = z.object({
  amount: z.enum(['5', '10', '25'], { errorMap: () => ({ message: 'amount must be 5, 10 or 25' }) }),
});

export const billingAmountValidation = validate(billingAmountSchema, 'params');

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

// B2.1 Stripe integration: checkout session creation, webhook signature
// verification, and checkout.completed event parser.
//
// Uses the official Stripe SDK (Decision 3, design #1119). Price is
// derived from PRICE_CENTS config (default 2900 = €29.00).
// Secret format validation: sk_test_ / sk_live_ prefix enforced at
// config.validate.ts; this module trusts the validated config.

import Stripe from 'stripe';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config.js';

export interface CheckoutSessionInput {
  email: string;
  priceCents?: number;
  mode: 'subscription';
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutCompletedEvent {
  email: string;
  amountTotal: number;
  sessionId: string;
  eventId: string;
}

/**
 * Create a Stripe Checkout Session for a subscription.
 * Price is derived from config.stripe.priceCents (default 2900 = €29/mo).
 * Returns the checkout session URL for browser redirect.
 * Throws when STRIPE_ENABLED=false or secretKey is missing.
 */
export async function createCheckoutSession(
  config: AppConfig,
  input: CheckoutSessionInput,
): Promise<string> {
  const stripe = config.stripe;
  if (!stripe?.enabled) {
    throw new Error('STRIPE_ENABLED is false — checkout sessions are disabled.');
  }
  if (!stripe.secretKey) {
    throw new Error('STRIPE_SECRET_KEY is missing — cannot create checkout session.');
  }
  const priceCents = input.priceCents ?? stripe.priceCents;
  const client = new Stripe(stripe.secretKey);
  const session = await client.checkout.sessions.create({
    mode: input.mode,
    customer_email: input.email,
    line_items: [
      {
        price_data: {
          currency: 'eur',
          product_data: { name: 'Licita Renewal Radar' },
          unit_amount: priceCents,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  if (!session.url) {
    throw new Error('Stripe checkout session created but no URL returned.');
  }
  return session.url;
}

/**
 * Verify a Stripe webhook signature against the raw payload.
 * Uses HMAC-SHA256 with timing-safe comparison (Stripe's v1 scheme).
 * Throws on missing header, expired timestamp, or invalid signature.
 */
export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): Record<string, unknown> {
  if (!signatureHeader) {
    throw new Error('Missing Stripe signature header.');
  }
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const [k, ...v] = p.split('=');
      return [k, v.join('=')];
    }),
  );
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) {
    throw new Error('Malformed Stripe signature header.');
  }
  // Timestamp tolerance: 5 minutes
  const toleranceSec = 300;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - Number(timestamp)) > toleranceSec) {
    throw new Error('Stripe webhook timestamp expired (>5 minutes).');
  }
  const signedPayload = `${timestamp}.${payload}`;
  const computedSig = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const sigBuf = Buffer.from(expectedSig, 'hex');
  const computedBuf = Buffer.from(computedSig, 'hex');
  if (sigBuf.length !== computedBuf.length || !timingSafeEqual(sigBuf, computedBuf)) {
    throw new Error('Invalid Stripe webhook signature.');
  }
  return JSON.parse(payload) as Record<string, unknown>;
}

/**
 * Parse a verified Stripe event as a checkout.session.completed.
 * Returns normalized fields; throws if event type doesn't match.
 */
export function checkoutCompleted(event: Record<string, unknown>): CheckoutCompletedEvent {
  if (event.type !== 'checkout.session.completed') {
    throw new Error(
      `Expected checkout.session.completed event, got "${event.type as string}".`,
    );
  }
  const dataHolder = event.data as { object?: Record<string, unknown> } | undefined;
  const obj = dataHolder?.object ?? {};
  const email = obj.customer_email as string | undefined;
  if (!email) {
    throw new Error('checkout.session.completed event missing customer_email.');
  }
  return {
    email,
    amountTotal: obj.amount_total as number,
    sessionId: obj.id as string,
    eventId: event.id as string,
  };
}

// B2.1 Creem MoR integration: checkout session creation, webhook signature
// verification, and checkout.completed event parser.
//
// Uses native fetch to the Creem REST API (no SDK). Product is derived from
// CREEM_PRODUCT_ID config. Secret format validation: CREEM_API_KEY and
// CREEM_WEBHOOK_SECRET enforced at config.validate.ts; this module trusts
// the validated config.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config.js';

export interface CheckoutSessionInput {
  email: string;
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
 * Create a Creem checkout session for a subscription.
 * Price is derived from config.creem.productId (Creem-managed product).
 * Returns the checkout session URL for browser redirect.
 * Throws when CREEM_ENABLED=false or apiKey is missing.
 */
export async function createCheckoutSession(
  config: AppConfig,
  input: CheckoutSessionInput,
): Promise<string> {
  const creem = config.creem;
  if (!creem?.enabled) {
    throw new Error('CREEM_ENABLED is false — checkout sessions are disabled.');
  }
  if (!creem.apiKey) {
    throw new Error('CREEM_API_KEY is missing — cannot create checkout session.');
  }
  const res = await fetch('https://api.creem.io/v1/checkouts', {
    method: 'POST',
    headers: {
      'x-api-key': creem.apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      product_id: creem.productId,
      success_url: input.successUrl,
      customer: { email: input.email },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Creem checkout API error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { checkout_url?: string };
  if (!data.checkout_url) {
    throw new Error('Creem checkout session created but no checkout_url returned.');
  }
  return data.checkout_url;
}

/**
 * Verify a Creem webhook signature against the raw payload.
 * Uses HMAC-SHA256 with timing-safe comparison (Creem's raw-body scheme).
 * Throws on missing header or invalid signature.
 */
export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): Record<string, unknown> {
  if (!signatureHeader) {
    throw new Error('Missing Creem signature header.');
  }
  const computedSig = createHmac('sha256', secret).update(payload).digest('hex');
  const expectedBuf = Buffer.from(signatureHeader, 'hex');
  const computedBuf = Buffer.from(computedSig, 'hex');
  if (expectedBuf.length !== computedBuf.length || !timingSafeEqual(expectedBuf, computedBuf)) {
    throw new Error('Invalid Creem webhook signature.');
  }
  return JSON.parse(payload) as Record<string, unknown>;
}

/**
 * Parse a verified Creem event as a checkout.completed.
 * Returns normalized fields; throws if event type doesn't match.
 */
export function checkoutCompleted(event: Record<string, unknown>): CheckoutCompletedEvent {
  if (event.eventType !== 'checkout.completed') {
    throw new Error(
      `Expected checkout.completed event, got "${event.eventType as string}".`,
    );
  }
  const obj = (event.object ?? {}) as Record<string, unknown>;
  const customer = (obj.customer ?? {}) as Record<string, unknown>;
  const email = customer.email as string | undefined;
  if (!email) {
    throw new Error('checkout.completed event missing customer.email.');
  }
  return {
    email,
    amountTotal: obj.amount_total as number,
    sessionId: obj.id as string,
    eventId: event.id as string,
  };
}

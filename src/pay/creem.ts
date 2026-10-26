// B2.1 Creem MoR integration: checkout session creation, webhook signature
// verification, and checkout.completed event parser.
//
// Uses native fetch to the Creem REST API (no SDK). Product is derived from
// CREEM_PRODUCT_ID config. Secret format validation: CREEM_API_KEY and
// CREEM_WEBHOOK_SECRET enforced at config.validate.ts; this module trusts
// the validated config.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeCreemApiBaseUrl, type AppConfig, type CreemPlanProducts } from '../config.js';

export type CreemPlan = 'radar' | 'pro' | 'team';
export type CreemInterval = 'monthly' | 'annual';

const EMPTY_PLANS: CreemPlanProducts = {
  radarMonthly: '',
  radarAnnual: '',
  proMonthly: '',
  proAnnual: '',
  teamMonthly: '',
};

export function creemPlansOf(creem: AppConfig['creem']): CreemPlanProducts {
  return creem.plans ?? EMPTY_PLANS;
}

/** Product id for a public plan price. Empty when that env var is unset.
 *  Team has no annual price. */
export function planProductId(creem: AppConfig['creem'], plan: CreemPlan, interval: CreemInterval): string {
  const plans = creemPlansOf(creem);
  if (plan === 'team') return interval === 'annual' ? '' : plans.teamMonthly;
  if (plan === 'radar') return interval === 'annual' ? plans.radarAnnual : plans.radarMonthly;
  return interval === 'annual' ? plans.proAnnual : plans.proMonthly;
}

/** Legacy CREEM_PRODUCT_ID plus every configured plan product. */
export function acceptedCreemProductIds(creem: AppConfig['creem']): Set<string> {
  const ids = new Set<string>();
  if (creem.productId) ids.add(creem.productId);
  for (const id of Object.values(creemPlansOf(creem))) {
    if (id) ids.add(id);
  }
  return ids;
}

/** Events with no product id keep the historical activation path.
 *  A present id must match the legacy product or any configured plan product. */
export function acceptsCreemProduct(creem: AppConfig['creem'], productId: string | null): boolean {
  if (!productId) return true;
  return acceptedCreemProductIds(creem).has(productId);
}

/** Product id carried on a Creem checkout.completed object, if the payload has one. */
export function checkoutProductId(event: Record<string, unknown>): string | null {
  const obj = (event.object ?? {}) as Record<string, unknown>;
  const asId = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const id = (value as Record<string, unknown>).id;
      if (typeof id === 'string' && id.trim()) return id.trim();
    }
    return null;
  };
  return (
    asId(obj.product_id) ??
    asId(obj.productId) ??
    asId(obj.product) ??
    asId((obj.order as Record<string, unknown> | undefined)?.product) ??
    null
  );
}

/** Absolute Creem REST URL. Every outbound Creem call goes through this. */
export function creemApiUrl(creem: AppConfig['creem'], path: string): string {
  const base = normalizeCreemApiBaseUrl(creem.apiBaseUrl);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export interface CheckoutSessionInput {
  email: string;
  successUrl: string;
  cancelUrl: string;
  /** Overrides CREEM_PRODUCT_ID. Plan checkout passes the plan product. */
  productId?: string;
}

export interface CheckoutCompletedEvent {
  email: string;
  amountTotal: number;
  sessionId: string;
  eventId: string;
}

/**
 * Create a Creem checkout session for a subscription.
 * The charged product is input.productId, or CREEM_PRODUCT_ID when omitted.
 * Returns the checkout session URL for browser redirect.
 * Throws when CREEM_ENABLED=false, apiKey is missing, or no product id is set.
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
  const productId = input.productId ?? creem.productId;
  if (!productId) {
    throw new Error('Creem product id is missing — cannot create checkout session.');
  }
  const res = await fetch(creemApiUrl(creem, '/v1/checkouts'), {
    method: 'POST',
    headers: {
      'x-api-key': creem.apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      product_id: productId,
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

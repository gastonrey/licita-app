// B2.1 Stripe module: createCheckoutSession, verifyWebhookSignature,
// checkoutCompleted event parser. All Stripe SDK calls are mocked; crypto
// HMAC is tested directly via Node.js crypto (matching production logic).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { AppConfig } from '../../src/config.js';

// ── Stripe SDK mock ──────────────────────────────────────────────────────
const mocks = {
  create: vi.fn(),
};
vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    checkout: { sessions: { create: mocks.create } },
  })),
}));

// ── SUT (import after mocks) ─────────────────────────────────────────────
import {
  createCheckoutSession,
  verifyWebhookSignature,
  checkoutCompleted,
} from '../../src/pay/stripe.js';

// ── Config factory ───────────────────────────────────────────────────────
function stripeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    logLevel: 'error',
    nodeEnv: 'test',
    pg: { host: '', port: 0, user: '', password: '', database: '' },
    paymentsMode: 'dev',
    payHmacSecret: 'test',
    researchPriceUsd: '0.50',
    x402: { facilitatorUrl: 'https://f.test', network: 'eip155:84532' },
    operatorKey: 'op',
    baseUrl: '',
    notifyEmail: '',
    resendApiKey: '',
    resendFrom: '',
    demoAutoReplyEnabled: false,
    trustProxy: false,
    rateLimitMaxKeys: 100,
    ingestMonths: 24,
    ingestOnBoot: false,
    ingestCronHour: 4,
    placsp: { enabled: false, maxPages: 5, delayMs: 500, schedule: false },
    stripe: {
      enabled: true,
      secretKey: 'sk_test_placeholder',
      webhookSecret: 'whsec_test_placeholder',
      priceCents: 2900,
    },
    ...overrides,
  };
}

// ── createCheckoutSession tests ──────────────────────────────────────────
describe('createCheckoutSession', () => {
  beforeEach(() => {
    mocks.create.mockReset();
    mocks.create.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a Stripe checkout session with correct params and returns URL', async () => {
    const config = stripeConfig();
    const url = await createCheckoutSession(config, {
      email: 'alice@example.com',
      priceCents: 2900,
      mode: 'subscription',
      successUrl: 'https://licita.example/?checkout=success',
      cancelUrl: 'https://licita.example/pricing',
    });
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test_abc');
    expect(mocks.create).toHaveBeenCalledOnce();
    const args = mocks.create.mock.calls[0][0];
    expect(args.mode).toBe('subscription');
    expect(args.customer_email).toBe('alice@example.com');
    expect(args.line_items[0].price_data.currency).toBe('eur');
    expect(args.line_items[0].price_data.unit_amount).toBe(2900);
    expect(args.line_items[0].price_data.recurring.interval).toBe('month');
    expect(args.success_url).toBe('https://licita.example/?checkout=success');
    expect(args.cancel_url).toBe('https://licita.example/pricing');
  });

  it('uses priceCents from config when omitted in call', async () => {
    const config = stripeConfig({
      stripe: { enabled: true, secretKey: 'sk_test_placeholder', webhookSecret: 'whsec_test_placeholder', priceCents: 1900 },
    });
    await createCheckoutSession(config, {
      email: 'bob@example.com',
      mode: 'subscription',
      successUrl: 'https://licita.example/s',
      cancelUrl: 'https://licita.example/c',
    });
    const args = mocks.create.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(1900);
  });

  it('throws when STRIPE_ENABLED is false', async () => {
    const config = stripeConfig({
      stripe: { enabled: false, secretKey: 'sk_test_xxx', webhookSecret: 'whsec_xxx', priceCents: 2900 },
    });
    await expect(
      createCheckoutSession(config, {
        email: 'alice@example.com',
        mode: 'subscription',
        successUrl: 'https://s',
        cancelUrl: 'https://c',
      }),
    ).rejects.toThrow(/STRIPE_ENABLED/);
  });

  it('throws when secretKey is missing', async () => {
    const config = stripeConfig({
      stripe: { enabled: true, secretKey: '', webhookSecret: 'whsec_xxx', priceCents: 2900 },
    });
    await expect(
      createCheckoutSession(config, {
        email: 'alice@example.com',
        mode: 'subscription',
        successUrl: 'https://s',
        cancelUrl: 'https://c',
      }),
    ).rejects.toThrow(/STRIPE_SECRET_KEY/);
  });
});

// ── verifyWebhookSignature tests ─────────────────────────────────────────
describe('verifyWebhookSignature', () => {
  it('returns the parsed event body when signature is valid', () => {
    const secret = 'whsec_test_placeholder';
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedPayload = `${timestamp}.${payload}`;
    const sig = createHmac('sha256', secret).update(signedPayload).digest('hex');
    const header = `t=${timestamp},v1=${sig}`;

    const result = verifyWebhookSignature(payload, header, secret);
    expect(result).toEqual({ type: 'checkout.session.completed', data: { object: {} } });
  });

  it('throws on invalid signature (wrong secret)', () => {
    const payload = '{"type":"test"}';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac('sha256', 'wrong-secret').update(`${timestamp}.${payload}`).digest('hex');
    const header = `t=${timestamp},v1=${sig}`;

    expect(() => verifyWebhookSignature(payload, header, 'correct-secret')).toThrow(/Invalid/i);
  });

  it('throws when signature header is empty', () => {
    expect(() => verifyWebhookSignature('body', '', 'secret')).toThrow(/missing/i);
  });

  it('throws on expired timestamp (>5 minutes)', () => {
    const secret = 'whsec_test_placeholder';
    const payload = '{"type":"test"}';
    const timestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 6.6 min ago
    const sig = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
    const header = `t=${timestamp},v1=${sig}`;

    expect(() => verifyWebhookSignature(payload, header, secret)).toThrow(/expired/i);
  });
});

// ── checkoutCompleted parser tests ───────────────────────────────────────
describe('checkoutCompleted', () => {
  it('parses a checkout.session.completed event and extracts email + amount', () => {
    const event = {
      id: 'evt_test_123',
      type: 'checkout.session.completed',
      data: {
        object: {
          customer_email: 'alice@example.com',
          amount_total: 2900,
          id: 'cs_test_xyz',
        },
      },
    };
    const parsed = checkoutCompleted(event);
    expect(parsed).toEqual({
      email: 'alice@example.com',
      amountTotal: 2900,
      sessionId: 'cs_test_xyz',
      eventId: 'evt_test_123',
    });
  });

  it('throws for non-checkout.session.completed events', () => {
    expect(() =>
      checkoutCompleted({ type: 'invoice.paid', data: { object: {} } }),
    ).toThrow(/checkout\.session\.completed/);
  });

  it('throws when customer_email is missing', () => {
    expect(() =>
      checkoutCompleted({
        type: 'checkout.session.completed',
        data: { object: { amount_total: 2900, id: 'cs_1' } },
      }),
    ).toThrow(/email/i);
  });
});

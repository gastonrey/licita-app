// B2.1 Creem MoR module: createCheckoutSession, verifyWebhookSignature,
// checkoutCompleted event parser. Uses native fetch (no SDK); crypto
// HMAC is tested directly via Node.js crypto (matching production logic).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { AppConfig } from '../../src/config.js';

// ── fetch mock (Creem uses native fetch, not an SDK) ─────────────────────
const mocks = {
  fetch: vi.fn(),
};
vi.stubGlobal('fetch', mocks.fetch);

// ── SUT (import after mocks) ─────────────────────────────────────────────
import {
  createCheckoutSession,
  verifyWebhookSignature,
  checkoutCompleted,
} from '../../src/pay/creem.js';

// ── Config factory ───────────────────────────────────────────────────────
function creemConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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
    creem: {
      enabled: true,
      apiKey: 'creem_test_placeholder',
      webhookSecret: 'whsec_creem_placeholder',
      productId: 'prod_creem_placeholder',
      priceCents: 2900,
    },
    ...overrides,
  };
}

// ── createCheckoutSession tests ──────────────────────────────────────────
describe('createCheckoutSession', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ checkout_url: 'https://checkout.creem.io/c/pay/cs_test_abc' }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a Creem checkout session with correct params and returns URL', async () => {
    const config = creemConfig();
    const url = await createCheckoutSession(config, {
      email: 'alice@example.com',
      successUrl: 'https://licita.example/?checkout=success',
      cancelUrl: 'https://licita.example/pricing',
    });
    expect(url).toBe('https://checkout.creem.io/c/pay/cs_test_abc');
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [requestUrl, options] = mocks.fetch.mock.calls[0];
    expect(requestUrl).toBe('https://api.creem.io/v1/checkouts');
    expect(options.method).toBe('POST');
    expect(options.headers['x-api-key']).toBe('creem_test_placeholder');
    const body = JSON.parse(options.body);
    expect(body.product_id).toBe('prod_creem_placeholder');
    expect(body.customer.email).toBe('alice@example.com');
    expect(body.success_url).toBe('https://licita.example/?checkout=success');
  });

  it('throws when CREEM_ENABLED is false', async () => {
    const config = creemConfig({
      creem: { enabled: false, apiKey: 'x', webhookSecret: 'x', productId: 'x', priceCents: 2900 },
    });
    await expect(
      createCheckoutSession(config, {
        email: 'alice@example.com',
        successUrl: 'https://s',
        cancelUrl: 'https://c',
      }),
    ).rejects.toThrow(/CREEM_ENABLED/);
  });

  it('throws when apiKey is missing', async () => {
    const config = creemConfig({
      creem: { enabled: true, apiKey: '', webhookSecret: 'whsec_x', productId: 'prod_x', priceCents: 2900 },
    });
    await expect(
      createCheckoutSession(config, {
        email: 'alice@example.com',
        successUrl: 'https://s',
        cancelUrl: 'https://c',
      }),
    ).rejects.toThrow(/CREEM_API_KEY/);
  });
});

// ── verifyWebhookSignature tests ─────────────────────────────────────────
describe('verifyWebhookSignature', () => {
  it('returns the parsed event body when signature is valid', () => {
    const secret = 'whsec_creem_placeholder';
    const payload = JSON.stringify({ eventType: 'checkout.completed', object: {} });
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    const header = sig;

    const result = verifyWebhookSignature(payload, header, secret);
    expect(result).toEqual({ eventType: 'checkout.completed', object: {} });
  });

  it('throws on invalid signature (wrong secret)', () => {
    const payload = '{"eventType":"test"}';
    const sig = createHmac('sha256', 'wrong-secret').update(payload).digest('hex');

    expect(() => verifyWebhookSignature(payload, sig, 'correct-secret')).toThrow(/invalid/i);
  });

  it('throws when signature header is empty', () => {
    expect(() => verifyWebhookSignature('body', '', 'secret')).toThrow(/missing/i);
  });
});

// ── checkoutCompleted parser tests ───────────────────────────────────────
describe('checkoutCompleted', () => {
  it('parses a checkout.completed event and extracts email + amount', () => {
    const event = {
      id: 'evt_test_123',
      eventType: 'checkout.completed',
      object: {
        customer: { email: 'alice@example.com' },
        amount_total: 2900,
        id: 'cs_test_xyz',
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

  it('throws for non-checkout.completed events', () => {
    expect(() =>
      checkoutCompleted({ eventType: 'invoice.paid', object: {} }),
    ).toThrow(/checkout\.completed/);
  });

  it('throws when customer email is missing', () => {
    expect(() =>
      checkoutCompleted({
        eventType: 'checkout.completed',
        object: { amount_total: 2900, id: 'cs_1' },
      }),
    ).toThrow(/email/i);
  });
});

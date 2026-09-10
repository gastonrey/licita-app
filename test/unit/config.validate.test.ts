// validateConfig: dev-mode required secrets, production x402 requirements,
// placeholder rejection, and all-violations-at-once error reporting.

import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/config.validate.js';
import { makeTestConfig } from './testconfig.js';

const VALID_PAY_TO = '0x1234567890abcdef1234567890abcdef12345678';
const VALID_FACILITATOR = 'https://facilitator.example.com';

function prodConfig(overrides = {}) {
  return makeTestConfig({
    nodeEnv: 'production',
    paymentsMode: 'x402',
    baseUrl: 'https://licita.example',
    x402: { facilitatorUrl: VALID_FACILITATOR, payTo: VALID_PAY_TO, network: 'eip155:84532' },
    payHmacSecret: '',
    operatorKey: 'real-operator-secret',
    ...overrides,
  });
}

describe('validateConfig (dev mode)', () => {
  it('passes with a valid dev config', () => {
    expect(() => validateConfig(makeTestConfig())).not.toThrow();
  });

  it('fails when PAY_HMAC_SECRET is missing, naming the var', () => {
    const config = makeTestConfig({ payHmacSecret: '' });
    expect(() => validateConfig(config)).toThrow(/PAY_HMAC_SECRET/);
  });

  it('fails when OPERATOR_KEY is missing, naming the var', () => {
    const config = makeTestConfig({ operatorKey: '' });
    expect(() => validateConfig(config)).toThrow(/OPERATOR_KEY/);
  });

  it('lists both missing secrets in one error', () => {
    const config = makeTestConfig({ payHmacSecret: '', operatorKey: '' });
    expect(() => validateConfig(config)).toThrow(/PAY_HMAC_SECRET[\s\S]*OPERATOR_KEY/);
  });

  it('does not require x402 vars outside production', () => {
    expect(() =>
      validateConfig(makeTestConfig({ paymentsMode: 'x402', x402: { facilitatorUrl: '', network: '' } })),
    ).not.toThrow();
  });
});

describe('validateConfig (research price)', () => {
  it('accepts a positive decimal RESEARCH_PRICE_USD', () => {
    for (const good of ['0.50', '1', '0.01', '99.99']) {
      expect(() => validateConfig(makeTestConfig({ researchPriceUsd: good }))).not.toThrow();
    }
  });

  it('rejects RESEARCH_PRICE_USD that is zero or non-positive', () => {
    for (const bad of ['0.00', '0', '0.0', '-0.5']) {
      expect(() => validateConfig(makeTestConfig({ researchPriceUsd: bad }))).toThrow(/RESEARCH_PRICE_USD/);
    }
  });

  it('rejects malformed decimal RESEARCH_PRICE_USD', () => {
    for (const bad of ['', 'free', '0.5.1', '1.234', 'NaN']) {
      expect(() => validateConfig(makeTestConfig({ researchPriceUsd: bad }))).toThrow(/RESEARCH_PRICE_USD/);
    }
  });
});

describe('validateConfig (production)', () => {
  it('passes with a valid production config', () => {
    expect(() => validateConfig(prodConfig())).not.toThrow();
  });

  it('rejects PAYMENTS_MODE=dev in production', () => {
    expect(() => validateConfig(prodConfig({ paymentsMode: 'dev', payHmacSecret: 'real-secret' }))).toThrow(
      /PAYMENTS_MODE must be "x402"/,
    );
  });

  it('rejects a malformed X402_PAY_TO (not an Ethereum address)', () => {
    for (const bad of ['0xabc', 'not-an-address', '0x' + 'g'.repeat(40), '1234567890abcdef1234567890abcdef12345678']) {
      expect(() =>
        validateConfig(prodConfig({ x402: { facilitatorUrl: VALID_FACILITATOR, payTo: bad, network: 'eip155:84532' } })),
      ).toThrow(/X402_PAY_TO/);
    }
  });

  it('accepts mixed-case hex X402_PAY_TO', () => {
    expect(() =>
      validateConfig(
        prodConfig({
          x402: { facilitatorUrl: VALID_FACILITATOR, payTo: '0xAaBbCcDdEeFf00112233445566778899aAbBcCdD', network: 'eip155:84532' },
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a non-https X402_FACILITATOR_URL', () => {
    for (const bad of ['http://facilitator.example.com', 'not-a-url', '']) {
      expect(() =>
        validateConfig(prodConfig({ x402: { facilitatorUrl: bad, payTo: VALID_PAY_TO, network: 'eip155:84532' } })),
      ).toThrow(/X402_FACILITATOR_URL/);
    }
  });

  it('rejects placeholder secrets and lists ALL violations at once', () => {
    const config = makeTestConfig({
      nodeEnv: 'production',
      paymentsMode: 'dev',
      baseUrl: 'https://licita.example',
      payHmacSecret: 'change-me-in-prod',
      operatorKey: 'change-me',
      x402: { facilitatorUrl: '', network: '' },
    });
    let message = '';
    try {
      validateConfig(config);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('PAYMENTS_MODE');
    expect(message).toContain('X402_PAY_TO');
    expect(message).toContain('X402_FACILITATOR_URL');
    expect(message).toContain('X402_NETWORK');
    expect(message).toContain('PAY_HMAC_SECRET must not be a known placeholder');
    expect(message).toContain('OPERATOR_KEY must not be a known placeholder');
    expect(message).toContain('6 violation(s)');
  });

  it('rejects a non-CAIP-2 X402_NETWORK in production', () => {
    for (const bad of ['base', 'base-sepolia', 'eip155:', 'eip155:abc', '']) {
      expect(() =>
        validateConfig(
          prodConfig({ x402: { facilitatorUrl: VALID_FACILITATOR, payTo: VALID_PAY_TO, network: bad } }),
        ),
      ).toThrow(/X402_NETWORK/);
    }
  });

  it('accepts Base mainnet and explicit eip155 overrides for X402_NETWORK', () => {
    for (const good of ['eip155:84532', 'eip155:8453', 'eip155:11155111']) {
      expect(() =>
        validateConfig(
          prodConfig({ x402: { facilitatorUrl: VALID_FACILITATOR, payTo: VALID_PAY_TO, network: good } }),
        ),
      ).not.toThrow();
    }
  });
});

// fiat-revenue-rails Slice A / domain-readiness DR1: baseUrl config with
// fail-closed production https validation.
describe('validateConfig (creem fail-closed, B2.6)', () => {
  const creemOn = (overrides = {}) =>
    makeTestConfig({
      creem: { enabled: true, apiKey: 'creem_test_placeholder', webhookSecret: 'whsec_creem_placeholder', productId: 'prod_creem_placeholder', priceCents: 2900 },
      ...overrides,
    });

  it('passes with a valid creem-enabled config (dev mode)', () => {
    expect(() => validateConfig(creemOn())).not.toThrow();
  });

  it('passes with live-mode secrets', () => {
    expect(() =>
      validateConfig(creemOn({ creem: { enabled: true, apiKey: 'creem_live_abc123', webhookSecret: 'whsec_live_abc', productId: 'prod_live_abc', priceCents: 2900 } })),
    ).not.toThrow();
  });

  it('fails when CREEM_ENABLED=true but CREEM_API_KEY is missing', () => {
    expect(() => validateConfig(creemOn({ creem: { enabled: true, apiKey: '', webhookSecret: 'whsec_creem_placeholder', productId: 'prod_creem_placeholder', priceCents: 2900 } }))).toThrow(
      /CREEM_API_KEY/,
    );
  });

  it('fails when CREEM_WEBHOOK_SECRET is missing', () => {
    expect(() => validateConfig(creemOn({ creem: { enabled: true, apiKey: 'creem_test_x', webhookSecret: '', productId: 'prod_creem_placeholder', priceCents: 2900 } }))).toThrow(/CREEM_WEBHOOK_SECRET/);
    expect(() =>
      validateConfig(creemOn({ creem: { enabled: true, apiKey: 'creem_test_x', webhookSecret: '', productId: 'prod_creem_placeholder' } })),
    ).toThrow(/CREEM_WEBHOOK_SECRET/);
  });

  it('fails when CREEM_PRODUCT_ID is missing', () => {
    expect(() =>
      validateConfig(creemOn({ creem: { enabled: true, apiKey: 'creem_test_x', webhookSecret: 'whsec_x', productId: '' } })),
    ).toThrow(/CREEM_PRODUCT_ID/);
  });

  it('fails when CREEM_PRICE_CENTS is missing, zero, negative or non-integer', () => {
    for (const bad of [0, -100, 29.5, NaN]) {
      expect(() =>
        validateConfig(creemOn({ creem: { enabled: true, apiKey: 'creem_test_x', webhookSecret: 'whsec_x', productId: 'prod_x', priceCents: bad } })),
      ).toThrow(/CREEM_PRICE_CENTS/);
    }
  });

  it('creem disabled with empty keys stays valid (opt-out deployments)', () => {
    expect(() => validateConfig(makeTestConfig({ creem: { enabled: false, apiKey: '', webhookSecret: '', productId: '', priceCents: 2900 } }))).not.toThrow();
  });
});

describe('validateConfig (production baseUrl)', () => {
  it('fails in production when BASE_URL is unset, naming BASE_URL', () => {
    expect(() => validateConfig(prodConfig({ baseUrl: '' }))).toThrow(/BASE_URL/);
  });

  it('fails in production when BASE_URL is not an absolute https URL, naming BASE_URL', () => {
    for (const bad of [
      'http://licita.example', // plain http / no scheme
      'licita.example', // no scheme
      '/licita', // relative
      'ftp://licita.example', // wrong scheme
      'not a url',
    ]) {
      expect(() => validateConfig(prodConfig({ baseUrl: bad })), bad).toThrow(/BASE_URL/);
    }
  });

  it('accepts a valid https BASE_URL in production and exposes it exactly on config.baseUrl', () => {
    const config = prodConfig({ baseUrl: 'https://licita.example' });
    expect(() => validateConfig(config)).not.toThrow();
    expect(config.baseUrl).toBe('https://licita.example');
  });

  it('does not require BASE_URL outside production (dev/test fall back safely)', () => {
    expect(() => validateConfig(makeTestConfig({ baseUrl: '' }))).not.toThrow();
  });
});

describe('loadConfig (baseUrl)', () => {
  const original = process.env.BASE_URL;
  const restore = () => {
    if (original === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = original;
  };

  it('defaults baseUrl to an empty string when BASE_URL is unset', async () => {
    restore();
    delete process.env.BASE_URL;
    const { loadConfig } = await import('../../src/config.js');
    expect(loadConfig().baseUrl).toBe('');
  });

  it('reads baseUrl from BASE_URL verbatim when set', async () => {
    process.env.BASE_URL = 'https://licita.example';
    const { loadConfig } = await import('../../src/config.js');
    expect(loadConfig().baseUrl).toBe('https://licita.example');
    restore();
  });
});

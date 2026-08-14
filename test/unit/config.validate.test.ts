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
    x402: { facilitatorUrl: VALID_FACILITATOR, payTo: VALID_PAY_TO, network: 'base' },
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
    expect(() => validateConfig(makeTestConfig({ paymentsMode: 'x402', x402: {} }))).not.toThrow();
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
        validateConfig(prodConfig({ x402: { facilitatorUrl: VALID_FACILITATOR, payTo: bad, network: 'base' } })),
      ).toThrow(/X402_PAY_TO/);
    }
  });

  it('accepts mixed-case hex X402_PAY_TO', () => {
    expect(() =>
      validateConfig(
        prodConfig({
          x402: { facilitatorUrl: VALID_FACILITATOR, payTo: '0xAaBbCcDdEeFf00112233445566778899aAbBcCdD', network: 'base' },
        }),
      ),
    ).not.toThrow();
  });

  it('rejects a non-https X402_FACILITATOR_URL', () => {
    for (const bad of ['http://facilitator.example.com', 'not-a-url', '']) {
      expect(() =>
        validateConfig(prodConfig({ x402: { facilitatorUrl: bad, payTo: VALID_PAY_TO, network: 'base' } })),
      ).toThrow(/X402_FACILITATOR_URL/);
    }
  });

  it('rejects placeholder secrets and lists ALL violations at once', () => {
    const config = makeTestConfig({
      nodeEnv: 'production',
      paymentsMode: 'dev',
      payHmacSecret: 'change-me-in-prod',
      operatorKey: 'change-me',
      x402: {},
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
    expect(message).toContain('PAY_HMAC_SECRET must not be a known placeholder');
    expect(message).toContain('OPERATOR_KEY must not be a known placeholder');
    expect(message).toContain('5 violation(s)');
  });
});

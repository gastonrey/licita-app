// CREEM_API_BASE_URL points checkout at the live or test Creem API.
// Unset or empty keeps https://api.creem.io. A trailing slash is stripped.
// The host must be api.creem.io or test-api.creem.io over https.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { validateConfig } from '../../src/config.validate.js';
import { makeTestConfig } from './testconfig.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { createCheckoutSession } from '../../src/pay/creem.js';

const saved = process.env.CREEM_API_BASE_URL;

afterEach(() => {
  if (saved === undefined) delete process.env.CREEM_API_BASE_URL;
  else process.env.CREEM_API_BASE_URL = saved;
  fetchMock.mockReset();
});

function creemOn(apiBaseUrl?: string) {
  return makeTestConfig({
    creem: {
      enabled: true,
      apiKey: 'creem_test_placeholder',
      webhookSecret: 'whsec_creem_placeholder',
      productId: 'prod_creem_placeholder',
      priceCents: 2900,
      ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
    },
  });
}

describe('CREEM_API_BASE_URL', () => {
  it('defaults to the live origin with no trailing slash', () => {
    delete process.env.CREEM_API_BASE_URL;
    expect(loadConfig().creem.apiBaseUrl).toBe('https://api.creem.io');
  });

  it('treats an empty value as the live origin', () => {
    process.env.CREEM_API_BASE_URL = '   ';
    expect(loadConfig().creem.apiBaseUrl).toBe('https://api.creem.io');
  });

  it('reads the test origin and strips a trailing slash', () => {
    process.env.CREEM_API_BASE_URL = 'https://test-api.creem.io/';
    expect(loadConfig().creem.apiBaseUrl).toBe('https://test-api.creem.io');
  });

  it('accepts the live and test origins', () => {
    expect(() => validateConfig(creemOn('https://api.creem.io'))).not.toThrow();
    expect(() => validateConfig(creemOn('https://test-api.creem.io/'))).not.toThrow();
    expect(() => validateConfig(creemOn())).not.toThrow();
  });

  it('rejects a non-https URL or any other host', () => {
    for (const bad of [
      'http://api.creem.io',
      'http://test-api.creem.io',
      'https://creem.io',
      'https://api.creem.io.evil.example',
      'https://evil.example',
      'not a url',
      'https://user:secret@api.creem.io',
      'https://api.creem.io/v1',
      'https://api.creem.io:8443',
    ]) {
      expect(() => validateConfig(creemOn(bad)), bad).toThrow(/CREEM_API_BASE_URL/);
    }
  });

  it('posts checkout to the configured origin', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ checkout_url: 'https://checkout.creem.io/c/pay/cs_test' }),
    });
    const url = await createCheckoutSession(creemOn('https://test-api.creem.io/'), {
      email: 'alice@example.com',
      successUrl: 'https://licita.example/?checkout=success',
      cancelUrl: 'https://licita.example/pricing',
    });
    expect(url).toBe('https://checkout.creem.io/c/pay/cs_test');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://test-api.creem.io/v1/checkouts');
  });

  it('keeps the live checkout URL when the base is omitted', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ checkout_url: 'https://checkout.creem.io/c/pay/cs_live' }),
    });
    await createCheckoutSession(creemOn(), {
      email: 'alice@example.com',
      successUrl: 'https://licita.example/?checkout=success',
      cancelUrl: 'https://licita.example/pricing',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.creem.io/v1/checkouts');
  });

  it('does not hardcode the Creem API origin inside the pay module', () => {
    const pay = readFileSync(new URL('../../src/pay/creem.ts', import.meta.url), 'utf8');
    expect(pay).not.toMatch(/https:\/\/(test-)?api\.creem\.io/);
  });
});

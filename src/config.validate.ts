// validateConfig(config) — fail-fast boot-time configuration enforcement.
// Called once from src/index.ts (NOT from loadConfig, so tests and tooling can
// construct partial configs freely). Throws a single Error listing EVERY
// violation so operators fix all missing/invalid vars in one boot cycle.

import type { AppConfig } from './config.js';

/** Known placeholder secrets that must never reach production. */
const PLACEHOLDER_SECRETS = new Set(['change-me', 'change-me-in-prod']);

/** Ethereum address: 0x + 40 hex chars (x402 payTo on Base). */
const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * x402 networks supported out of the box: Base Sepolia (testnet) and Base
 * (mainnet), in CAIP-2 form. Any other eip155:<chainId> value is accepted as
 * an explicit operator override.
 */
export const KNOWN_X402_NETWORKS = new Set(['eip155:84532', 'eip155:8453']);
const EIP155_CAIP2_RE = /^eip155:[0-9]+$/;

export function isValidX402Network(network: string | undefined): boolean {
  if (!network) return false;
  return KNOWN_X402_NETWORKS.has(network) || EIP155_CAIP2_RE.test(network);
}

function isHttpsUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Throws Error with all violations when the config is not bootable:
 * - PAYMENTS_MODE=dev requires PAY_HMAC_SECRET (dev token signing).
 * - OPERATOR_KEY is always required (protects GET /v1/stats).
 * - NODE_ENV=production additionally requires PAYMENTS_MODE=x402, a valid
 *   X402_PAY_TO address, an https X402_FACILITATOR_URL, a CAIP-2 X402_NETWORK
 *   (Base Sepolia / Base mainnet, or an explicit eip155:<chainId> override),
 *   and rejects any secret equal to a known placeholder.
 */
export function validateConfig(config: AppConfig): void {
  const violations: string[] = [];

  if (config.paymentsMode === 'dev' && config.payHmacSecret.length === 0) {
    violations.push(
      'PAY_HMAC_SECRET is required when PAYMENTS_MODE=dev (it signs dev payment tokens). Set it to a random string.',
    );
  }
  if (config.operatorKey.length === 0) {
    violations.push(
      'OPERATOR_KEY is required (header x-operator-key on GET /v1/stats). Set it to a random string.',
    );
  }

  const PRICE_RE = /^\d+(\.\d{1,2})?$/;
  if (!PRICE_RE.test(config.researchPriceUsd) || Number(config.researchPriceUsd) <= 0) {
    violations.push(
      'RESEARCH_PRICE_USD must be a positive decimal price string like "0.50" and may not be "0.00" — POST /v1/research is always paid.',
    );
  }

  if (config.nodeEnv === 'production') {
    if (config.paymentsMode !== 'x402') {
      violations.push(
        'PAYMENTS_MODE must be "x402" when NODE_ENV=production (the dev faucet and dev HMAC tokens are disabled in production).',
      );
    }
    if (!config.x402.payTo || !ETH_ADDRESS_RE.test(config.x402.payTo)) {
      violations.push(
        'X402_PAY_TO is required in production and must be an Ethereum address (0x followed by 40 hex characters).',
      );
    }
    if (!isHttpsUrl(config.x402.facilitatorUrl)) {
      violations.push('X402_FACILITATOR_URL is required in production and must be an https:// URL.');
    }
    if (!isValidX402Network(config.x402.network)) {
      violations.push(
        'X402_NETWORK is required in production and must be a CAIP-2 EVM network: "eip155:84532" (Base Sepolia) or "eip155:8453" (Base mainnet); other eip155:<chainId> values are accepted as explicit overrides.',
      );
    }
    if (PLACEHOLDER_SECRETS.has(config.payHmacSecret)) {
      violations.push('PAY_HMAC_SECRET must not be a known placeholder value ("change-me-in-prod").');
    }
    if (PLACEHOLDER_SECRETS.has(config.operatorKey)) {
      violations.push('OPERATOR_KEY must not be a known placeholder value ("change-me").');
    }
    // RESEND_API_KEY is optional (lead notification is best-effort). When
    // present in production it must look like a real Resend key.
    if (config.nodeEnv === 'production' && config.resendApiKey.length > 0 && !config.resendApiKey.startsWith('re_')) {
      violations.push('RESEND_API_KEY looks invalid: Resend API keys start with "re_". Leave it empty to disable lead notifications.');
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Invalid configuration — ${violations.length} violation(s):\n  - ${violations.join('\n  - ')}`,
    );
  }
}

// Config-driven endpoint price overrides (P0.8). One seam shared by the
// payment providers, the middleware and the dev faucet so a price comes from
// exactly one place: overrides → ENDPOINT_PRICES → "0.00".

import { ENDPOINT_PRICES } from '../domain/types.js';
import type { AppConfig } from '../config.js';

/**
 * The config-driven price override map (wins over ENDPOINT_PRICES). Research
 * is always paid: its price is config-owned (RESEARCH_PRICE_USD), NOT a
 * hardcoded ENDPOINT_PRICES entry, so operators set the amount per deploy.
 */
export function priceOverrides(config: AppConfig): Record<string, string> {
  return { 'POST /v1/research': config.researchPriceUsd };
}

/**
 * Resolve the USD price for an endpoint key: config override → fixed price
 * table → "0.00" (free).
 */
export function resolvePrice(
  overrides: Record<string, string> | undefined,
  endpoint: string,
): string {
  return overrides?.[endpoint] ?? ENDPOINT_PRICES[endpoint] ?? '0.00';
}
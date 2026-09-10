// Activation readiness (fiat-revenue-rails slice D): tri-state feature probes.
//
// Shared by the public /health smoke probe (D2) and the operator-only
// GET /v1/stats/readiness panel (D1). Every switch reports:
//   'disabled'    — flag off (the honest default; nothing is advertised).
//   'enabled-dry' — flag on but a required companion is missing/half-wired
//                   (secrets, recipients, base URL). Boot may still succeed
//                   outside production; the probe says "not actually live".
//   'enabled'     — flag on AND fully wired.
// Rules use env config state ONLY — never secret values — so /health can
// stay public and the probe never echoes secrets.

import type { AppConfig } from '../../config.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { envelope, type RouteCtx } from './common.js';

export type FeatureState = 'disabled' | 'enabled-dry' | 'enabled';

/** Creem: on + creem_/prod_/whsec_ keys + a positive PRICE_CENTS = live. */
export function creemState(config: AppConfig): FeatureState {
  if (!config.creem.enabled) return 'disabled';
  if (
    config.creem.apiKey.length === 0 ||
    config.creem.webhookSecret.length === 0 ||
    config.creem.productId.length === 0 ||
    !Number.isInteger(config.creem.priceCents) ||
    config.creem.priceCents <= 0
  ) {
    return 'enabled-dry';
  }
  return 'enabled';
}

/** Digest: on + sender/recipients + a Resend key + the schedule master gate. */
export function digestState(config: AppConfig): FeatureState {
  if (!config.digestEnabled) return 'disabled';
  if (
    config.digestFromEmail.length === 0 ||
    config.digestBcc.length === 0 ||
    config.resendApiKey.length === 0 ||
    !config.scheduledGenerationEvents
  ) {
    return 'enabled-dry';
  }
  return 'enabled';
}

/** Trial key seam: on + the signup email path (RESEND_API_KEY) + BASE_URL. */
export function trialState(config: AppConfig): FeatureState {
  if (!config.trialEnabled) return 'disabled';
  if (config.resendApiKey.length === 0 || config.baseUrl.length === 0) return 'enabled-dry';
  return 'enabled';
}

export interface FeatureStates {
  creem: FeatureState;
  digest: FeatureState;
  trial: FeatureState;
}

export function featureStates(config: AppConfig): FeatureStates {
  return {
    creem: creemState(config),
    digest: digestState(config),
    trial: trialState(config),
  };
}

/** The /health `features` block: tri-state switches + config-only facts. */
export interface HealthFeatures extends FeatureStates {
  scheduled_generation_events: boolean;
  base_url_set: boolean;
}

export function healthFeatures(config: AppConfig): HealthFeatures {
  return {
    ...featureStates(config),
    scheduled_generation_events: config.scheduledGenerationEvents,
    base_url_set: config.baseUrl.length > 0,
  };
}

/** GET /v1/stats/readiness (D1) — operator-only, read-only activation grant.
 *  Serves the tri-state switches plus migration status so the operator can
 *  see, in one place, exactly what blocks fiat revenue in production. */
export interface ReadinessReport {
  features: FeatureStates;
  scheduled_generation_events: boolean;
  base_url: { set: boolean; https: boolean };
  migrations: {
    all_applied: boolean;
    applied: string[];
    pending: string[];
    trial_api_keys: boolean;
    webhook_events: boolean;
  };
}

/** All additive migrations that must be applied for fiat revenue. Order is
 *  the apply order (001..010); 009/010 are the fiat-critical pair. */
export const REQUIRED_MIGRATIONS = [
  '001_core.sql',
  '002_payments_x402.sql',
  '003_identity.sql',
  '004_observability.sql',
  '005_sequence_grants.sql',
  '006_credits.sql',
  '007_demo_requests.sql',
  '008_demo_funnel.sql',
  '009_trial_api_keys.sql',
  '010_webhook_events.sql',
] as const;

export function buildReadinessReport(
  config: AppConfig,
  appliedMigrationNames: string[],
): ReadinessReport {
  const applied = new Set(appliedMigrationNames);
  const appliedList = REQUIRED_MIGRATIONS.filter((name) => applied.has(name));
  const pending = REQUIRED_MIGRATIONS.filter((name) => !applied.has(name));
  const https = (() => {
    try {
      return new URL(config.baseUrl).protocol === 'https:';
    } catch {
      return false;
    }
  })();
  return {
    features: featureStates(config),
    scheduled_generation_events: config.scheduledGenerationEvents,
    base_url: { set: config.baseUrl.length > 0, https },
    migrations: {
      all_applied: pending.length === 0,
      applied: appliedList,
      pending,
      trial_api_keys: applied.has('009_trial_api_keys.sql'),
      webhook_events: applied.has('010_webhook_events.sql'),
    },
  };
}

export function readinessHandler(ctx: RouteCtx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const rows = await ctx.db.query('SELECT name FROM schema_migrations');
    const name = (row: { name?: unknown }) => (typeof row.name === 'string' ? row.name : '');
    const report = buildReadinessReport(ctx.config, rows.rows.map(name).filter(Boolean));
    return reply.send(envelope(req, report));
  };
}
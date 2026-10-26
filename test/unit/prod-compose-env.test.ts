// Production compose must pass every env var loadConfig reads into the app
// container. `--env-file` only interpolates the compose file; a variable that
// is not listed under `app.environment` never reaches the process.
//
// PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE are the exception: this profile
// always sets DATABASE_URL and APP_DATABASE_URL, and src/db/client.ts uses
// those URLs first. Passing the PG* fallbacks would not change the connection.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const compose = readFileSync(new URL('../../docker-compose.prod.yml', import.meta.url), 'utf8');

function appEnvironmentBlock(src: string): string {
  const appAt = src.indexOf('\n  app:\n');
  expect(appAt).toBeGreaterThan(-1);
  const envAt = src.indexOf('\n    environment:\n', appAt);
  expect(envAt).toBeGreaterThan(-1);
  const lines = src.slice(envAt + 1).split('\n').slice(1);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^    \S/.test(line)) break;
    kept.push(line);
  }
  return kept.join('\n');
}

function envEntries(block: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of block.split('\n')) {
    const match = line.match(/^      ([A-Z][A-Z0-9_]*):\s*(.*)$/);
    if (match) entries.set(match[1], match[2].trim());
  }
  return entries;
}

const block = appEnvironmentBlock(compose);
const env = envEntries(block);

/** Vars loadConfig reads that this profile must forward, with the compose default. */
const FORWARDED: Record<string, string> = {
  LEAD_NOTIFY_EMAIL: '${LEAD_NOTIFY_EMAIL:-eutendersai@gmail.com}',
  RESEND_API_KEY: '${RESEND_API_KEY:-}',
  RESEND_FROM: '"${RESEND_FROM:-Relicita Operator <operator@licita.app>}"',
  DEMO_AUTOREPLY_ENABLED: '"${DEMO_AUTOREPLY_ENABLED:-true}"',
  DIGEST_ENABLED: '"${DIGEST_ENABLED:-false}"',
  DIGEST_CRON: '"${DIGEST_CRON:-0 9 * * 1}"',
  DIGEST_FROM_EMAIL: '${DIGEST_FROM_EMAIL:-}',
  DIGEST_BCC: '${DIGEST_BCC:-}',
  // Code default is true (src/config.ts). false would change /health and would
  // keep the digest disarmed even after DIGEST_ENABLED=true. The weekly mail
  // stays off because DIGEST_ENABLED defaults to false. Quoted so YAML does
  // not coerce the flag before it reaches the process.
  SCHEDULED_GENERATION_EVENTS: '"${SCHEDULED_GENERATION_EVENTS:-true}"',
  CREEM_API_BASE_URL: '"${CREEM_API_BASE_URL:-https://api.creem.io}"',
  CREEM_PRODUCT_ID_RADAR_MONTHLY: '${CREEM_PRODUCT_ID_RADAR_MONTHLY:-}',
  CREEM_PRODUCT_ID_RADAR_ANNUAL: '${CREEM_PRODUCT_ID_RADAR_ANNUAL:-}',
  CREEM_PRODUCT_ID_PRO_MONTHLY: '${CREEM_PRODUCT_ID_PRO_MONTHLY:-}',
  CREEM_PRODUCT_ID_PRO_ANNUAL: '${CREEM_PRODUCT_ID_PRO_ANNUAL:-}',
  CREEM_PRODUCT_ID_TEAM_MONTHLY: '${CREEM_PRODUCT_ID_TEAM_MONTHLY:-}',
  RESEARCH_PRICE_USD: '"${RESEARCH_PRICE_USD:-0.50}"',
  TRIAL_ENABLED: '"${TRIAL_ENABLED:-false}"',
};

describe('docker-compose.prod.yml app environment', () => {
  it('forwards every new config var with the code default', () => {
    for (const [key, value] of Object.entries(FORWARDED)) {
      expect(env.get(key), key).toBe(value);
    }
  });

  it('does not invent a RESEND_URL env var (the URL is a constant in notify.ts)', () => {
    expect(env.has('RESEND_URL')).toBe(false);
  });

  it('keeps the weekly digest off unless DIGEST_ENABLED is set', () => {
    expect(env.get('DIGEST_ENABLED')).toContain(':-false');
    expect(env.get('DIGEST_ENABLED')).not.toContain(':-true');
  });
});

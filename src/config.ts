export interface AppConfig {
  port: number;
  logLevel: string;
  /** value of NODE_ENV ('development' | 'production' | ...) */
  nodeEnv: string;
  databaseUrl?: string;
  /** optional low-privilege role URL for the app pool; falls back to databaseUrl */
  appDatabaseUrl?: string;
  pg: { host: string; port: number; user: string; password: string; database: string };
  paymentsMode: 'dev' | 'x402';
  payHmacSecret: string;
  /** POST /v1/research price (env RESEARCH_PRICE_USD). Always paid — validated
   *  as a positive decimal string, never "0.00". Flows into the payment
   *  providers as a config-driven price override (see src/pay/prices.ts). */
  researchPriceUsd: string;
  /**
   * x402 facilitator seam. facilitatorUrl and network have safe defaults
   * (Coinbase CDP facilitator, Base Sepolia testnet); payTo has NO default —
   * production boot fails without it (see config.validate.ts).
   * network is CAIP-2: 'eip155:84532' (Base Sepolia) or 'eip155:8453' (Base).
   */
  x402: {
    facilitatorUrl: string;
    payTo?: string;
    network: string;
    facilitatorRetries: number;
    rpcUrl?: string;
  };
  operatorKey: string;
  /** Fastify trustProxy setting: false (default), true, or a hop count */
  trustProxy: boolean | number;
  /** Operator inbox for lead-notification emails (env LEAD_NOTIFY_EMAIL). */
  notifyEmail: string;
  /** Resend HTTP API key (env RESEND_API_KEY). Empty disables lead notifications. */
  resendApiKey: string;
  /** Resend "from" header (env RESEND_FROM). Must be a verified Resend sender. */
  resendFrom: string;
  /** max distinct client keys tracked by the in-memory rate limiter */
  rateLimitMaxKeys: number;
  ingestMonths: number;
  ingestOnBoot: boolean;
  ingestCronHour: number;
  /** PLACSP ingestion (P0.3): disabled by default, opt-in via PLACSP_ENABLED. */
  placsp: { enabled: boolean; maxPages: number; delayMs: number; schedule: boolean };
}

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

/** TRUST_PROXY: 'true' → true, 'false'/empty → false, integer string → hop count. */
function parseTrustProxy(raw: string): boolean | number {
  const v = raw.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false' || v === '') return false;
  const n = Number(v);
  if (Number.isInteger(n) && n >= 0) return n;
  return false;
}

/**
 * Load raw config from env. Secrets have NO defaults — boot-time enforcement
 * lives in validateConfig (src/config.validate.ts), called from src/index.ts.
 */
export function loadConfig(): AppConfig {
  const mode = env('PAYMENTS_MODE', 'dev');
  return {
    port: parseInt(env('PORT', '3000'), 10),
    logLevel: env('LOG_LEVEL', 'info'),
    nodeEnv: env('NODE_ENV', 'development'),
    databaseUrl: env('DATABASE_URL') || undefined,
    appDatabaseUrl: env('APP_DATABASE_URL') || undefined,
    pg: {
      host: env('PGHOST', 'localhost'),
      port: parseInt(env('PGPORT', '5432'), 10),
      user: env('PGUSER', 'licita'),
      password: env('PGPASSWORD', 'licita'),
      database: env('PGDATABASE', 'licita'),
    },
    paymentsMode: mode === 'x402' ? 'x402' : 'dev',
    payHmacSecret: env('PAY_HMAC_SECRET'),
    researchPriceUsd: env('RESEARCH_PRICE_USD', '0.50'),
    x402: {
      facilitatorUrl: env('X402_FACILITATOR_URL', 'https://www.x402.org/facilitator'),
      payTo: env('X402_PAY_TO') || undefined,
      network: env('X402_NETWORK', 'eip155:84532'),
      /** Retries for transient facilitator/RPC failures (e.g. flaky public
       *  facilitator RPCs on mainnet). verify does not consume the nonce, so
       *  retrying it is safe; settle retries consult the on-chain nonce first
       *  to avoid double-settlement. 0 disables retries. */
      facilitatorRetries: parseInt(env('X402_FACILITATOR_RETRIES', '3'), 10),
      /** RPC used for the settle-retry nonce guard. Must be a stable public RPC
       *  for the configured network (NOT the flaky facilitator RPC). */
      rpcUrl: env('X402_RPC_URL'),
    },
    operatorKey: env('OPERATOR_KEY'),
    notifyEmail: env('LEAD_NOTIFY_EMAIL', 'eutendersai@gmail.com'),
    resendApiKey: env('RESEND_API_KEY'),
    resendFrom: env('RESEND_FROM', 'Licita Operator <operator@licita.app>'),
    trustProxy: parseTrustProxy(env('TRUST_PROXY', 'false')),
    rateLimitMaxKeys: parseInt(env('RATE_LIMIT_MAX_KEYS', '10000'), 10),
    ingestMonths: parseInt(env('INGEST_MONTHS', '24'), 10),
    ingestOnBoot: env('INGEST_ON_BOOT', 'false') === 'true',
    ingestCronHour: parseInt(env('INGEST_CRON_HOUR', '4'), 10),
    placsp: {
      enabled: env('PLACSP_ENABLED', 'false') === 'true',
      maxPages: parseInt(env('PLACSP_MAX_PAGES', '5'), 10),
      delayMs: parseInt(env('PLACSP_DELAY_MS', '500'), 10),
      schedule: env('PLACSP_SCHEDULE', 'false') === 'true',
    },
  };
}

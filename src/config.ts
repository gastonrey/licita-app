export interface AppConfig {
  port: number;
  logLevel: string;
  databaseUrl?: string;
  pg: { host: string; port: number; user: string; password: string; database: string };
  paymentsMode: 'dev' | 'x402';
  payHmacSecret: string;
  x402: { facilitatorUrl?: string; payTo?: string; network?: string };
  operatorKey: string;
  ingestMonths: number;
  ingestOnBoot: boolean;
  ingestCronHour: number;
}

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export function loadConfig(): AppConfig {
  const mode = env('PAYMENTS_MODE', 'dev');
  return {
    port: parseInt(env('PORT', '3000'), 10),
    logLevel: env('LOG_LEVEL', 'info'),
    databaseUrl: env('DATABASE_URL') || undefined,
    pg: {
      host: env('PGHOST', 'localhost'),
      port: parseInt(env('PGPORT', '5432'), 10),
      user: env('PGUSER', 'licita'),
      password: env('PGPASSWORD', 'licita'),
      database: env('PGDATABASE', 'licita'),
    },
    paymentsMode: mode === 'x402' ? 'x402' : 'dev',
    payHmacSecret: env('PAY_HMAC_SECRET', 'change-me-in-prod'),
    x402: {
      facilitatorUrl: env('X402_FACILITATOR_URL') || undefined,
      payTo: env('X402_PAY_TO') || undefined,
      network: env('X402_NETWORK') || undefined,
    },
    operatorKey: env('OPERATOR_KEY', 'change-me'),
    ingestMonths: parseInt(env('INGEST_MONTHS', '24'), 10),
    ingestOnBoot: env('INGEST_ON_BOOT', 'false') === 'true',
    ingestCronHour: parseInt(env('INGEST_CRON_HOUR', '4'), 10),
  };
}

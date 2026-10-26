// Manual run of the customer weekly radar.
// Uses the same environment as the server and sends real mail when
// RESEND_API_KEY is set. A second run in the same UTC week does not resend.
//
//   npm run radar:digest
//   node dist/src/obs/customer-radar-cli.js
//
// The weekly timer is the existing digest scheduler: DIGEST_ENABLED=true,
// SCHEDULED_GENERATION_EVENTS=true and DIGEST_CRON (default Monday 09:00 UTC).
// There is no separate cron. POST /v1/radar/digest with x-operator-key does
// the same job over HTTP.

import { loadConfig } from '../config.js';
import { createDb } from '../db/client.js';
import { createLogger } from './log.js';
import { sendCustomerRadarDigest } from './customer-radar.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config);
  const log = createLogger(config.logLevel);
  try {
    const result = await sendCustomerRadarDigest({
      db,
      log,
      resendApiKey: config.resendApiKey,
      from: config.digestFromEmail || config.resendFrom,
      baseUrl: config.baseUrl,
      operatorKey: config.operatorKey,
    });
    console.log(JSON.stringify({ level: 'info', msg: 'customer radar digest', ...result }));
    if (result.blocked) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (process.argv[1] && /customer-radar-cli\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'customer radar digest failed', error: String(err) }));
    process.exit(1);
  });
}

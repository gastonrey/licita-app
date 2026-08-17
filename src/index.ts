import { loadConfig } from './config.js';
import { validateConfig } from './config.validate.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildServer } from './api/server.js';
import { registerWeb } from './web/pages.js';
import { registerDashboard } from './web/dashboard.js';
import { mountMcp } from './mcp/server.js';
import { startScheduler } from './ingest/scheduler.js';

async function main(): Promise<void> {
  const config = loadConfig();
  validateConfig(config);

  // Idempotent migrations on boot (safe in dev; compose CMD also runs them).
  // DDL runs on the admin connection; the app pool may use APP_DATABASE_URL.
  const adminDb = createDb(config, { admin: true });
  await runMigrations(adminDb);
  await adminDb.end();

  const db = createDb(config);

  const app = await buildServer(config, db);
  registerWeb(app, config);
  registerDashboard(app, config);
  mountMcp(app, config, db);

  if (config.ingestOnBoot) {
    startScheduler(config, db);
  }

  const shutdown = async (signal: string) => {
    console.log(JSON.stringify({ level: 'info', msg: 'shutdown', signal }));
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(JSON.stringify({ level: 'info', msg: 'listening', port: config.port }));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'startup failed', error: String(err) }));
  process.exit(1);
});

// Dev helper: spin up an embedded PostgreSQL when no DATABASE_URL/PGHOST server exists.
// Usage: tsx scripts/dev-db.ts  (then use the printed DATABASE_URL)
import EmbeddedPostgres from 'embedded-postgres';

async function main(): Promise<void> {
  const pg = new EmbeddedPostgres({
    databaseDir: './.epg-data',
    user: 'licita',
    password: 'licita',
    port: 5433,
    persistent: true,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('licita');
  console.log('Embedded PostgreSQL running on port 5433');
  console.log('DATABASE_URL=postgres://licita:licita@localhost:5433/licita');
  console.log('Press Ctrl+C to stop.');
  process.on('SIGINT', async () => {
    await pg.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start embedded postgres:', err);
  console.error('Fallback: use `docker compose up db` instead.');
  process.exit(1);
});

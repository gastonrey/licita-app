import { readdirSync, readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createDb, type Db } from './client.js';

/**
 * Locate the migrations directory across layouts:
 * - source/tsx:   src/db/migrate.ts            -> <root>/migrations
 * - compiled old: dist/db/migrate.js           -> <root>/migrations
 * - compiled new: dist/src/db/migrate.js       -> <root>/migrations (via cwd)
 * Prefer cwd (container WORKDIR /app) so migrations ship next to package.json.
 */
function findMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', 'migrations'),
    join(here, '..', '..', '..', 'migrations'),
    join(process.cwd(), 'migrations'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

const MIGRATIONS_DIR = findMigrationsDir();

export async function runMigrations(db: Db): Promise<string[]> {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  );
  const applied = new Set(
    (await db.query('SELECT name FROM schema_migrations')).rows.map((r: { name: string }) => r.name),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      done.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return done;
}

// CLI entry: tsx src/db/migrate.ts  (or compiled: node dist/src/db/migrate.js)
if (process.argv[1] && /migrate\.(ts|js)$/.test(process.argv[1])) {
  const config = loadConfig();
  // Migrations are DDL: always run on the admin connection, never the
  // low-privilege APP_DATABASE_URL role.
  const db = createDb(config, { admin: true });
  runMigrations(db)
    .then((done) => {
      console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', files: done }));
      return db.end();
    })
    .catch(async (err) => {
      console.error(JSON.stringify({ level: 'error', msg: 'migration failed', error: String(err) }));
      await db.end();
      process.exit(1);
    });
}

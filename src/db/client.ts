import pg from 'pg';
import type { AppConfig } from '../config.js';

const { Pool } = pg;

export type Db = pg.Pool;

export interface CreateDbOptions {
  /**
   * Use the admin connection (DATABASE_URL / PG* parts) even when
   * APP_DATABASE_URL is set. Migrations and DDL must run as the admin role;
   * the low-privilege licita_app role has no DDL rights.
   */
  admin?: boolean;
}

/**
 * App pool. Uses APP_DATABASE_URL (low-privilege role) when set, falling back
 * to DATABASE_URL / PG* parts. Pass { admin: true } for migrations.
 */
export function createDb(config: AppConfig, opts: CreateDbOptions = {}): Db {
  const connectionString = opts.admin
    ? config.databaseUrl
    : (config.appDatabaseUrl ?? config.databaseUrl);
  const pool = new Pool(connectionString ? { connectionString, max: 10 } : { ...config.pg, max: 10 });
  pool.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', error: String(err) }));
  });
  return pool;
}

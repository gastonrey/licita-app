import pg from 'pg';
import type { AppConfig } from '../config.js';

const { Pool } = pg;

export type Db = pg.Pool;

export function createDb(config: AppConfig): Db {
  const pool = new Pool(
    config.databaseUrl
      ? { connectionString: config.databaseUrl, max: 10 }
      : { ...config.pg, max: 10 },
  );
  pool.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', error: String(err) }));
  });
  return pool;
}

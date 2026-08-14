// npm run backfill-identity — registers company_identifiers/aliases for rows
// ingested before migrations/003_identity.sql and fills buyers.nif from
// PLACSP 'nif:<NIF>' source_refs. Idempotent: safe to re-run; duplicate NIFs
// are logged as identity_conflict, never merged.

import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { backfillIdentity } from '../src/ingest/identity.js';

const config = loadConfig();
const db = createDb(config, { admin: true });

backfillIdentity(db)
  .then((counts) => {
    console.log(JSON.stringify({ level: 'info', msg: 'identity backfill done', ...counts }));
    return db.end();
  })
  .catch(async (err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'identity backfill failed', error: String(err) }));
    await db.end();
    process.exit(1);
  });

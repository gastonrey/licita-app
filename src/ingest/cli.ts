// Ingest CLI (SPEC §8): `npm run ingest -- --once`
// Runs one full TED harvest (window = INGEST_MONTHS) + recomputeSignals and
// prints a JSON summary: {notices_seen, upserted, companies, buyers, errors}.

import { loadConfig, type AppConfig } from '../config.js';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { recomputeSignals } from '../forecast/signals.js';
import { ensureSource, persistNotice } from './normalize.js';
import { harvestTedAwards } from './ted.js';

export interface IngestSummary {
  notices_seen: number;
  upserted: number; // award rows written (insert or update)
  companies: number;
  buyers: number;
  tenders: number;
  contracts: number;
  signals: number;
  skipped: number; // notices without publication-number or buyer name
  errors: number;
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

export interface RunIngestOptions {
  maxNotices?: number; // smoke/test cap
}

export async function runIngestOnce(
  config: AppConfig,
  db: Db,
  opts: RunIngestOptions = {},
): Promise<IngestSummary> {
  const summary: IngestSummary = {
    notices_seen: 0,
    upserted: 0,
    companies: 0,
    buyers: 0,
    tenders: 0,
    contracts: 0,
    signals: 0,
    skipped: 0,
    errors: 0,
  };

  await runMigrations(db);
  const sourceId = await ensureSource(db, 'ted');

  const harvest = harvestTedAwards({
    months: config.ingestMonths,
    maxNotices: opts.maxNotices,
  });
  // A failing notice must not abort the harvest (resumable: re-run is idempotent).
  let iterResult = await harvest.next();
  while (!iterResult.done) {
    const notice = iterResult.value;
    summary.notices_seen += 1;
    try {
      const counts = await persistNotice(db, sourceId, notice);
      summary.buyers += counts.buyers;
      summary.companies += counts.companies;
      summary.tenders += counts.tenders;
      summary.upserted += counts.awards;
      summary.contracts += counts.contracts;
      if (counts.tenders === 0) summary.skipped += 1;
    } catch (err) {
      summary.errors += 1;
      log({
        level: 'error',
        msg: 'notice persist failed',
        source_ref: (notice as Record<string, unknown>)['publication-number'] ?? null,
        error: String(err),
      });
    }
    iterResult = await harvest.next();
  }

  const signals = await recomputeSignals(db);
  summary.signals = signals.total;
  log({ level: 'info', msg: 'signal recompute', ...signals.byType });
  return summary;
}

/** CLI entry. Returns process exit code. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const once = argv.includes('--once');
  const maxIdx = argv.indexOf('--max-notices');
  const maxNotices = maxIdx >= 0 ? Number(argv[maxIdx + 1]) : undefined;
  if (!once) {
    log({
      level: 'info',
      msg: 'running single ingest (continuous scheduling lives in startScheduler; use --once to be explicit)',
    });
  }
  const config = loadConfig();
  const db = createDb(config);
  try {
    const summary = await runIngestOnce(config, db, {
      maxNotices: maxNotices !== undefined && Number.isFinite(maxNotices) ? maxNotices : undefined,
    });
    console.log(JSON.stringify({ level: 'info', msg: 'ingest summary', ...summary }));
    return summary.errors > 0 ? 1 : 0;
  } catch (err) {
    console.error(JSON.stringify({ level: 'fatal', msg: 'ingest failed', error: String(err) }));
    return 1;
  } finally {
    await db.end();
  }
}

// Direct execution: tsx src/ingest/cli.ts [--once] [--max-notices N]
const invokedAsScript =
  typeof process.argv[1] === 'string' && /ingest[\\/]cli\.(ts|js)$/.test(process.argv[1]);
if (invokedAsScript) {
  main().then((code) => process.exit(code));
}

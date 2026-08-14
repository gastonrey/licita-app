// Ingest CLI (SPEC §8): `npm run ingest -- --once [--source ted|placsp|all]`
// Runs one full harvest per selected source (window = INGEST_MONTHS) +
// recomputeSignals and prints a JSON summary:
// {notices_seen, upserted, companies, buyers, errors}.
// Default source is TED (current behavior); PLACSP additionally requires
// PLACSP_ENABLED=true. The daily scheduler adds PLACSP only when
// PLACSP_SCHEDULE=true (and PLACSP_ENABLED=true).

import { loadConfig, type AppConfig } from '../config.js';
import { createDb, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { recomputeSignals } from '../forecast/signals.js';
import { ensureSource, persistNotice } from './normalize.js';
import { ensurePlacspSource, persistPlacspDoc } from './normalize-placsp.js';
import { harvestPlacsp } from './placsp.js';
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

export type IngestSource = 'ted' | 'placsp' | 'all';

export interface RunIngestOptions {
  maxNotices?: number; // smoke/test cap (applies per source)
  source?: IngestSource; // default: ted (+ placsp on scheduler when PLACSP_SCHEDULE)
  /** Test seam: injected into the PLACSP harvester. */
  fetchFn?: typeof fetch;
}

/**
 * Which sources a run covers. Explicit `source` wins; otherwise TED only,
 * plus PLACSP on the scheduler path when PLACSP_SCHEDULE && PLACSP_ENABLED.
 */
export function resolveSources(
  config: AppConfig,
  source: IngestSource | undefined,
): Array<'ted' | 'placsp'> {
  const out: Array<'ted' | 'placsp'> =
    source === 'all' ? ['ted', 'placsp'] : source === 'placsp' ? ['placsp'] : ['ted'];
  if (source === undefined && config.placsp.schedule && config.placsp.enabled) out.push('placsp');
  return out;
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

  for (const source of resolveSources(config, opts.source)) {
    if (source === 'placsp' && !config.placsp.enabled) {
      log({
        level: 'warn',
        msg: 'placsp source skipped: PLACSP_ENABLED is not true',
      });
      continue;
    }
    if (source === 'ted') await runTedIngest(config, db, summary, opts);
    else await runPlacspIngest(config, db, summary, opts);
  }

  const signals = await recomputeSignals(db);
  summary.signals = signals.total;
  log({ level: 'info', msg: 'signal recompute', ...signals.byType });
  return summary;
}

async function runTedIngest(
  config: AppConfig,
  db: Db,
  summary: IngestSummary,
  opts: RunIngestOptions,
): Promise<void> {
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
}

async function runPlacspIngest(
  config: AppConfig,
  db: Db,
  summary: IngestSummary,
  opts: RunIngestOptions,
): Promise<void> {
  const sourceId = await ensurePlacspSource(db);
  const harvest = harvestPlacsp({
    months: config.ingestMonths,
    maxPages: config.placsp.maxPages,
    maxDocs: opts.maxNotices,
    requestDelayMs: config.placsp.delayMs,
    fetchFn: opts.fetchFn,
  });
  let iterResult = await harvest.next();
  while (!iterResult.done) {
    const entry = iterResult.value;
    summary.notices_seen += 1;
    try {
      const counts = await persistPlacspDoc(db, sourceId, entry);
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
        msg: 'placsp doc persist failed',
        source_ref: entry.entryId,
        error: String(err),
      });
    }
    iterResult = await harvest.next();
  }
}

/** CLI entry. Returns process exit code. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const once = argv.includes('--once');
  const maxIdx = argv.indexOf('--max-notices');
  const maxNotices = maxIdx >= 0 ? Number(argv[maxIdx + 1]) : undefined;
  const srcIdx = argv.indexOf('--source');
  const sourceRaw = srcIdx >= 0 ? argv[srcIdx + 1] : undefined;
  if (sourceRaw !== undefined && !['ted', 'placsp', 'all'].includes(sourceRaw)) {
    console.error(
      JSON.stringify({ level: 'fatal', msg: `invalid --source '${sourceRaw}' (ted|placsp|all)` }),
    );
    return 1;
  }
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
      source: sourceRaw as RunIngestOptions['source'],
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

// Direct execution: tsx src/ingest/cli.ts [--once] [--source ted|placsp|all] [--max-notices N]
const invokedAsScript =
  typeof process.argv[1] === 'string' && /ingest[\\/]cli\.(ts|js)$/.test(process.argv[1]);
if (invokedAsScript) {
  main().then((code) => process.exit(code));
}

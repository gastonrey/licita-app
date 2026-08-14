// Thin wrapper around the ingest CLI: one full harvest + signal recompute.
// Usage: tsx scripts/ingest-once.ts [--max-notices N]
import { main } from '../src/ingest/cli.js';

const code = await main(['--once', ...process.argv.slice(2)]);
process.exit(code);

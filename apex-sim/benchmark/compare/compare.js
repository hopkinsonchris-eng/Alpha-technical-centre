#!/usr/bin/env node
// ===========================================================================
// apex-sim · benchmark/compare — comparison harness
// ---------------------------------------------------------------------------
// Heir to the prototype's physics_harness.js. Loads an apex-sim summary and a
// reference summary, aligns them on a common time grid, and reports per-vector
// error metrics (relative L2 + peak). Optionally emits plot data.
// ===========================================================================
import { metrics } from './metrics.js';

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) a[t.slice(2)] = argv[i + 1]?.startsWith('--') || i + 1 >= argv.length ? true : argv[++i];
  }
  return a;
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.deck) { console.error('usage: compare.js --deck <name> [--sim f.json] [--ref f.json]'); return 1; }
  // TODO: load apex-sim + reference summaries, resample, compute metrics.
  console.log(`[compare] deck=${args.deck} (scaffold)`);
  void metrics;
  return 0;
}

process.exit(main(process.argv));

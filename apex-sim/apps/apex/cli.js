#!/usr/bin/env node
// ===========================================================================
// apex-sim · apps/apex — command-line entry point
// ---------------------------------------------------------------------------
// Usage:
//   apex run <deck.DATA> [--method fully-implicit] [--out dir]
//   apex --help
// ===========================================================================
import { parseDeck } from '../../src/io/deckparser.js';
import { run } from '../../src/driver/driver.js';
import { makeConfig } from '../../src/core/config.js';
import { log } from '../../src/core/logging.js';
import { readFileSync } from 'node:fs';

const HELP = `apex-sim — black-oil reservoir simulator

Usage:
  apex run <deck.DATA> [options]

Options:
  --method <m>     impes | sequential | fully-implicit (default)
  --solver <s>     gmres | bicgstab
  --out <dir>      output directory for summary/restart
  -h, --help       show this help
`;

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    return 0;
  }
  const [cmd, deckPath] = args;
  if (cmd !== 'run' || !deckPath) { console.error(HELP); return 1; }

  log.info('apex', `parsing deck ${deckPath}`);
  const deck = parseDeck(readFileSync(deckPath, 'utf8'));
  const config = makeConfig(); // TODO: derive from flags + deck RUNSPEC
  const model = { deck }; // TODO: build grid/rock/pvt/scal/init from deck
  log.info('apex', 'starting run (scaffold — not yet implemented)');
  run(model, config);
  return 0;
}

process.exit(main(process.argv));

#!/usr/bin/env node
// ===========================================================================
// apex-sim · test runner
// ---------------------------------------------------------------------------
// Minimal zero-dependency runner. Discovers *.test.js under test/ and runs
// their exported run() (Node's built-in `node:test` can replace this later).
// ===========================================================================
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function findTests(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...findTests(p));
    else if (e.endsWith('.test.js')) out.push(p);
  }
  return out;
}

let pass = 0, fail = 0, skip = 0;
for (const file of findTests(here)) {
  const mod = await import(pathToFileURL(file));
  if (typeof mod.run !== 'function') { skip++; continue; }
  try { await mod.run(); pass++; console.log(`PASS ${file}`); }
  catch (err) { fail++; console.error(`FAIL ${file}: ${err.message}`); }
}
console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped (stubs)`);
process.exit(fail ? 1 : 0);

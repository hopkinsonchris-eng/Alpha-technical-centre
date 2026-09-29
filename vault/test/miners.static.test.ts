/** Acceptance 4: no miner fetches from the SPE library (OnePetro). Scans the sources themselves. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const files = [...readdirSync(path.join(SRC, 'miners')).filter(f => f.endsWith('.ts')).map(f => path.join(SRC, 'miners', f)), path.join(SRC, 'jobs/miners.ts')];

test('static: the miner sources exist and none mentions the OnePetro host', () => {
  assert.ok(files.length >= 13, `expected the adapters, orchestrator and helpers, found ${files.length} files`);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/onepetro\.org/i.test(src), `${path.relative(SRC, f)} must not reference onepetro.org`);
  }
});

test('static: every adapter goes through the shared Http client, which refuses blocked hosts, rather than calling fetch directly', () => {
  for (const id of ['semantic-scholar', 'crossref', 'openalex', 'anh-co', 'anp-br', 'ar-energia', 'perupetro', 'sec-edgar', 'eia']) {
    const src = readFileSync(path.join(SRC, 'miners', `${id}.ts`), 'utf8');
    assert.match(src, /new Http\(/, `${id} builds an Http client`);
    assert.ok(!/[^.\w]fetch\(\s*[`'"]/.test(src.replace(/async \*fetch\(/g, '')), `${id} must not call fetch on a literal URL`);
  }
});

test('static: no adapter downloads PDFs', () => {
  for (const f of files) assert.ok(!/openAccessPdf|\.pdf['"`]/i.test(readFileSync(f, 'utf8')), `${path.basename(f)} must not fetch PDFs`);
});

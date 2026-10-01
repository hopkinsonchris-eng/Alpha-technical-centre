#!/usr/bin/env node
// Static fallback for GET /api/catalog: writes hub/catalog.json from tools/*/tool.json.
// Plain Node, no dependencies. Schema validation is the vault's job (npm test in
// vault/ builds the same catalog with Ajv); this script only aggregates.
//   node scripts/build-catalog.mjs [outFile]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'hub', 'catalog.json'));

function parseChangelog(md) {
  const releases = []; let rel, section, last;
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const h2 = /^##\s+\[?([^\]\s]+)\]?(?:\s*[-–—]\s*(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (h2 && !line.startsWith('###')) {
      rel = { version: /^unreleased$/i.test(h2[1]) ? 'Unreleased' : h2[1], date: h2[2] ?? '', sections: {} };
      releases.push(rel); section = last = undefined; continue;
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3 && rel) { section = h3[1].charAt(0).toUpperCase() + h3[1].slice(1).toLowerCase(); rel.sections[section] ??= []; last = undefined; continue; }
    if (!rel || !section) continue;
    const b = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (b) { last = rel.sections[section]; last.push(b[1].trim()); }
    else if (line.trim() && last && /^\s+\S/.test(line)) last[last.length - 1] += ' ' + line.trim();
    else if (!line.trim()) last = undefined;
  }
  return releases;
}

const toolsDir = path.join(root, 'tools');
const tools = [];
for (const d of readdirSync(toolsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
  const f = path.join(toolsDir, d, 'tool.json');
  if (!existsSync(f)) continue;
  let m;
  try { m = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.error(`tools/${d}/tool.json: ${e.message}`); process.exit(1); }
  const cf = m.changelog && path.join(root, m.changelog);
  // Wave 2: the Hub sidecar (tools/<id>/hub.json) rides along as `hub`; the Vault validates it, this script only aggregates.
  const hf = path.join(toolsDir, d, 'hub.json');
  let hub = null;
  if (existsSync(hf)) {
    try { hub = { ...JSON.parse(readFileSync(hf, 'utf8')), live_version: null }; } catch (e) { console.error(`tools/${d}/hub.json: ${e.message}`); process.exit(1); }
  }
  tools.push({ ...m, releases: cf && existsSync(cf) ? parseChangelog(readFileSync(cf, 'utf8')) : [], hub });
}
let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ tools, built_at: new Date().toISOString(), commit }, null, 2) + '\n');
console.log(`wrote ${path.relative(root, out)} (${tools.length} tools)`);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, resolve, parseChangelog, type Catalog } from '../src/catalog.ts';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const FIX = path.join(HERE, 'fixtures/tool-manifest');
const read = (p: string) => readFileSync(p, 'utf8');

/** A throwaway repo root holding the given manifests as tools/<dir>/tool.json. */
function rootWith(manifests: { dir?: string; json: unknown }[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'catalog-'));
  for (const m of manifests) {
    const dir = m.dir ?? (m.json as any).id;
    mkdirSync(path.join(root, 'tools', dir), { recursive: true });
    writeFileSync(path.join(root, 'tools', dir, 'tool.json'), JSON.stringify(m.json, null, 2));
  }
  return root;
}
const fixture = (n: string) => JSON.parse(read(path.join(FIX, `${n}.json`)));
const stripVolatile = (c: Catalog) => ({ ...c, built_at: undefined, commit: undefined });

// AC1 ---------------------------------------------------------------------
test('AC1: three valid manifests build and resolve', () => {
  const root = rootWith([1, 2, 3].map(i => ({ json: fixture(`valid-${i}`) })));
  const cat = buildCatalog(root);
  assert.deepEqual(cat.tools.map(t => t.id), ['apex-asset-intelligence', 'opportunity-register', 'situation-room']);
  assert.match(cat.built_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(resolve(cat, 'opportunity-register'), { entry: 'opportunity-register.html', modules: ['js/potential.js', 'js/analogues.js'], version: '2.1.0', commit: 'd8a4835' });
  assert.deepEqual(resolve(cat, 'apex-asset-intelligence'), { entry: 'https://apex-app2.onrender.com', modules: [], version: '4.0.0', commit: '0000000' });
  assert.equal(resolve(cat, 'situation-room').version, '0.9.0');
  rmSync(root, { recursive: true });
});

for (const [n, where] of [[1, '/aliases'], [2, '/id'], [3, '/versions/0/version']] as const) {
  test(`AC1: invalid-${n} throws naming the file and the JSON path ${where}`, () => {
    const json = fixture(`invalid-${n}`);
    const root = rootWith([{ json }]);
    assert.throws(() => buildCatalog(root), (e: Error) => {
      assert.ok(e.message.includes(`tools/${json.id}/tool.json`), e.message);
      assert.ok(e.message.includes(where), e.message);
      return true;
    });
    rmSync(root, { recursive: true });
  });
}

test('AC1: unparseable JSON, id/dir mismatch and dangling alias are also refused with file and path', () => {
  const root = rootWith([]);
  mkdirSync(path.join(root, 'tools/broken'), { recursive: true });
  writeFileSync(path.join(root, 'tools/broken/tool.json'), '{ nope');
  assert.throws(() => buildCatalog(root), /tools\/broken\/tool\.json: invalid JSON/);
  rmSync(root, { recursive: true });

  const mismatch = rootWith([{ dir: 'other', json: fixture('valid-3') }]);
  assert.throws(() => buildCatalog(mismatch), /tools\/other\/tool\.json.*\/id/);
  rmSync(mismatch, { recursive: true });

  const dangling = fixture('valid-3'); dangling.aliases.current = '9.9.9';
  const r3 = rootWith([{ json: dangling }]);
  assert.throws(() => buildCatalog(r3), /tools\/situation-room\/tool\.json.*\/aliases\/current/);
  rmSync(r3, { recursive: true });
});

// AC2 ---------------------------------------------------------------------
test('AC2: changing aliases.current changes resolve() output and nothing else', () => {
  const a = fixture('valid-1');
  const b = structuredClone(a); b.aliases = { current: '2.0.0', previous: '2.1.0' };
  const ra = rootWith([{ json: a }]); const rb = rootWith([{ json: b }]);
  const ca = buildCatalog(ra), cb = buildCatalog(rb);
  assert.notDeepEqual(resolve(ca, a.id), resolve(cb, a.id));
  assert.deepEqual(resolve(cb, a.id), { entry: 'opportunity-register.html', modules: [], version: '2.0.0', commit: '3f68b41' });
  // Everything except the alias block is identical.
  const strip = (c: Catalog) => ({ ...stripVolatile(c), tools: c.tools.map(t => ({ ...t, aliases: undefined })) });
  assert.deepEqual(strip(ca), strip(cb));
  rmSync(ra, { recursive: true }); rmSync(rb, { recursive: true });
});

test('AC2: a deprecated tool whose aliases.current names another tool resolves to that tool', () => {
  const old = { ...fixture('valid-3'), id: 'old-room', lifecycle: 'deprecated', aliases: { current: 'apex-asset-intelligence' } };
  const root = rootWith([{ json: old }, { json: fixture('valid-2') }]);
  const cat = buildCatalog(root);
  assert.deepEqual(resolve(cat, 'old-room'), resolve(cat, 'apex-asset-intelligence'));
  // Only deprecated tools may redirect.
  const bad = { ...old, lifecycle: 'production' };
  const r2 = rootWith([{ json: bad }, { json: fixture('valid-2') }]);
  assert.throws(() => buildCatalog(r2), /\/aliases\/current/);
  assert.throws(() => resolve(cat, 'nope'), (e: any) => e.status === 404);
  rmSync(root, { recursive: true }); rmSync(r2, { recursive: true });
});

// AC3 ---------------------------------------------------------------------
test('AC3: parseChangelog reads Unreleased and all six section names, newest first', () => {
  const md = `# Changelog

## [Unreleased]
### Added
- Upcoming thing

## [2.0.0] - 2026-09-01
### Added
- New chart
- Second line item
  that wraps
### Changed
- Recalculated NPV
### Deprecated
- Old export
### Removed
- Legacy tab
### Fixed
- Off-by-one in payback
### Security
- Escaped user text

## [1.0.0] - 2026-01-01
### Added
- First release
`;
  const r = parseChangelog(md);
  assert.deepEqual(r.map(x => [x.version, x.date]), [['Unreleased', ''], ['2.0.0', '2026-09-01'], ['1.0.0', '2026-01-01']]);
  assert.deepEqual(r[0].sections, { Added: ['Upcoming thing'] });
  assert.deepEqual(Object.keys(r[1].sections), ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']);
  assert.deepEqual(r[1].sections.Added, ['New chart', 'Second line item that wraps']);
  assert.deepEqual(r[1].sections.Security, ['Escaped user text']);
  assert.deepEqual(r[2].sections, { Added: ['First release'] });
  assert.deepEqual(parseChangelog(''), []);
});

test('AC3: every shipped CHANGELOG parses, starts with Unreleased, is newest first and ends at the current version', () => {
  const cat = buildCatalog(REPO);
  for (const t of cat.tools) {
    assert.ok(t.releases.length >= 2, `${t.id}: changelog missing`);
    assert.equal(t.releases[0].version, 'Unreleased', t.id);
    const versions = t.releases.slice(1).map(r => r.version);
    assert.deepEqual(versions, t.versions.map(v => v.version), `${t.id}: changelog and manifest versions differ`);
    assert.equal(versions[0], t.aliases.current, t.id);
    for (const r of t.releases.slice(1)) assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

// AC4 ---------------------------------------------------------------------
/** Launch links (the buttons that open a tool) on admin.html and tools.html. */
function toolLinks(page: string): string[] {
  const html = read(path.join(REPO, page));
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>/g)) {
    const attrs = m[1];
    if (!/class="[^"]*\b(btn-primary|btn-save)\b/.test(attrs)) continue;
    const href = /href="([^"]+)"/.exec(attrs)?.[1];
    if (href && !href.startsWith('mailto:')) out.push(href);
  }
  return out;
}
/** A page that only wraps a tool in an iframe (nodal-analysis.html) counts as its tool. */
function embeddedTargets(href: string): string[] {
  if (/^https?:/.test(href)) return [];
  const f = path.join(REPO, href);
  if (!existsSync(f)) return [];
  return [...read(f).matchAll(/<iframe\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
}

test('AC4: every tool linked from admin.html and tools.html has a manifest', () => {
  const cat = buildCatalog(REPO);
  const entries = new Set(cat.tools.map(t => t.entry.replace(/\/$/, '')));
  const links = [...toolLinks('admin.html'), ...toolLinks('tools.html')];
  assert.ok(links.length >= 8, `expected to find the tool links, found ${links.join(', ')}`);
  for (const href of links) {
    const norm = href.replace(/\/$/, '');
    const ok = entries.has(norm) || embeddedTargets(href).some(e => entries.has(e));
    assert.ok(ok, `${href} is linked as a tool but no tools/*/tool.json has it as its entry`);
  }
});

test('AC4: the shipped manifests are the eleven expected tools and their local entries exist', () => {
  const cat = buildCatalog(REPO);
  assert.deepEqual(cat.tools.map(t => t.id).sort(), ['apex-3d-model', 'apex-asset-intelligence', 'apex-reservoir-3d', 'ela-model-suite', 'ela-studio', 'financial-model', 'insight-radar', 'nodal-analysis', 'opportunity-register', 'plan-your-job', 'situation-room']);
  for (const t of cat.tools) {
    if (t.kind !== 'external-app') assert.ok(existsSync(path.join(REPO, t.entry)), `${t.id}: entry ${t.entry} missing`);
    for (const m of t.versions.flatMap(v => v.modules ?? [])) assert.ok(existsSync(path.join(REPO, m)), `${t.id}: module ${m} missing`);
    assert.equal(t.owner, 'chris');
    resolve(cat, t.id);
  }
  assert.equal(resolve(cat, 'apex-reservoir-3d').version, '2.2.0');
  assert.equal(resolve(cat, 'situation-room').version, '0.9.0');
  const reg = cat.tools.find(t => t.id === 'opportunity-register')!;
  assert.equal(reg.versions.find(v => v.version === '2.0.0')?.breaking, true);
});

// AC5 ---------------------------------------------------------------------
test('AC5: the Register imports its calculator at ?v=<current version from tool.json>', () => {
  const cat = buildCatalog(REPO);
  const r = resolve(cat, 'opportunity-register');
  const html = read(path.join(REPO, 'opportunity-register.html'));
  const imports = [...html.matchAll(/import\('\.\/([^'?]+)\?v=([^']+)'\)/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(imports.map(i => i[0]).sort(), [...r.modules].sort());
  for (const [, v] of imports) assert.equal(v, r.version);
  assert.doesNotMatch(html, /\?v=\d+'\)/, 'a bare integer token is left behind');
});

// Static fallback -----------------------------------------------------------
test('hub/catalog.json (static fallback) matches the catalog the API serves', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'catalog-out-'));
  const out = path.join(tmp, 'catalog.json');
  execFileSync('node', [path.join(REPO, 'scripts/build-catalog.mjs'), out], { stdio: 'pipe' });
  const built = JSON.parse(read(out));
  const live = JSON.parse(JSON.stringify(buildCatalog(REPO)));
  assert.deepEqual(built.tools, live.tools);
  const committed = path.join(REPO, 'hub/catalog.json');
  if (existsSync(committed)) assert.deepEqual(JSON.parse(read(committed)).tools, live.tools, 'hub/catalog.json is stale: run node scripts/build-catalog.mjs');
  rmSync(tmp, { recursive: true });
});

// Routes --------------------------------------------------------------------
test('GET /api/catalog and /api/tools/:id/resolve; unknown id is 404', async () => {
  const db = await openDb(undefined); await migrate(db);
  const app = await createApp({ db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' } });
  const c = await app.request('/api/catalog');
  assert.equal(c.status, 200);
  const cat = await c.json();
  assert.equal(cat.tools.length, 11);
  const r = await app.request('/api/tools/opportunity-register/resolve');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), resolve(buildCatalog(REPO), 'opportunity-register'));
  const nf = await app.request('/api/tools/does-not-exist/resolve');
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).error.code, 'not_found');
  await db.close();
});

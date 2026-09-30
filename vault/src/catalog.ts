/**
 * Tool registry and catalog (M03). Every tool carries a tool.json beside it
 * (docs/vault-hub/schemas/tool-manifest.schema.json). buildCatalog validates
 * them all and parses each CHANGELOG.md; resolve() turns an id into the only
 * thing any link may use: the entry, the modules and the version of the
 * `current` alias.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { validate } from './schemas.ts';

export interface ToolVersion {
  version: string; released_at: string; commit: string;
  status?: 'draft' | 'reviewed' | 'approved' | 'deprecated';
  modules?: string[]; breaking?: boolean; notes?: string;
}
export interface ToolManifest {
  id: string; name: string; description?: string; owner: string;
  lifecycle: 'experimental' | 'production' | 'deprecated' | 'retired';
  kind: 'browser-tool' | 'external-app' | 'pipeline' | 'skill';
  entry: string; docs?: string; changelog?: string;
  produces?: string[]; consumes?: string[];
  versions: ToolVersion[];
  aliases: { current: string; previous?: string; beta?: string; [alias: string]: string | undefined };
}
export interface ChangelogRelease { version: string; date: string; sections: Record<string, string[]> }
export type CatalogTool = ToolManifest & { releases: ChangelogRelease[] };
export type Catalog = { tools: CatalogTool[]; built_at: string; commit: string };
export interface Resolved { entry: string; modules: string[]; version: string; commit: string }

const rel = (root: string, f: string) => path.relative(root, f).split(path.sep).join('/');

function gitCommit(rootDir: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 'unknown';
  } catch { return process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'unknown'; }
}

/** Reads tools/<id>/tool.json under rootDir. Throws, naming file and JSON path, on any invalid manifest. */
export function buildCatalog(rootDir: string): Catalog {
  const toolsDir = path.join(rootDir, 'tools');
  const dirs = existsSync(toolsDir) ? readdirSync(toolsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort() : [];
  const tools: CatalogTool[] = [];
  const seen = new Map<string, string>();
  for (const dir of dirs) {
    const file = path.join(toolsDir, dir, 'tool.json');
    if (!existsSync(file)) continue;
    const name = rel(rootDir, file);
    let json: unknown;
    try { json = JSON.parse(readFileSync(file, 'utf8')); }
    catch (e) { throw new Error(`${name}: invalid JSON at / (${(e as Error).message})`); }
    const errs = validate('tool-manifest', json);
    if (errs.length) throw new Error(`${name}: invalid manifest at ${errs.map(e => `${e.path} ${e.message}`).join('; ')}`);
    const m = json as ToolManifest;
    if (m.id !== dir) throw new Error(`${name}: invalid manifest at /id (must equal its directory name "${dir}", got "${m.id}")`);
    if (seen.has(m.id)) throw new Error(`${name}: invalid manifest at /id (duplicate of ${seen.get(m.id)})`);
    seen.set(m.id, name);
    const versions = new Set<string>();
    m.versions.forEach((v, i) => {
      if (versions.has(v.version)) throw new Error(`${name}: invalid manifest at /versions/${i}/version (duplicate version ${v.version})`);
      versions.add(v.version);
    });
    let releases: ChangelogRelease[] = [];
    if (m.changelog) {
      const cf = path.join(rootDir, m.changelog);
      if (existsSync(cf)) releases = parseChangelog(readFileSync(cf, 'utf8'));
    }
    tools.push({ ...m, releases });
  }
  // Alias targets: a version of this tool, or (deprecated tools only) another tool's id.
  for (const t of tools) {
    const name = seen.get(t.id)!;
    for (const [alias, target] of Object.entries(t.aliases)) {
      if (target === undefined || t.versions.some(v => v.version === target)) continue;
      const redirect = alias === 'current' && t.lifecycle === 'deprecated' && target !== t.id && seen.has(target);
      if (!redirect) throw new Error(`${name}: invalid manifest at /aliases/${alias} ("${target}" is not a version of ${t.id})`);
    }
  }
  return { tools, built_at: new Date().toISOString(), commit: gitCommit(rootDir) };
}

/** entry, modules, version and commit of a tool's `current` alias. Deprecated tools redirect to their successor. Unknown id: error with status 404. */
export function resolve(catalog: Catalog, id: string): Resolved {
  const seen = new Set<string>();
  let cur = id;
  for (;;) {
    const tool = catalog.tools.find(t => t.id === cur);
    if (!tool) { const e = new Error(`unknown tool "${cur}"`); (e as any).status = 404; throw e; }
    if (seen.has(cur)) throw new Error(`alias cycle resolving "${id}" at "${cur}"`);
    seen.add(cur);
    const target = tool.aliases.current;
    const v = tool.versions.find(x => x.version === target);
    if (v) return { entry: tool.entry, modules: [...(v.modules ?? [])], version: v.version, commit: v.commit };
    if (tool.lifecycle === 'deprecated' && catalog.tools.some(t => t.id === target)) { cur = target; continue; }
    throw new Error(`tool "${cur}": aliases.current "${target}" is not a version`);
  }
}

/** Keep a Changelog 1.1.0 → releases in file order (newest first). Unreleased has version 'Unreleased' and date ''. */
export function parseChangelog(md: string): ChangelogRelease[] {
  const out: ChangelogRelease[] = [];
  let rel: ChangelogRelease | undefined;
  let section: string | undefined;
  let last: string[] | undefined;
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const h2 = /^##\s+\[?([^\]\s]+)\]?(?:\s*[-–—]\s*(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (h2 && !line.startsWith('###')) {
      const version = /^unreleased$/i.test(h2[1]) ? 'Unreleased' : h2[1];
      rel = { version, date: h2[2] ?? '', sections: {} };
      out.push(rel); section = undefined; last = undefined;
      continue;
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h3 && rel) {
      section = h3[1].charAt(0).toUpperCase() + h3[1].slice(1).toLowerCase();
      rel.sections[section] ??= []; last = undefined;
      continue;
    }
    if (!rel || !section) continue;
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) { last = rel.sections[section]; last.push(bullet[1].trim()); }
    else if (line.trim() && last && /^\s+\S/.test(line)) last[last.length - 1] += ' ' + line.trim();
    else if (!line.trim()) last = undefined;
  }
  return out;
}

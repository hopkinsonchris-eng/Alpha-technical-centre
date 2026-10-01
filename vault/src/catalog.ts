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

/**
 * Hub sidecar tools/<id>/hub.json (wave 2, docs/vault-hub/wave2/hub-sidecar.md).
 * The manifest schema is a Tier A contract that forbids extra fields, so what
 * only the Hub needs lives beside it: which contexts the tool accepts, the
 * query parameter that carries them, the toolbar order, and for external apps
 * the URL of the version.json they publish. `live_version` is filled by
 * liveVersions(); it is never read from the file.
 */
export interface HubSidecar {
  context?: ('project' | 'opportunity' | 'country')[];
  param?: string;
  toolbar?: number;
  version_url?: string;
  live_version?: LiveVersion | null;
}
export interface LiveVersion { version: string; released_at: string | null; checked_at: string }
export type CatalogTool = ToolManifest & { releases: ChangelogRelease[]; hub: HubSidecar | null };
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
    const hub = readSidecar(rootDir, path.join(toolsDir, dir, 'hub.json'));
    tools.push({ ...m, releases, hub });
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

const SIDECAR_CONTEXTS = new Set(['project', 'opportunity', 'country']);
const SIDECAR_KEYS = new Set(['context', 'param', 'toolbar', 'version_url']);

/** tools/<id>/hub.json → HubSidecar (live_version: null), or null when absent. Throws naming file and JSON path. */
export function readSidecar(rootDir: string, file: string): HubSidecar | null {
  if (!existsSync(file)) return null;
  const name = rel(rootDir, file);
  let json: any;
  try { json = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`${name}: invalid JSON at / (${(e as Error).message})`); }
  const fail = (p: string, msg: string): never => { throw new Error(`${name}: invalid sidecar at ${p} (${msg})`); };
  if (!json || typeof json !== 'object' || Array.isArray(json)) fail('/', 'must be an object');
  for (const k of Object.keys(json)) if (!SIDECAR_KEYS.has(k)) fail(`/${k}`, 'unknown field');
  const out: HubSidecar = {};
  if (json.context !== undefined) {
    if (!Array.isArray(json.context)) fail('/context', 'must be an array');
    json.context.forEach((c: unknown, i: number) => { if (typeof c !== 'string' || !SIDECAR_CONTEXTS.has(c)) fail(`/context/${i}`, `must be one of ${[...SIDECAR_CONTEXTS].join(', ')}`); });
    out.context = json.context;
  }
  if (json.param !== undefined) {
    if (typeof json.param !== 'string' || !/^[a-z][a-z0-9_]*$/.test(json.param)) fail('/param', 'must be a query parameter name');
    out.param = json.param;
  }
  if (json.toolbar !== undefined) {
    if (!Number.isInteger(json.toolbar) || json.toolbar < 0) fail('/toolbar', 'must be a non-negative integer');
    out.toolbar = json.toolbar;
  }
  if (json.version_url !== undefined) {
    if (typeof json.version_url !== 'string' || !/^https:\/\/[^\s]+$/.test(json.version_url)) fail('/version_url', 'must be an https URL');
    out.version_url = json.version_url;
  }
  out.live_version = null;
  return out;
}

export interface LiveVersionOptions { fetch?: typeof fetch; timeoutMs?: number; now?: () => Date }

/**
 * Ask every tool with a version_url for its published version.json
 * ({version, released_at?}). Each request has its own timeout; a failure,
 * a slow host or a bad body gives null for that tool and never delays the
 * others. Returns tool id → LiveVersion | null for the tools that have a URL.
 */
export async function liveVersions(catalog: Catalog, opts: LiveVersionOptions = {}): Promise<Map<string, LiveVersion | null>> {
  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const out = new Map<string, LiveVersion | null>();
  await Promise.all(catalog.tools.filter(t => t.hub?.version_url).map(async t => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(t.hub!.version_url!, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const body: any = await r.json();
      if (!body || typeof body.version !== 'string' || !body.version.trim()) throw new Error('no version');
      const released = typeof body.released_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(body.released_at) ? body.released_at.slice(0, 10) : null;
      out.set(t.id, { version: body.version.trim(), released_at: released, checked_at: (opts.now?.() ?? new Date()).toISOString() });
    } catch {
      out.set(t.id, null);
    } finally { clearTimeout(timer); }
  }));
  return out;
}

/** The catalog with live versions written into each tool's sidecar. */
export function withLiveVersions(catalog: Catalog, live: Map<string, LiveVersion | null>): Catalog {
  return { ...catalog, tools: catalog.tools.map(t => t.hub && live.has(t.id) ? { ...t, hub: { ...t.hub, live_version: live.get(t.id) ?? null } } : t) };
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

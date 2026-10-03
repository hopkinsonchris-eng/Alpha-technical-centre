/**
 * Company MCP server (M14). One McpServer per request, bound to the caller's Person, so every tool and
 * resource runs under that person's scope. Nothing here reads a chunk or a record directly:
 *   search_vault, list_runs   → the gateway (scope resolved and applied inside the query)
 *   get_run                   → the same visibility check as GET /api/runs/:id
 *   get_lessons, record_lesson, draft
 *                             → the M15 and M13 route handlers, called in process with the caller's Person, so
 *                               validation, legal-tag derivation and scope rules are the routes' own
 *   get_tool_current          → the tool catalog (M03)
 * Every tool call appends exactly one audit event `mcp.<tool>` (scope, refs, query hash, status; never content).
 * Resource reads append `mcp.resource.read`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { z } from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { Env } from '../app.ts';
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { audit } from '../audit.ts';
import { ApiError, assertVisible, canSee, forbidden, iso, loadAccess, notFound, sha256Hex, UUID_RE, type AuditInfo } from '../api/common.ts';
import { runRecord } from '../api/runs.routes.ts';
import { register as registerLessons } from '../api/lessons.routes.ts';
import { register as registerDraft } from '../api/draft.routes.ts';
import { register as registerItems } from '../api/items.routes.ts';
import { counterpartiesOf } from '../llm/draft.ts';
import { issuerFrom } from '../oauth/server.ts';
import { randomUUID } from 'node:crypto';
import { hybridSearch, loadProjects, resolveScope, runsFor, ScopeError, searchDeps, type SearchHit } from '../gateway/index.ts';
import { firmDir } from '../jobs/lessons-index.ts';
import { buildCatalog, resolve, type Catalog } from '../catalog.ts';

export interface McpDeps { db: Db; person: Person; now?: () => Date }

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const catalogRoot = () => process.env.CATALOG_ROOT_DIR ?? REPO_ROOT;
const TOOL_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/* ── catalog (same 60 s cache as GET /api/tools/:id/resolve) ───────── */

let cachedCatalog: { root: string; at: number; catalog: Catalog } | undefined;
function catalog(): Catalog {
  const root = catalogRoot();
  if (!cachedCatalog || cachedCatalog.root !== root || Date.now() - cachedCatalog.at > 60_000) cachedCatalog = { root, at: Date.now(), catalog: buildCatalog(root) };
  return cachedCatalog.catalog;
}

/* ── helpers ────────────────────────────────────────────────────────── */

const queryHash = (q: string) => 'sha256:' + sha256Hex(q.trim().toLowerCase().replace(/\s+/g, ' '));

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof ScopeError) return new ApiError(e.status, e.status === 403 ? 'forbidden' : 'invalid', e.message);
  if ((e as any)?.status === 404) return notFound((e as Error).message);
  console.error('[mcp]', e);
  return new ApiError(500, 'error', (e as Error).message);
}

/** The route handlers M14 reuses, mounted on a private app that carries the MCP caller instead of the /api middleware. */
function routeApp(db: Db, person: Person): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('person', person); c.set('db', db); await next(); });
  registerLessons(app, { db });
  registerDraft(app, { db });
  registerItems(app, { db });
  return app;
}
/** A link into the Hub for a project or a record, so an answer in a conversation can point at the page. */
export const hubUrl = (project?: string | null, ref?: string | null) => project ? `${issuerFrom()}/hub/project.html?id=${encodeURIComponent(project)}${ref ? '#' + encodeURIComponent(ref) : ''}` : `${issuerFrom()}/hub/`;

async function callRoute(db: Db, person: Person, method: 'GET' | 'POST', url: string, body?: unknown): Promise<any> {
  const res = await routeApp(db, person).request(url, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json: any = await res.json().catch(() => ({}));
  if (res.status >= 400) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `request failed (${res.status})`, json?.error?.path);
  return json;
}

const text = (body: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(body, null, 2) }], structuredContent: body as Record<string, unknown> });
const failure = (e: ApiError): CallToolResult => ({ isError: true, content: [{ type: 'text', text: `${e.code}: ${e.message}` }], structuredContent: { error: { code: e.code, status: e.status, message: e.message, ...(e.path ? { path: e.path } : {}) } } });

interface FoundHit extends SearchHit { type: string; date: string | null; authors: string[]; stale: boolean }

/** Adds type, date, authors and stale to hits the scope predicate already admitted; drops hits whose record is hidden or gone. */
async function enrich(db: Db, hits: SearchHit[]): Promise<FoundHit[]> {
  const itemIds = [...new Set(hits.map(h => h.item_id).filter((v): v is string => !!v))];
  const runIds = [...new Set(hits.map(h => h.run_id).filter((v): v is string => !!v))];
  const items = new Map((itemIds.length ? (await db.query<any>('SELECT id::text AS id, type, title, COALESCE(authored_at, created_at) AS at, authors, stale, hidden FROM items WHERE id = ANY($1::uuid[])', [itemIds])).rows : []).map(r => [r.id, r]));
  const runs = new Map((runIds.length ? (await db.query<any>('SELECT id::text AS id, job, title, created_at AS at, author, stale, hidden FROM runs WHERE id = ANY($1::uuid[])', [runIds])).rows : []).map(r => [r.id, r]));
  const out: FoundHit[] = [];
  for (const h of hits) {
    if (!h.item_id && !h.run_id) { out.push({ ...h, type: 'chunk', date: null, authors: [], stale: false }); continue; }
    const r = h.item_id ? items.get(h.item_id) : runs.get(h.run_id!);
    if (!r || r.hidden) continue;
    out.push({ ...h, title: h.item_id ? r.title : (r.title || r.job), type: h.item_id ? r.type : 'run', date: r.at ? new Date(r.at).toISOString() : null, authors: h.item_id ? r.authors ?? [] : [r.author], stale: !!r.stale });
  }
  return out;
}

/* ── the project summary resource ───────────────────────────────────── */

export async function projectSummary(db: Db, person: Person, id: string, now: Date): Promise<{ markdown: string; lastModified: string; refs: string[] }> {
  const projects = await loadProjects(db);
  try { resolveScope(`project:${id}`, person, projects); } catch (e) { throw toApiError(e); }
  const acc = await loadAccess(db, person, now);
  const p = acc.projects.get(id);
  if (!p) throw forbidden(`project ${id} is not visible`);
  assertVisible(acc, p.default_legal_tag, p.id, `project "${id}"`);

  const runs = (await db.query<any>('SELECT id, title, job, status, legal_tag, created_at, stale FROM runs WHERE project_id = $1 AND NOT hidden', [id])).rows.filter(r => canSee(acc, r.legal_tag, id));
  const items = (await db.query<any>('SELECT id, type, title, legal_tag, created_at, authored_at, stale, extracted FROM items WHERE project_id = $1 AND NOT hidden', [id])).rows.filter(r => canSee(acc, r.legal_tag, id, r));
  const client = p.client_id ? (await db.query<any>('SELECT name FROM organisations WHERE id = $1', [p.client_id])).rows[0]?.name ?? p.client_id : null;
  const contacts = (await db.query<any>(`SELECT c.name, c.role, c.emails, o.name AS organisation FROM project_contacts pc JOIN contacts c ON c.id = pc.contact_id JOIN organisations o ON o.id = c.organisation_id WHERE pc.project_id = $1 ORDER BY c.name`, [id])).rows;
  const members = p.members.length ? (await db.query<any>('SELECT id, name FROM people WHERE id = ANY($1::text[]) ORDER BY name', [p.members])).rows : [];

  const events: Array<{ at: string; label: string }> = [
    ...runs.map(r => ({ at: iso(r.created_at)!, label: `run "${r.title ?? r.job}"` })),
    ...items.map(i => ({ at: iso(i.created_at)!, label: `${i.type} "${i.title}"` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const last = events[0];
  const lastModified = last?.at ?? p.created_at;
  const superseded = runs.filter(r => r.status === 'superseded').length;
  const staleRuns = runs.filter(r => r.stale).length, staleItems = items.filter(i => i.stale).length;
  const day = (s: string | null) => (s ?? '').slice(0, 10);

  const md = [
    `# ${p.name} (${p.id})`,
    '',
    `- Client: ${client ?? 'internal'}${p.client_id ? ` (${p.client_id})` : ''}`,
    `- Status: ${p.status}; opened ${day(p.created_at)}${p.closed_at ? `; closed ${day(p.closed_at)}` : ''}`,
    `- Default legal tag: ${p.default_legal_tag}`,
    `- Members: ${members.length ? members.map((m: any) => `${m.name} (${m.id})`).join(', ') : 'none listed'}`,
    '',
    '## Activity',
    '',
    `- Runs: ${runs.length}${superseded ? ` (${superseded} superseded)` : ''}`,
    `- Items: ${items.length}`,
    `- Last activity: ${last ? `${last.at} (${last.label})` : 'none recorded'}`,
    `- Stale: ${staleRuns} run${staleRuns === 1 ? '' : 's'}, ${staleItems} item${staleItems === 1 ? '' : 's'}`,
    '',
    '## Contacts',
    '',
    ...(contacts.length ? contacts.map((c: any) => `- ${c.name}${c.role ? `, ${c.role}` : ''} (${c.organisation})${c.emails?.length ? `: ${c.emails.join(', ')}` : ''}`) : ['- none linked']),
    '',
  ].join('\n');
  return { markdown: md, lastModified, refs: [] };
}

/* ── the server ─────────────────────────────────────────────────────── */

export function buildMcpServer({ db, person, now = () => new Date() }: McpDeps): McpServer {
  const server = new McpServer(
    { name: 'atc-vault', version: '0.1.0' },
    { instructions: 'Alpha Technical Centre Vault. Every tool runs under your own scope: search_vault and list_runs need a scope (project:<id>, client:<id>, firm or public). record_lesson only proposes; a partner confirms. Cite records as [run:<id>] or [doc:<id>].' },
  );

  /** Runs `fn`, appends exactly one `mcp.<name>` audit event whatever happens, and turns errors into tool errors. */
  async function tool(name: string, fn: (a: AuditInfo) => Promise<Record<string, unknown>>): Promise<CallToolResult> {
    const a: AuditInfo = { scope: null, refs: [], detail: {} };
    let status = 200, code: string | undefined, result: CallToolResult;
    try { result = text(await fn(a)); }
    catch (e) { const err = toApiError(e); status = err.status; code = err.code; result = failure(err); }
    await audit(db, person.id, `mcp.${name}`, a.scope, a.refs.slice(0, 100), { ...a.detail, status, ...(code ? { error: code } : {}) });
    return result;
  }

  server.registerTool('search_vault', {
    title: 'Search the Vault',
    description: 'Hybrid (lexical + vector) search of documents and runs. scope is required: project:<id> | client:<id> | firm | public. Returns hits with ref (run:<id> or doc:<id>), title, snippet, date and stale flag.',
    inputSchema: { q: z.string().min(1).max(500), scope: z.string().min(1).max(200), k: z.number().int().min(1).max(50).optional() },
    annotations: { readOnlyHint: true },
  }, ({ q, scope: raw, k }) => tool('search_vault', async (a) => {
    const query = q.trim(), limit = k ?? 20;
    a.scope = raw.trim().slice(0, 200);
    a.detail.query_hash = queryHash(query);
    const projects = await loadProjects(db);
    const scope = resolveScope(raw.trim(), person, projects);
    a.scope = scope.label;
    const at = now();
    const found = await hybridSearch(db, query, scope, person, projects, searchDeps(), { k: Math.min(50, limit + 10), now: at });
    const hits = (await enrich(db, found)).slice(0, limit);
    a.refs = [...new Set(hits.map(h => h.ref))];
    a.detail = { ...a.detail, k: limit, count: hits.length };
    return { hits, scope: scope.label };
  }));

  server.registerTool('get_run', {
    title: 'Get a run',
    description: 'The full RunRecord (inputs, assumptions, outputs, status) for a run id the caller may see.',
    inputSchema: { id: z.string().regex(UUID_RE, 'a run id (uuid)') },
    annotations: { readOnlyHint: true },
  }, ({ id }) => tool('get_run', async (a) => {
    const rid = id.toLowerCase();
    const row = (await db.query<any>('SELECT id, project_id, legal_tag, status, supersedes, hidden, record FROM runs WHERE id = $1', [rid])).rows[0];
    if (!row || row.hidden) throw notFound(`run ${rid} not found`);
    a.refs = [`run:${rid}`]; a.scope = `project:${row.project_id}`;
    assertVisible(await loadAccess(db, person, now()), row.legal_tag, row.project_id, `run ${rid}`);
    return runRecord(row);
  }));

  server.registerTool('list_runs', {
    title: 'List runs of a project',
    description: 'Current (not superseded, not hidden) runs of a project, newest first, optionally for one job and since a date. Runs are read through the retrieval gateway under project:<project>.',
    inputSchema: { project: z.string().min(1).max(64), job: z.string().max(100).optional(), since: z.string().optional(), limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true },
  }, ({ project, job, since, limit }) => tool('list_runs', async (a) => {
    a.scope = `project:${project}`.slice(0, 200);
    let sinceIso: string | undefined;
    if (since) { const t = Date.parse(since); if (Number.isNaN(t)) throw new ApiError(400, 'invalid', 'since must be an ISO date or date-time', '/since'); sinceIso = new Date(t).toISOString(); }
    const projects = await loadProjects(db);
    const scope = resolveScope(`project:${project}`, person, projects);
    // The gateway returns every run visible in the scope (a project scope also admits firm-wide runs); narrow to this project's own.
    const visible = await runsFor(db, scope, person, projects, { job: job || undefined, since: sinceIso, limit: 200, now: now() });
    const runs = visible.filter(r => r.project_id === project).slice(0, limit ?? 50);
    a.scope = scope.label; a.refs = runs.map(r => r.ref);
    a.detail = { job: job ?? null, since: sinceIso ?? null, count: runs.length };
    return { runs, scope: scope.label };
  }));

  server.registerTool('get_lessons', {
    title: 'Get lessons',
    description: 'Confirmed lessons for a scope (firm | discipline:<name> | client:<id> | project:<id> | tool:<id>), ranked by confidence and decay, including the scopes it inherits from (client, firm). Only lessons the caller may see.',
    inputSchema: { scope: z.string().min(1).max(200), limit: z.number().int().min(1).max(200).optional() },
    annotations: { readOnlyHint: true },
  }, ({ scope, limit }) => tool('get_lessons', async (a) => {
    a.scope = scope.trim().slice(0, 200);
    const body = await callRoute(db, person, 'GET', `/api/lessons?scope=${encodeURIComponent(scope.trim())}&cascade=1&limit=${limit ?? 50}`);
    a.refs = (body.lessons ?? []).map((l: any) => `lesson:${l.id}`);
    a.detail = { count: body.count };
    return body;
  }));

  server.registerTool('get_tool_current', {
    title: 'Resolve a tool',
    description: 'The entry point, modules, version and commit of the `current` alias of a tool (same answer as GET /api/tools/<id>/resolve). Use it instead of hard-coding a tool URL or version.',
    inputSchema: { id: z.string().regex(TOOL_ID_RE, 'a tool id such as opportunity-register') },
    annotations: { readOnlyHint: true },
  }, ({ id }) => tool('get_tool_current', async (a) => {
    a.scope = 'firm'; a.refs = [`tool:${id}`];
    const r = resolve(catalog(), id);
    a.detail = { version: r.version };
    return { ...r };
  }));

  server.registerTool('record_lesson', {
    title: 'Propose a lesson',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Propose a lesson learned. It is stored as `proposed` and reaches the firm index only when a partner confirms it in the Hub queue. Needs at least one piece of evidence (run:<uuid>, doc:<uuid> or transcript:<id>) that exists and is in your scope. Same validation as POST /api/lessons: client-NDA evidence cannot be given firm, discipline or tool scope.',
    inputSchema: {
      lesson: z.object({
        claim: z.string().min(1).max(400).describe('One or two actionable sentences, understandable without this conversation'),
        detail: z.string().optional().describe('Intended, happened, why, next time'),
        scope: z.enum(['firm', 'discipline', 'client', 'project', 'tool']),
        scope_id: z.string().nullable().optional().describe('Project id, client id, tool id or discipline name; omit for firm'),
        disciplines: z.array(z.string()).optional(),
        evidence: z.array(z.string()).min(1),
        confidence: z.number().min(0).max(1),
      }),
    },
  }, ({ lesson }) => tool('record_lesson', async (a) => {
    a.scope = lesson.scope === 'firm' ? 'firm' : `${lesson.scope}:${lesson.scope_id ?? ''}`.slice(0, 200);
    const body = await callRoute(db, person, 'POST', '/api/lessons', { ...lesson, status: 'proposed' });
    a.refs = [`lesson:${body.id}`, ...lesson.evidence].slice(0, 100);
    a.detail = { status: body.status, lesson_id: body.id };
    return body;
  }));

  server.registerTool('draft', {
    title: 'Draft with the Vault',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    description: 'Draft an email, letter, report section or calc note from the Vault records in the project scope. Every factual sentence carries a [run:<id>] or [doc:<id>] citation; a figure with no record to cite comes back as a [QUESTION FOR YOU: ...] paragraph. The draft is saved as a note (its id is returned) so POST /api/render can put it on letterhead. Returns the draft, paragraphs, citations, sources, who_to_ask, warnings and questions, without the assembled context.',
    inputSchema: {
      kind: z.enum(['email', 'letter', 'report-section', 'calc-note']),
      project_id: z.string().min(1).max(64),
      brief: z.string().min(8).max(4000),
      organisation_id: z.string().max(64).optional(),
      language: z.enum(['en', 'es']).optional(),
    },
  }, (args) => tool('draft', async (a) => {
    a.scope = `project:${args.project_id}`.slice(0, 200);
    a.detail.query_hash = queryHash(args.brief);
    const { context: _context, ...result } = await callRoute(db, person, 'POST', '/api/draft', args);
    a.refs = [`doc:${result.id}`, ...(result.citations ?? [])].slice(0, 100);
    a.detail = { ...a.detail, kind: args.kind, citations: (result.citations ?? []).length, questions: (result.questions ?? []).length };
    return result;
  }));

  /* ── wave 5 (W5-D4, P49): the project as the memory behind a conversation ── */

  server.registerTool('list_projects', {
    title: 'List projects',
    description: 'The projects and opportunities you may see: id, name, status, stage, client and country, with a Hub link each. Use it to find the project id other tools need; not for searching records (search_vault) or for a project\'s contents (get_project_context).',
    inputSchema: { status: z.enum(['active', 'prospect', 'closed', 'all']).optional() },
    annotations: { readOnlyHint: true },
  }, ({ status }) => tool('list_projects', async (a) => {
    const acc = await loadAccess(db, person, now());
    // "firm" is the internal project for firm-wide records, not an opportunity anyone works: left out.
    const rows = [...acc.projects.values()].filter(p => p.id !== 'firm' && canSee(acc, p.default_legal_tag, p.id)).filter(p => !status || status === 'all' ? p.status !== 'closed' || status === 'all' : p.status === status);
    const extra = new Map((await db.query<any>('SELECT id, country, stage FROM projects WHERE id = ANY($1::text[])', [rows.map(p => p.id)])).rows.map((r: any) => [r.id, r]));
    a.scope = 'firm'; a.detail = { count: rows.length };
    return { projects: rows.map(p => ({ id: p.id, name: p.name, status: p.status, client_id: p.client_id, country: extra.get(p.id)?.country ?? null, stage: extra.get(p.id)?.stage ?? null, hub_url: hubUrl(p.id) })).sort((x, y) => x.name.localeCompare(y.name)) };
  }));

  server.registerTool('get_project_context', {
    title: 'Get a project\'s context',
    description: 'Everything to read before working on a project: the brief (status, client, members, counterparties from the register: current owner, government, licence, partners), the activity, the contacts, and the runs and records that are current or stale. Start here before drafting or filing. Use search_vault for a question across records and get_item for one record\'s text.',
    inputSchema: { project_id: z.string().min(1).max(64) },
    annotations: { readOnlyHint: true },
  }, ({ project_id }) => tool('get_project_context', async (a) => {
    a.scope = `project:${project_id}`; a.refs = [`project:${project_id}`];
    const sum = await projectSummary(db, person, project_id, now());
    const reg = (await db.query<any>('SELECT register FROM projects WHERE id = $1', [project_id])).rows[0]?.register ?? null;
    const cp = counterpartiesOf(reg);
    const lines = cp ? ['', '## Counterparties (from the register)', '', ...(cp.holder ? [`- Current owner: ${cp.holder}`] : []), ...(cp.government ? [`- Government: ${cp.government}`] : []), ...(cp.licence ? [`- Licence: ${cp.licence}`] : []), ...(cp.partners.length ? [`- JV partners: ${cp.partners.join(', ')}`] : [])] : [];
    const open = (await db.query<any>("SELECT count(*)::int AS n FROM review_queue WHERE status = 'open' AND payload->>'project_id' = $1", [project_id])).rows[0]?.n ?? 0;
    return { project_id, hub_url: hubUrl(project_id), last_modified: sum.lastModified, open_proposals: open, counterparties: cp, markdown: sum.markdown + lines.join('\n') + (open ? `\n\n## Open proposals\n\n- ${open} waiting for a decision in the Hub queue` : '') };
  }));

  server.registerTool('get_item', {
    title: 'Get a record',
    description: 'One document, note or finding by its id (the part after doc: in a ref): the record (type, title, date, legal tag, project, source URL when it has one) and its extracted text, capped. Use the ref from search_vault or get_project_context; not for runs (get_run).',
    inputSchema: { id: z.string().regex(UUID_RE), max_chars: z.number().int().min(200).max(60000).optional() },
    annotations: { readOnlyHint: true },
  }, ({ id, max_chars }) => tool('get_item', async (a) => {
    const rec = await callRoute(db, person, 'GET', `/api/items/${id}`);
    a.scope = rec.project_id ? `project:${rec.project_id}` : 'firm'; a.refs = [`doc:${id}`];
    const cap = max_chars ?? 20000;
    const chunks = (await db.query<any>('SELECT text FROM chunks WHERE item_id = $1 ORDER BY ordinal', [id])).rows.map((r: any) => r.text);
    const ex = rec.extracted ?? {};
    const full = chunks.length ? chunks.join('\n\n') : [ex.quote, ex.summary, ex.abstract, ex.text, ex.draft].filter((t: unknown) => typeof t === 'string' && t).join('\n\n');
    return { id, ref: `doc:${id}`, type: rec.type, title: rec.title, date: rec.authored_at ?? rec.created_at, legal_tag: rec.legal_tag, project_id: rec.project_id, version: rec.version, url: ex.url ?? rec.origin?.url ?? null, hub_url: hubUrl(rec.project_id, `doc:${id}`),
      text: full.slice(0, cap), truncated: full.length > cap, text_chars: full.length, cites: rec.cites ?? [] };
  }));

  server.registerTool('file_item', {
    title: 'File a note into a project',
    description: 'File text you produced (a note, a summary, minutes, a conversation\'s conclusion) as a record under a project, so it is in the Vault rather than only in this conversation: indexed for Find, versioned, and citable as doc:<id>. Needs write access to the project. Not for documents that already exist (upload them in the Hub) and not for lessons (record_lesson).',
    inputSchema: { project_id: z.string().min(1).max(64), title: z.string().min(3).max(200), text: z.string().min(1).max(200000), type: z.enum(['note', 'report', 'letter', 'email']).optional(), cites: z.array(z.string().regex(/^(run|doc|lesson):/)).max(50).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, ({ project_id, title, text, type, cites }) => tool('file_item', async (a) => {
    a.scope = `project:${project_id}`;
    const fd = new FormData();
    const external = `chat:${randomUUID()}`;
    fd.append('item', JSON.stringify({ type: type ?? 'note', title, project_id, authors: [person.id], origin: { source: 'assistant', external_id: external }, cites: cites ?? [], extracted: { kind: 'filed-from-conversation', filed_by: person.id } }));
    fd.append('original', new Blob([text], { type: 'text/markdown' }), 'note.md');
    const res = await routeApp(db, person).request('/api/items', { method: 'POST', body: fd });
    const json: any = await res.json().catch(() => ({}));
    if (res.status >= 400) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `request failed (${res.status})`, json?.error?.path);
    a.refs = [`doc:${json.id}`, ...(cites ?? [])]; a.detail = { type: type ?? 'note', chars: text.length, deduplicated: !!json.deduplicated };
    return { ref: `doc:${json.id}`, id: json.id, version: json.version, deduplicated: !!json.deduplicated, hub_url: hubUrl(project_id, `doc:${json.id}`), note: 'Filed. The text is indexed for Find at the next ingest pass; cite it as the ref.' };
  }));

  /* ── resources ────────────────────────────────────────────────────── */

  const md = (uri: URL, body: string, lastModified: string): ReadResourceResult => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: body, _meta: { lastModified } }] });
  async function readAudit(uri: URL, scope: string | null, refs: string[], status = 200, code?: string) {
    await audit(db, person.id, 'mcp.resource.read', scope, refs, { uri: uri.href, status, ...(code ? { error: code } : {}) });
  }
  async function readResource(uri: URL, scope: string | null, fn: () => Promise<{ body: string; lastModified: string; refs?: string[] }>): Promise<ReadResourceResult> {
    try {
      const r = await fn();
      await readAudit(uri, scope, r.refs ?? []);
      return md(uri, r.body, r.lastModified);
    } catch (e) {
      const err = toApiError(e);
      await readAudit(uri, scope, [], err.status, err.code);
      throw new Error(`${err.code}: ${err.message}`);
    }
  }
  const stat = (f: string) => statSync(f).mtime.toISOString();

  server.registerResource('firm-lessons', 'vault://lessons/firm.md', {
    title: 'Firm lessons', description: 'The generated firm-wide lessons index (vault/firm/LESSONS.md): confirmed, non-confidential lessons only.', mimeType: 'text/markdown',
    annotations: { lastModified: (() => { try { return stat(path.join(firmDir(), 'LESSONS.md')); } catch { return undefined; } })() },
  }, (uri) => readResource(uri, 'firm', async () => {
    const f = path.join(firmDir(), 'LESSONS.md');
    if (!existsSync(f)) throw notFound('the firm lessons index has not been generated yet');
    return { body: readFileSync(f, 'utf8'), lastModified: stat(f) };
  }));

  const changelogFile = (id: string) => path.join(catalogRoot(), 'tools', id, 'CHANGELOG.md');
  server.registerResource('tool-changelog', new ResourceTemplate('vault://tools/{id}/CHANGELOG.md', {
    list: async () => ({
      resources: (() => {
        const dir = path.join(catalogRoot(), 'tools');
        if (!existsSync(dir)) return [];
        return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && TOOL_ID_RE.test(d.name) && existsSync(changelogFile(d.name))).map(d => d.name).sort()
          .map(id => ({ uri: `vault://tools/${id}/CHANGELOG.md`, name: `${id} changelog`, mimeType: 'text/markdown', annotations: { lastModified: stat(changelogFile(id)) } }));
      })(),
    }),
  }), { title: 'Tool changelog', description: 'tools/<id>/CHANGELOG.md for a tool in the catalog.', mimeType: 'text/markdown' },
  (uri, vars) => readResource(uri, 'firm', async () => {
    const id = String(vars.id);
    if (!TOOL_ID_RE.test(id)) throw notFound(`unknown tool "${id.slice(0, 64)}"`);
    const f = changelogFile(id);
    if (!existsSync(f)) throw notFound(`tool "${id}" has no changelog`);
    return { body: readFileSync(f, 'utf8'), lastModified: stat(f), refs: [`tool:${id}`] };
  }));

  server.registerResource('project-summary', new ResourceTemplate('vault://projects/{id}/summary.md', {
    list: async () => {
      const acc = await loadAccess(db, person, now());
      const projects = await loadProjects(db);
      const out = [];
      for (const p of [...acc.projects.values()].sort((x, y) => x.id.localeCompare(y.id))) {
        try { resolveScope(`project:${p.id}`, person, projects); } catch { continue; }
        if (!canSee(acc, p.default_legal_tag, p.id)) continue;
        out.push({ uri: `vault://projects/${p.id}/summary.md`, name: `${p.name} summary`, mimeType: 'text/markdown' });
      }
      return { resources: out };
    },
  }), { title: 'Project summary', description: 'Generated summary of a project: counts of runs and items, last activity, stale counts and contacts. Scope-checked.', mimeType: 'text/markdown' },
  (uri, vars) => {
    const id = String(vars.id);
    return readResource(uri, `project:${id}`.slice(0, 200), async () => {
      const s = await projectSummary(db, person, id, now());
      return { body: s.markdown, lastModified: s.lastModified, refs: [`project:${id}`] };
    });
  });

  return server;
}

/**
 * Projects, clients, master-data assets and the project views (M02):
 * timeline (runs and items, newest first, stale flags), lineage (run_inputs
 * and item_cites as nodes and edges) and vintages (final runs with headline
 * outputs and deltas against the previous vintage of the same job).
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import {
  assertVisible, bad, canSee, forbidden, intParam, iso, jsonBody, loadAccess, notFound, requirePartner, route, scopeLabel,
  type Access, type Ctx, type ProjectRow,
} from './common.ts';
import { DEFAULT_STAGE, readOpportunityFields, stageEntry } from '../opportunities.ts';
import { triggerResearch } from './research.routes.ts';
import { linkRegisterCounterparties } from './organisations.routes.ts';

const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;
const STATUSES = ['prospect', 'active', 'closed', 'archived'];
const ORIGIN_REF = /^(doc|run|dispatch|mail|url):\S{1,400}$/;
const CLASSES = ['foreground', 'background'] as const;
/** Research findings, dossiers and the gazetteer or GEM notes are background wherever they came from (03 §4.2). */
const BACKGROUND_KINDS = new Set(['research', 'dossier']);
const BACKGROUND_SOURCES = new Set(['research', 'gem', 'wikidata', 'geonames']);

/**
 * The project as the Hub and the connector read it. Wave 7 PR3 (S4, A9): legal_tag_expiry from the project's tag,
 * stage_changed_at (backfilled from the last stage history entry when the column is still null) and origin_ref.
 */
export async function projectView(x: Ctx, acc: Access, p: ProjectRow) {
  const contacts = (await x.db.query<{ contact_id: string }>('SELECT contact_id FROM project_contacts WHERE project_id = $1 ORDER BY contact_id', [p.id])).rows.map(r => r.contact_id);
  const extra = (await x.db.query<any>('SELECT origin_ref, stage_changed_at FROM projects WHERE id = $1', [p.id])).rows[0] ?? {};
  const lastStage = p.stage_history?.length ? iso(p.stage_history[p.stage_history.length - 1].at) : null;
  return { ...p, contacts, origin_ref: extra.origin_ref ?? null, stage_changed_at: iso(extra.stage_changed_at) ?? lastStage ?? p.created_at, legal_tag_expiry: acc.tags.get(p.default_legal_tag)?.expires_at ?? null };
}

async function loadProject(x: Ctx, acc: Access): Promise<ProjectRow> {
  const id = x.c.req.param('id')!;
  const p = acc.projects.get(id);
  if (!p) throw notFound(`project "${id}" not found`);
  x.a.scope = scopeLabel(id);
  assertVisible(acc, p.default_legal_tag, p.id, `project "${id}"`);
  return p;
}

const num = (v: any): v is number => typeof v === 'number' && Number.isFinite(v);
function deltas(prev: Record<string, any> | null, cur: Record<string, any>) {
  const out: Record<string, { previous: unknown; current: unknown; delta: number | null; delta_pct: number | null }> = {};
  if (!prev) return out;
  for (const k of new Set([...Object.keys(prev), ...Object.keys(cur)])) {
    const a = prev[k]?.value, b = cur[k]?.value;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const d = num(a) && num(b) ? b - a : null;
    out[k] = { previous: a ?? null, current: b ?? null, delta: d, delta_pct: d !== null && a !== 0 ? Math.round((d / Math.abs(a)) * 10000) / 100 : null };
  }
  return out;
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/projects', 'project.create', async (x) => {
    requirePartner(x.person, 'creating a project');
    const b = await jsonBody(x.c);
    const acc = await loadAccess(x.db, x.person, x.now);
    if (typeof b.id !== 'string' || !SLUG.test(b.id)) throw bad('id must be a lowercase slug (a-z, 0-9, hyphen; 2-64 characters)', '/id');
    if (typeof b.name !== 'string' || !b.name.trim()) throw bad('name is required', '/name');
    const status = b.status ?? 'active';
    if (!STATUSES.includes(status)) throw bad(`status must be one of ${STATUSES.join(', ')}`, '/status');
    const clientId: string | null = b.client_id ?? null;
    if (clientId !== null) {
      const org = (await x.db.query('SELECT 1 FROM organisations WHERE id = $1', [clientId])).rows[0];
      if (!org) throw bad(`organisation "${clientId}" does not exist`, '/client_id', 'unknown_organisation');
    }
    const tagId: string | undefined = b.default_legal_tag ?? (clientId === null ? 'lt-firm' : undefined);
    if (!tagId) throw bad('default_legal_tag is required for a client project', '/default_legal_tag');
    const tag = acc.tags.get(tagId);
    if (!tag) throw bad(`legal tag "${tagId}" does not exist`, '/default_legal_tag', 'unknown_legal_tag');
    if (tag.classification === 'client-nda' && tag.client_id !== clientId) throw bad(`legal tag "${tagId}" belongs to client "${tag.client_id}", not "${clientId}"`, '/default_legal_tag');
    for (const k of ['asset_ids', 'members', 'contacts']) if (b[k] !== undefined && !(Array.isArray(b[k]) && b[k].every((s: unknown) => typeof s === 'string'))) throw bad(`${k} must be an array of strings`, `/${k}`);
    const members: string[] = b.members ?? [x.person.id];
    for (const m of members) if (!(await x.db.query('SELECT 1 FROM people WHERE id = $1', [m])).rows[0]) throw bad(`member "${m}" is not a known person`, '/members', 'unknown_person');
    // Wave 7 PR3 (S4): where the project came from, the email or document that started it.
    if (b.origin_ref != null && !(typeof b.origin_ref === 'string' && ORIGIN_REF.test(b.origin_ref))) throw bad('origin_ref must be doc:<id>, run:<id>, dispatch:<id>, mail:<id> or url:<address>', '/origin_ref');
    // Wave 2: opportunity fields. The first stage opens the history.
    const opp = readOpportunityFields(b);
    const stage = opp.stage ?? DEFAULT_STAGE;
    await x.db.query(
      `INSERT INTO projects (id, client_id, name, status, default_legal_tag, asset_ids, members, country, lat, lon, stage, stage_history, register, origin_ref, stage_changed_at)
       VALUES ($1,$2,$3,$4,$5,$6::text[],$7::text[],$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::timestamptz)`,
      [b.id, clientId, b.name.trim(), status, tagId, b.asset_ids ?? [], members, opp.country ?? null, opp.lat ?? null, opp.lon ?? null, stage,
       JSON.stringify([stageEntry(stage, x.person.id, x.now)]), JSON.stringify(Object.fromEntries(Object.entries(opp.register ?? {}).filter(([, v]) => v !== null))), b.origin_ref ?? null, x.now.toISOString()]);
    if (opp.register) await linkRegisterCounterparties(x.db, b.id, opp.register);
    for (const cid of b.contacts ?? []) {
      const ok = (await x.db.query('SELECT 1 FROM contacts WHERE id = $1', [cid])).rows[0];
      if (!ok) throw bad(`contact "${cid}" does not exist`, '/contacts', 'unknown_contact');
      await x.db.query('INSERT INTO project_contacts (project_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [b.id, cid]);
    }
    x.a.scope = scopeLabel(b.id); x.a.refs = [`project:${b.id}`];
    // Wave 4: a new project with a country or a real name queues a research run (§1.3).
    if (opp.country || !/^(new project|untitled|test|project)$/i.test(b.name.trim())) await triggerResearch(x.db, b.id, x.person.id, [b.name.trim()]);
    const fresh = await loadAccess(x.db, x.person, x.now);
    return { status: 201, body: await projectView(x, fresh, fresh.projects.get(b.id)!) };
  });

  /**
   * Wave 7 (S2): every row carries run_count, item_count, stale_count and last_activity_at, counting
   * only the records the caller may see; ?mine=1 keeps the projects the caller is a member of or
   * wrote a run or document in during the last 90 days.
   */
  route(app, 'GET', '/api/projects', 'project.list', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const status = x.c.req.query('status'), client = x.c.req.query('client'), mine = x.c.req.query('mine') === '1';
    const visible = [...acc.projects.values()]
      .filter(p => canSee(acc, p.default_legal_tag, p.id) && (!status || p.status === status) && (!client || p.client_id === client))
      .sort((a, b) => a.name.localeCompare(b.name));
    const ids = visible.map(p => p.id);
    const since = new Date(x.now.getTime() - 90 * 864e5).toISOString();
    const runRows = ids.length ? (await x.db.query<any>('SELECT project_id, legal_tag, author, created_at, stale, status FROM runs WHERE project_id = ANY($1::text[]) AND NOT hidden', [ids])).rows : [];
    const itemRows = ids.length ? (await x.db.query<any>('SELECT project_id, legal_tag, authors, created_at, stale FROM items WHERE project_id = ANY($1::text[]) AND NOT hidden', [ids])).rows : [];
    const counts = new Map<string, { runs: number; items: number; stale: number; last: string | null; wrote: boolean }>();
    const at = (id: string) => counts.get(id) ?? counts.set(id, { runs: 0, items: 0, stale: 0, last: null, wrote: false }).get(id)!;
    const bump = (c: { last: string | null }, when: string) => { if (!c.last || c.last < when) c.last = when; };
    for (const r of runRows) {
      if (!canSee(acc, r.legal_tag, r.project_id)) continue;
      const c = at(r.project_id), when = iso(r.created_at)!;
      c.runs++; if (r.stale && r.status !== 'superseded') c.stale++; bump(c, when);
      if (r.author === x.person.id && when >= since) c.wrote = true;
    }
    for (const i of itemRows) {
      if (!canSee(acc, i.legal_tag, i.project_id)) continue;
      const c = at(i.project_id), when = iso(i.created_at)!;
      c.items++; if (i.stale) c.stale++; bump(c, when);
      if ((i.authors ?? []).includes(x.person.id) && when >= since) c.wrote = true;
    }
    const lastStage = (p: ProjectRow) => (p.stage_history?.length ? p.stage_history[p.stage_history.length - 1].at : null);
    const list = visible.filter(p => !mine || p.members.includes(x.person.id) || at(p.id).wrote);
    x.a.scope = 'firm'; x.a.refs = list.map(p => `project:${p.id}`); x.a.detail = { count: list.length, mine };
    const contacts = (await x.db.query<{ project_id: string; contact_id: string }>('SELECT project_id, contact_id FROM project_contacts ORDER BY contact_id')).rows;
    return { body: { projects: list.map(p => {
      const c = at(p.id);
      const last = [c.last, lastStage(p), iso(p.created_at)].filter((s): s is string => !!s).sort().pop() ?? null;
      return { ...p, contacts: contacts.filter(k => k.project_id === p.id).map(k => k.contact_id), run_count: c.runs, item_count: c.items, stale_count: c.stale, last_activity_at: last };
    }) } };
  });

  route(app, 'GET', '/api/projects/:id', 'project.read', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = await loadProject(x, acc);
    x.a.refs = [`project:${p.id}`];
    return { body: await projectView(x, acc, p) };
  });

  route(app, 'GET', '/api/clients', 'client.list', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const orgs = (await x.db.query<any>('SELECT id, name, kind, country FROM organisations ORDER BY name')).rows;
    const clients = orgs.map(o => {
      const projects = [...acc.projects.values()].filter(p => p.client_id === o.id && canSee(acc, p.default_legal_tag, p.id));
      const hasAny = [...acc.projects.values()].some(p => p.client_id === o.id);
      return { ...o, project_ids: projects.map(p => p.id), project_count: projects.length, _client: o.kind === 'client' || hasAny };
    }).filter(c => c._client && (x.person.role === 'partner' || c.project_count > 0))
      .map(({ _client, ...c }) => c);
    x.a.scope = 'firm'; x.a.refs = clients.map(c => `org:${c.id}`); x.a.detail = { count: clients.length };
    return { body: { clients } };
  });

  route(app, 'GET', '/api/assets', 'asset.search', async (x) => {
    const q = (x.c.req.query('q') ?? '').trim(), kind = x.c.req.query('kind');
    const limit = intParam(x.c, 'limit', 50, 200);
    const where: string[] = []; const params: unknown[] = [];
    if (q) { params.push(`%${q.toLowerCase().replace(/[\\%_]/g, m => '\\' + m)}%`); where.push(`(lower(name) LIKE $${params.length} OR lower(id) LIKE $${params.length} OR lower(coalesce(country,'')) LIKE $${params.length})`); }
    if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
    params.push(limit);
    const rows = (await x.db.query<any>(`SELECT id, kind, name, parent_id, country, operator, source_url, props FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY kind, name LIMIT $${params.length}`, params)).rows;
    x.a.scope = 'public'; x.a.detail = { q, kind: kind ?? null, count: rows.length };
    return { body: { assets: rows } };
  });

  /**
   * Wave 7 PR3 (A4, W7-AC13): every entry carries `record_kind` (items.kind, lifted from extracted->>'kind', else
   * the item's type; the run's job) and `class` ∈ foreground | background by the rules of 03 §4: superseded runs
   * and documents, draft runs older than a newer run on the same tool, research findings, dossiers, GEM and
   * gazetteer notes, history mail and reviewed-and-sent drafts are background. `?class=` filters; `classes` always
   * carries both totals so the Hub can label the collapsed group. `kind` stays the entry discriminator (run | item).
   */
  route(app, 'GET', '/api/projects/:id/timeline', 'project.timeline', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = await loadProject(x, acc);
    const wanted = x.c.req.query('class');
    if (wanted !== undefined && wanted !== '' && !(CLASSES as readonly string[]).includes(wanted)) throw bad(`class must be one of ${CLASSES.join(', ')}`, '?class');
    const runs = (await x.db.query<any>('SELECT id, job, tool_version, title, status, supersedes, legal_tag, created_at, stale, stale_reasons FROM runs WHERE project_id = $1 AND NOT hidden', [p.id])).rows;
    const items = (await x.db.query<any>(`SELECT id, type, title, version, reference_no, supersedes, legal_tag, created_at, authored_at, stale, stale_reasons, kind, tags, origin->>'source' AS source,
        extracted->'sent' AS sent, extracted->>'history' AS history FROM items WHERE project_id = $1 AND NOT hidden`, [p.id])).rows;
    const vr = runs.filter(r => canSee(acc, r.legal_tag, p.id)), vi = items.filter(i => canSee(acc, i.legal_tag, p.id));
    const runSuperseded = new Map(vr.filter(r => r.supersedes).map(r => [r.supersedes, r.id]));
    const itemSuperseded = new Map(vi.filter(i => i.supersedes).map(i => [i.supersedes, i.id]));
    // The newest run per job that is not superseded: an older draft of the same job is background.
    const newestByJob = new Map<string, string>();
    for (const r of vr) { if (r.status === 'superseded') continue; const at = iso(r.created_at)!; if ((newestByJob.get(r.job) ?? '') < at) newestByJob.set(r.job, at); }
    const runClass = (r: any) => (r.status === 'superseded' || runSuperseded.has(r.id) || (r.status === 'draft' && iso(r.created_at)! < (newestByJob.get(r.job) ?? '')) ? 'background' : 'foreground');
    const itemClass = (i: any) => (itemSuperseded.has(i.id) || BACKGROUND_KINDS.has(i.kind) || BACKGROUND_SOURCES.has(i.source) || i.history === 'true' || (i.tags ?? []).includes('history') || (i.kind === 'draft' && !!i.sent) ? 'background' : 'foreground');
    const all = [
      ...vr.map(r => ({ kind: 'run', record_kind: r.job, class: runClass(r), ref: `run:${r.id}`, id: r.id, at: iso(r.created_at)!, title: r.title ?? r.job, job: r.job, tool_version: r.tool_version, status: r.status, legal_tag: r.legal_tag,
        stale: !!r.stale, stale_reasons: r.stale_reasons ?? [], supersedes: r.supersedes ?? null, superseded_by: runSuperseded.get(r.id) ?? null })),
      ...vi.map(i => ({ kind: 'item', record_kind: i.kind ?? i.type, class: itemClass(i), ref: `doc:${i.id}`, id: i.id, at: iso(i.authored_at ?? i.created_at)!, title: i.title, type: i.type, version: i.version, reference_no: i.reference_no ?? null, legal_tag: i.legal_tag,
        stale: !!i.stale, stale_reasons: i.stale_reasons ?? [], supersedes: i.supersedes ?? null, superseded_by: itemSuperseded.get(i.id) ?? null, ...(i.sent ? { sent: i.sent } : {}) })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
    const classes = { foreground: all.filter(e => e.class === 'foreground').length, background: all.filter(e => e.class === 'background').length };
    const entries = wanted ? all.filter(e => e.class === wanted) : all;
    x.a.refs = [`project:${p.id}`]; x.a.detail = { count: entries.length, ...classes, ...(wanted ? { class: wanted } : {}) };
    return { body: { project_id: p.id, count: entries.length, classes, entries } };
  });

  route(app, 'GET', '/api/projects/:id/lineage', 'project.lineage', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = await loadProject(x, acc);
    const runs = (await x.db.query<any>('SELECT id, job, title, status, supersedes, legal_tag, stale, record FROM runs WHERE project_id = $1 AND NOT hidden', [p.id])).rows.filter(r => canSee(acc, r.legal_tag, p.id));
    const items = (await x.db.query<any>('SELECT id, type, title, supersedes, legal_tag, stale FROM items WHERE project_id = $1 AND NOT hidden', [p.id])).rows.filter(i => canSee(acc, i.legal_tag, p.id));
    const runIds = runs.map(r => r.id), itemIds = items.map(i => i.id);
    const inputs = runIds.length ? (await x.db.query<any>('SELECT run_id::text AS run_id, ref, kind, role FROM run_inputs WHERE run_id = ANY($1::uuid[]) ORDER BY ref', [runIds])).rows : [];
    const cites = itemIds.length ? (await x.db.query<any>('SELECT item_id::text AS item_id, ref FROM item_cites WHERE item_id = ANY($1::uuid[]) ORDER BY ref', [itemIds])).rows : [];

    const nodes = new Map<string, any>();
    for (const r of runs) nodes.set(`run:${r.id}`, { id: `run:${r.id}`, kind: 'run', label: r.title ?? r.job, job: r.job, status: r.status, stale: !!r.stale, project_id: p.id });
    for (const i of items) nodes.set(`doc:${i.id}`, { id: `doc:${i.id}`, kind: 'item', label: i.title, type: i.type, stale: !!i.stale, project_id: p.id });
    const edges: { from: string; to: string; type: string; role?: string }[] = [];
    const outside = new Set<string>();
    const touch = (ref: string) => { if (!nodes.has(ref)) outside.add(ref); };
    for (const i of inputs) { touch(i.ref); edges.push({ from: i.ref, to: `run:${i.run_id}`, type: 'input', ...(i.role ? { role: i.role } : {}) }); }
    for (const c of cites) { touch(c.ref); edges.push({ from: c.ref, to: `doc:${c.item_id}`, type: 'cites' }); }
    for (const r of runs) {
      if (r.supersedes) { touch(`run:${r.supersedes}`); edges.push({ from: `run:${r.id}`, to: `run:${r.supersedes}`, type: 'supersedes' }); }
      for (const par of r.record.parents ?? []) { touch(`run:${par}`); edges.push({ from: `run:${par}`, to: `run:${r.id}`, type: 'parent' }); }
      for (const art of r.record.artifacts ?? []) { touch(art); edges.push({ from: `run:${r.id}`, to: art, type: 'artifact' }); }
    }
    for (const i of items) if (i.supersedes) { touch(`doc:${i.supersedes}`); edges.push({ from: `doc:${i.id}`, to: `doc:${i.supersedes}`, type: 'supersedes' }); }

    // Nodes outside this project: describe them only when the caller may see them.
    const extRuns = [...outside].filter(r => r.startsWith('run:')).map(r => r.slice(4)).filter(id => /^[0-9a-f-]{36}$/i.test(id));
    const extDocs = [...outside].filter(r => r.startsWith('doc:')).map(r => r.slice(4)).filter(id => /^[0-9a-f-]{36}$/i.test(id));
    const described = new Map<string, any>();
    if (extRuns.length) for (const r of (await x.db.query<any>('SELECT id, job, title, status, legal_tag, project_id, stale FROM runs WHERE id = ANY($1::uuid[]) AND NOT hidden', [extRuns])).rows)
      if (canSee(acc, r.legal_tag, r.project_id)) described.set(`run:${r.id}`, { id: `run:${r.id}`, kind: 'run', label: r.title ?? r.job, job: r.job, status: r.status, stale: !!r.stale, project_id: r.project_id });
    if (extDocs.length) for (const i of (await x.db.query<any>('SELECT id, type, title, legal_tag, project_id, stale FROM items WHERE id = ANY($1::uuid[]) AND NOT hidden', [extDocs])).rows)
      if (canSee(acc, i.legal_tag, i.project_id)) described.set(`doc:${i.id}`, { id: `doc:${i.id}`, kind: 'item', label: i.title, type: i.type, stale: !!i.stale, project_id: i.project_id });
    for (const ref of outside) {
      const kind = ref.split(':')[0];
      nodes.set(ref, described.get(ref) ?? (kind === 'run' || kind === 'doc' ? { id: ref, kind: kind === 'doc' ? 'item' : 'run', restricted: true }
        : { id: ref, kind: kind === 'ref' ? 'reference' : kind, label: ref.slice(kind.length + 1) }));
    }
    x.a.refs = [`project:${p.id}`]; x.a.detail = { nodes: nodes.size, edges: edges.length };
    return { body: { project_id: p.id, nodes: [...nodes.values()], edges } };
  });

  route(app, 'GET', '/api/projects/:id/vintages', 'project.vintages', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = await loadProject(x, acc);
    // "Final" is what the record said when it was saved, or what the row became through POST /api/runs/:id/status
    // (wave 7 PR3, A5); the row's status moves on to superseded.
    const rows = (await x.db.query<any>(`SELECT id, job, tool_version, title, status, supersedes, legal_tag, created_at, record FROM runs
        WHERE project_id = $1 AND NOT hidden AND (status = 'final' OR record->>'status' = 'final') ORDER BY created_at ASC, id`, [p.id])).rows.filter(r => canSee(acc, r.legal_tag, p.id));
    const lastByJob = new Map<string, any>();
    const vintages = rows.map(r => {
      const prev = lastByJob.get(r.job) ?? null;
      lastByJob.set(r.job, r);
      return {
        run_id: r.id, ref: `run:${r.id}`, job: r.job, tool_version: r.tool_version, title: r.title ?? r.job, created_at: iso(r.created_at)!,
        status: r.status, superseded: r.status === 'superseded', supersedes: r.supersedes ?? null, previous_run_id: prev?.id ?? null,
        outputs: r.record.outputs ?? {}, deltas: deltas(prev?.record.outputs ?? null, r.record.outputs ?? {}),
      };
    }).reverse();
    x.a.refs = [`project:${p.id}`]; x.a.detail = { count: vintages.length };
    return { body: { project_id: p.id, vintages } };
  });
}

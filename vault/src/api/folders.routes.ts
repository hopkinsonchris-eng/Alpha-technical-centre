/**
 * Project folders (wave 9, docs/vault-hub/wave9/01-project-folders.md, W9-AC1–AC8).
 *
 *   GET  /api/projects/:id/folders                    the skeleton with counts and checklists, every visible record with
 *                                                     its folder and how it got there, the project's runs per app
 *   POST /api/projects/:id/folders/file               {item_id, folder}: a person files (or moves) one record
 *   POST /api/projects/:id/folders/waive              {folder, expect, waived?}: a partner marks a checklist gap "not applicable"
 *   GET  /api/folders/proposals                       the model's doubtful filings waiting for a person, scope-checked
 *   POST /api/folders/proposals/:id/accept | /reject  {folder?}: file it there (or where the person chose), or leave it unsorted
 *
 * Every record passes canSee, so a partners-only record never reaches an associate; Legal and Financial are left out of
 * an associate's skeleton altogether, and only a partner may file into them (filing there makes the record
 * partners-only everywhere: folders/classify.ts writeFiling). Filings are append-only.
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { bad, canSee, conflict, forbidden, iso, jsonBody, loadAccess, notFound, requirePartner, requireWritableProject, route, scopeLabel, uuidParam, type Access, type Ctx } from './common.ts';
import { fileView } from './files.routes.ts';
import { DOC_KINDS, buildSkeleton, folderLabels, isPartnersFolder, type FolderNode } from '../folders/skeleton.ts';
import { projectApps, projectAssets, writeFiling } from '../folders/classify.ts';

function visibleProject(acc: Access, id: string) {
  const p = acc.projects.get(id);
  if (!p || !canSee(acc, p.default_legal_tag, p.id)) throw notFound(`project "${id}" not found`);
  return p;
}

const isPartner = (acc: Access) => acc.person.role === 'partner';

/** A folder key that no longer exists (the asset was detached) reads as its parent slot. */
function liveFolder(key: string, valid: Set<string>): string {
  let k = key;
  while (k && !valid.has(k)) k = k.includes('/') ? k.slice(0, k.lastIndexOf('/')) : '';
  return k || 'unsorted';
}

interface Waiver { folder: string; expect: string; waived: boolean }

async function waiversOf(x: Ctx, projectId: string): Promise<Map<string, boolean>> {
  const rows = (await x.db.query<Waiver>(
    `SELECT DISTINCT ON (folder, expect) folder, expect, waived FROM folder_waivers WHERE project_id = $1 ORDER BY folder, expect, at DESC, id`, [projectId])).rows;
  return new Map(rows.map(r => [`${r.folder}|${r.expect}`, r.waived]));
}

/** Files one visible record of a writable project into `folder` as a person; returns the filing id. */
async function fileByPerson(x: Ctx, acc: Access, projectId: string, itemId: string, folder: string, reason: string): Promise<{ filing_id: string; folder: string }> {
  const p = visibleProject(acc, projectId);
  requireWritableProject(acc, p.id);
  const item = (await x.db.query<any>('SELECT id, type, project_id, legal_tag, hidden, extracted FROM items WHERE id = $1', [itemId])).rows[0];
  if (!item || item.hidden || item.project_id !== p.id || !canSee(acc, item.legal_tag, item.project_id, item)) throw notFound(`item ${itemId} not found in project "${p.id}"`);
  if (isPartnersFolder(folder) && !isPartner(acc)) throw forbidden('only a partner may file into Legal or Financial');
  const labels = folderLabels(await projectAssets(x.db, p.id), projectApps(await jobsOf(x, p.id)), true);
  if (!labels.has(folder)) throw bad(`"${folder}" is not a folder of project "${p.id}"`, '/folder', 'unknown_folder');
  const id = await writeFiling(x.db, { id: item.id, project_id: p.id }, { folder, doc_kind: null, method: 'manual', confidence: null, quote: null, reason }, x.person.id, x.now);
  // Any card still waiting for this record is settled by the person's choice.
  const open = (await x.db.query<any>("SELECT id, payload FROM review_queue WHERE kind = 'folder' AND status = 'open' AND payload->>'item_id' = $1", [item.id])).rows;
  for (const q of open) await x.db.query('UPDATE review_queue SET status = $2, resolved_by = $3, resolved_at = $4 WHERE id = $1', [q.id, q.payload?.folder === folder ? 'accepted' : 'rejected', x.person.id, x.now.toISOString()]);
  // The machine's kind (from the filing it replaces) stays with the record when a person only moves it.
  await x.db.query(`UPDATE folder_filings SET doc_kind = (SELECT doc_kind FROM folder_filings o WHERE o.superseded_by = $1 LIMIT 1) WHERE id = $1 AND doc_kind IS NULL`, [id]);
  x.a.scope = scopeLabel(p.id); x.a.refs = [`doc:${item.id}`]; x.a.detail = { folder };
  return { filing_id: id, folder };
}

async function jobsOf(x: Ctx, projectId: string): Promise<string[]> {
  return (await x.db.query<{ job: string }>('SELECT DISTINCT job FROM runs WHERE project_id = $1 AND NOT hidden', [projectId])).rows.map(r => r.job);
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/projects/:id/folders', 'project.folders', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = visibleProject(acc, x.c.req.param('id')!);
    const partner = isPartner(acc);
    x.a.scope = scopeLabel(p.id); x.a.refs = [`project:${p.id}`];

    const assets = await projectAssets(x.db, p.id);
    const runRows = (await x.db.query<any>(
      `SELECT id, job, tool_version, title, created_at, status, asset_ids, legal_tag, project_id FROM runs WHERE project_id = $1 AND NOT hidden ORDER BY created_at DESC`, [p.id])).rows
      .filter(r => canSee(acc, r.legal_tag, r.project_id));
    const apps = projectApps([...new Set(runRows.map(r => r.job as string))]);
    const tree = buildSkeleton(assets, apps, partner);
    const valid = new Set<string>();
    const walk = (ns: FolderNode[]) => { for (const n of ns) { valid.add(n.key); walk(n.children); } };
    walk(tree);

    const items = (await x.db.query<any>(
      `SELECT id, type, title, created_at, authored_at, project_id, legal_tag, origin, mime, version, extracted FROM items WHERE project_id = $1 AND NOT hidden`, [p.id])).rows
      .filter(r => canSee(acc, r.legal_tag, r.project_id, r));
    const filings = new Map((await x.db.query<any>(
      'SELECT id, item_id, folder, doc_kind, method, confidence, quote, reason, filed_by, filed_at FROM folder_filings WHERE project_id = $1 AND superseded_by IS NULL', [p.id])).rows.map(f => [f.item_id, f]));
    const proposals = new Map((await x.db.query<any>(
      "SELECT id, payload FROM review_queue WHERE kind = 'folder' AND status = 'open' AND payload->>'project_id' = $1", [p.id])).rows
      .filter(q => partner || !isPartnersFolder(String(q.payload?.folder ?? '')))
      .map(q => [String(q.payload.item_id), q]));

    const files = items.map(r => {
      const f = filings.get(r.id);
      const q = proposals.get(r.id);
      const folder = f ? liveFolder(f.folder, valid) : 'unsorted';
      return {
        ...fileView(r), folder,
        filing: f ? { method: f.method, doc_kind: f.doc_kind ?? null, kind_en: f.doc_kind && DOC_KINDS[f.doc_kind as keyof typeof DOC_KINDS] ? DOC_KINDS[f.doc_kind as keyof typeof DOC_KINDS][0] : null, kind_es: f.doc_kind && DOC_KINDS[f.doc_kind as keyof typeof DOC_KINDS] ? DOC_KINDS[f.doc_kind as keyof typeof DOC_KINDS][1] : null, confidence: f.confidence ?? null, quote: f.quote ?? null, reason: f.reason ?? null, filed_by: f.filed_by, filed_at: iso(f.filed_at) } : null,
        suggestion: q && valid.has(String(q.payload.folder)) ? { queue_id: q.id, folder: String(q.payload.folder), doc_kind: q.payload.doc_kind ?? null, confidence: q.payload.confidence ?? null } : null,
      };
    });
    const runs = runRows.map(r => ({ id: r.id, job: r.job, tool_version: r.tool_version, title: r.title ?? null, created_at: iso(r.created_at), status: r.status, asset_ids: r.asset_ids ?? [], folder: `apex/${r.job}`, current: r.status !== 'superseded' }));

    // Counts and checklists, bottom up: a folder counts its own records, its runs and everything below it.
    const waived = await waiversOf(x, p.id);
    const kindsIn = new Map<string, Set<string>>();
    for (const f of files) { if (!f.filing?.doc_kind) continue; if (!kindsIn.has(f.folder)) kindsIn.set(f.folder, new Set()); kindsIn.get(f.folder)!.add(f.filing.doc_kind); }
    const own = new Map<string, number>();
    for (const f of files) own.set(f.folder, (own.get(f.folder) ?? 0) + 1);
    for (const r of runs) if (r.current) own.set(r.folder, (own.get(r.folder) ?? 0) + 1);
    const shape = (n: FolderNode): any => {
      const children = n.children.map(shape);
      const below = new Set<string>([n.key]);
      const collect = (c: any) => { below.add(c.key); c.children.forEach(collect); };
      children.forEach(collect);
      const has = (kind: string) => [...below].some(k => kindsIn.get(k)?.has(kind));
      return {
        key: n.key, n: n.n, en: n.en, es: n.es, partners_only: n.partners_only, asset_id: n.asset_id, app_id: n.app_id,
        count: (own.get(n.key) ?? 0) + children.reduce((s: number, c: any) => s + c.count, 0),
        expects: n.expects.map(e => ({ kind: e.kind, en: DOC_KINDS[e.kind][0], es: DOC_KINDS[e.kind][1], met: has(e.kind), waived: waived.get(`${n.key}|${e.kind}`) === true })),
        children,
      };
    };
    const folders = tree.map(shape);
    const unsorted = files.filter(f => f.folder === 'unsorted').length;
    x.a.detail = { count: files.length, unsorted, runs: runs.length };
    return { body: { project_id: p.id, generated_at: x.now.toISOString(), partner, folders, files, runs, unsorted, waiting: [...files].filter(f => f.suggestion).length } };
  });

  route(app, 'POST', '/api/projects/:id/folders/file', 'project.folders.file', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const b = await jsonBody(x.c);
    if (typeof b.item_id !== 'string' || !b.item_id) throw bad('item_id is required', '/item_id');
    if (typeof b.folder !== 'string' || !b.folder) throw bad('folder is required', '/folder');
    const r = await fileByPerson(x, acc, x.c.req.param('id')!, b.item_id, b.folder, `Filed by ${x.person.name || x.person.id}`);
    return { body: { item_id: b.item_id, ...r } };
  });

  route(app, 'POST', '/api/projects/:id/folders/waive', 'project.folders.waive', async (x) => {
    requirePartner(x.person, 'marking a checklist gap not applicable');
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = visibleProject(acc, x.c.req.param('id')!);
    const b = await jsonBody(x.c);
    const folder = typeof b.folder === 'string' ? b.folder : '', expect = typeof b.expect === 'string' ? b.expect : '';
    let n: FolderNode | null = null;
    const walk = (ns: FolderNode[]) => { for (const f of ns) { if (f.key === folder) n = f; walk(f.children); } };
    walk(buildSkeleton(await projectAssets(x.db, p.id), [], true));
    n = n as FolderNode | null;
    if (!n || !n.expects.some(e => e.kind === expect)) throw bad(`folder "${folder}" expects no "${expect}"`, '/expect', 'unknown_expect');
    const waived = b.waived !== false;
    await x.db.query('INSERT INTO folder_waivers (id, project_id, folder, expect, waived, by_person, at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), p.id, folder, expect, waived, x.person.id, x.now.toISOString()]);
    x.a.scope = scopeLabel(p.id); x.a.refs = [`project:${p.id}`]; x.a.detail = { folder, expect, waived };
    return { body: { project_id: p.id, folder, expect, waived } };
  });

  route(app, 'GET', '/api/folders/proposals', 'folders.proposals', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const partner = isPartner(acc);
    const rows = (await x.db.query<any>(
      `SELECT q.id, q.created_at, q.payload, i.id AS item_id, i.title, i.type, i.legal_tag, i.project_id, i.extracted, i.hidden, f.quote, f.reason
         FROM review_queue q JOIN items i ON i.id = (q.payload->>'item_id')::uuid
         LEFT JOIN folder_filings f ON f.id = (q.payload->>'filing_id')::uuid
        WHERE q.kind = 'folder' AND q.status = 'open' ORDER BY q.created_at DESC LIMIT 300`)).rows;
    const out: any[] = [];
    const options: Record<string, { key: string; label: string }[]> = {};
    const labelsFor = new Map<string, Map<string, string>>();
    for (const r of rows) {
      const p = acc.projects.get(r.project_id);
      if (!p || r.hidden || !canSee(acc, p.default_legal_tag, p.id) || !canSee(acc, r.legal_tag, r.project_id, r)) continue;
      if (!partner && isPartnersFolder(String(r.payload?.folder ?? ''))) continue;
      if (!labelsFor.has(p.id)) {
        const labels = folderLabels(await projectAssets(x.db, p.id), projectApps(await jobsOf(x, p.id)), partner);
        labelsFor.set(p.id, labels);
        options[p.id] = [...labels].filter(([k]) => k !== 'unsorted' && k !== 'apex' && !k.startsWith('apex/')).map(([key, label]) => ({ key, label }));
      }
      const labels = labelsFor.get(p.id)!;
      const folder = String(r.payload.folder);
      if (!labels.has(folder)) continue;
      out.push({ id: r.id, project_id: p.id, project_name: p.name, item_id: r.item_id, title: r.title, type: r.type, folder, folder_label: labels.get(folder), doc_kind: r.payload.doc_kind ?? null, confidence: r.payload.confidence ?? null, quote: r.quote ?? null, reason: r.reason ?? null, created_at: iso(r.created_at) });
      if (out.length >= 100) break;
    }
    x.a.scope = 'firm'; x.a.detail = { count: out.length };
    return { body: { proposals: out, options } };
  });

  for (const verb of ['accept', 'reject'] as const) {
    route(app, 'POST', `/api/folders/proposals/:id/${verb}`, `folders.proposals.${verb}`, async (x) => {
      const id = uuidParam(x.c);
      const q = (await x.db.query<any>("SELECT id, status, payload FROM review_queue WHERE id = $1 AND kind = 'folder'", [id])).rows[0];
      if (!q) throw notFound(`folder proposal ${id} not found`);
      if (q.status !== 'open') throw conflict(`folder proposal ${id} is already ${q.status}`);
      const acc = await loadAccess(x.db, x.person, x.now);
      const pid = String(q.payload?.project_id ?? ''), itemId = String(q.payload?.item_id ?? '');
      if (!isPartner(acc) && isPartnersFolder(String(q.payload?.folder ?? ''))) throw notFound(`folder proposal ${id} not found`);
      if (verb === 'reject') {
        const p = visibleProject(acc, pid);
        requireWritableProject(acc, p.id);
        await x.db.query("UPDATE review_queue SET status = 'rejected', resolved_by = $2, resolved_at = $3 WHERE id = $1", [id, x.person.id, x.now.toISOString()]);
        x.a.scope = scopeLabel(p.id); x.a.refs = [`review:${id}`, `doc:${itemId}`];
        return { body: { id, status: 'rejected' } };
      }
      const b = await jsonBody(x.c).catch(() => ({} as any));
      const chosen = typeof b?.folder === 'string' && b.folder ? b.folder : String(q.payload.folder);
      const same = chosen === String(q.payload.folder);
      const r = await fileByPerson(x, acc, pid, itemId, chosen, same ? `${x.person.name || x.person.id} accepted the suggestion` : `Filed by ${x.person.name || x.person.id}`);
      if (same) await x.db.query('UPDATE folder_filings SET doc_kind = coalesce(doc_kind, $2) WHERE id = $1', [r.filing_id, q.payload.doc_kind ?? null]);
      x.a.refs.push(`review:${id}`);
      return { body: { id, status: 'accepted', item_id: itemId, ...r } };
    });
  }
}

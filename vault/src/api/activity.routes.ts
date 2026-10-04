/**
 * What came in (wave 6, docs/vault-hub/wave6/05-markup.md §1.4; W6-AC7).
 *   GET  /api/me/activity?since=      counts since the person last looked (or `since`), and the new records per opportunity in scope
 *   POST /api/me/activity/brief       one cited sentence per opportunity from the provider (counts alone without one)
 *   POST /api/me/activity/seen        move the person's "last looked" mark to now
 * History rows (the quiet backfill) never count as "came in"; bulk mail is counted as hidden, never listed.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { bad, canSee, iso, jsonBody, loadAccess, route, type Access } from './common.ts';
import { openProvider, type LlmProvider } from '../llm/provider.ts';
import { briefActivity, type ActivityProject } from '../llm/activity-brief.ts';

export interface ActivityDeps { provider?: LlmProvider | null; now?: () => Date }
let deps: ActivityDeps = {};
/** Tests inject the provider (a FakeProvider) and the clock. */
export function configureActivity(d: ActivityDeps) { deps = { ...deps, ...d }; }
const provider = () => (deps.provider === undefined ? openProvider() : deps.provider);

const DEFAULT_WINDOW_MS = 24 * 3600_000;
const MAX_PER_PROJECT = 12;

async function sinceOf(db: RouteDeps['db'], personId: string, q: string | undefined, now: Date): Promise<Date> {
  if (q) { const d = new Date(q); if (Number.isNaN(d.getTime())) throw bad('since must be an ISO date', '?since'); return d; }
  const row = (await db.query<{ t: string | null }>('SELECT last_seen_activity_at AS t FROM people WHERE id = $1', [personId])).rows[0];
  return row?.t ? new Date(row.t) : new Date(now.getTime() - DEFAULT_WINDOW_MS);
}

interface NewRow { id: string; type: string; title: string; created_at: string; authored_at: string | null; project_id: string; legal_tag: string; hidden: boolean; origin: any; extracted: any; snippet: string | null }

async function newRows(db: RouteDeps['db'], since: Date): Promise<NewRow[]> {
  return (await db.query<NewRow>(
    `SELECT i.id, i.type, i.title, i.created_at, i.authored_at, i.project_id, i.legal_tag, i.hidden, i.origin, i.extracted,
            (SELECT left(c.text, 240) FROM chunks c WHERE c.item_id = i.id ORDER BY c.ordinal LIMIT 1) AS snippet
       FROM items i WHERE i.parent_id IS NULL AND i.created_at > $1 AND coalesce(i.extracted->>'history', 'false') <> 'true'
        AND coalesce(i.extracted->>'kind', '') NOT IN ('draft', 'research', 'country-brief')
      ORDER BY i.created_at DESC LIMIT 2000`, [since.toISOString()])).rows;
}

function gather(acc: Access, rows: NewRow[]) {
  const counts = { messages_filed: 0, ready: 0, review: 0, invoices: 0, files: 0, organisations_proposed: 0, bulk_hidden: 0, records: 0 };
  const byProject = new Map<string, ActivityProject>();
  for (const r of rows) {
    const ex = r.extracted ?? {};
    if (r.hidden) { if (ex.category === 'bulk') counts.bulk_hidden++; continue; }
    if (!canSee(acc, r.legal_tag, r.project_id, r)) continue;
    counts.records++;
    const source = r.origin?.source ?? '';
    if (r.type === 'email') {
      if (ex.status === 'filed' || (r.project_id !== 'firm' && ex.status !== 'ready' && ex.status !== 'review')) counts.messages_filed++;
      else if (ex.status === 'ready') counts.ready++;
      else if (ex.status === 'review') counts.review++;
    } else if (source === 'zoho-books' || ['invoice', 'purchase-order', 'expense'].includes(r.type)) counts.invoices++;
    else counts.files++;
    if (r.project_id === 'firm') continue;
    const p = acc.projects.get(r.project_id);
    if (!p) continue;
    const entry = byProject.get(r.project_id) ?? { id: r.project_id, name: p.name, records: [] };
    if (entry.records.length < MAX_PER_PROJECT) {
      const from = (ex.contacts ?? []).find((c: any) => c.role === 'from');
      entry.records.push({ ref: `doc:${r.id}`, type: r.type, title: r.title, date: iso(r.authored_at ?? r.created_at), direction: ex.direction ?? null, from: from ? (from.name || from.email) : null, snippet: r.snippet ?? null });
    }
    byProject.set(r.project_id, entry);
  }
  return { counts, projects: [...byProject.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export function register(app: Hono<Env>, { db }: RouteDeps): void {
  const now = () => deps.now?.() ?? new Date();

  route(app, 'GET', '/api/me/activity', 'activity.read', async (x) => {
    const since = await sinceOf(x.db, x.person.id, x.c.req.query('since'), now());
    const acc = await loadAccess(x.db, x.person, x.now);
    const { counts, projects } = gather(acc, await newRows(x.db, since));
    counts.organisations_proposed = (await x.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM review_queue WHERE kind = 'organisation' AND created_at > $1`, [since.toISOString()])).rows[0].n;
    x.a.scope = 'firm'; x.a.detail = { since: since.toISOString(), records: counts.records };
    return { body: { since: since.toISOString(), counts, projects, brief_available: !!provider() } };
  });

  route(app, 'POST', '/api/me/activity/brief', 'activity.brief', async (x) => {
    const b = await jsonBody(x.c).catch(() => ({}));
    const since = await sinceOf(x.db, x.person.id, typeof b?.since === 'string' ? b.since : undefined, now());
    const language = b?.language === 'es' ? 'es' : 'en';
    const acc = await loadAccess(x.db, x.person, x.now);
    const { projects } = gather(acc, await newRows(x.db, since));
    const p = provider();
    const brief = await briefActivity(p, projects, language);
    x.a.scope = 'firm'; x.a.refs = brief.projects.flatMap(r => r.citations); x.a.detail = { since: since.toISOString(), projects: projects.length, provider: brief.model ?? 'none', dropped: brief.projects.reduce((n, r) => n + r.dropped, 0) };
    return { body: { since: since.toISOString(), provider: brief.model, projects: brief.projects.map(r => ({ ...r, name: projects.find(q => q.id === r.project_id)?.name ?? r.project_id, records: projects.find(q => q.id === r.project_id)?.records ?? [] })), usage: brief.usage } };
  });

  route(app, 'POST', '/api/me/activity/seen', 'activity.seen', async (x) => {
    const at = now();
    await x.db.query('UPDATE people SET last_seen_activity_at = $2 WHERE id = $1', [x.person.id, at.toISOString()]);
    x.a.scope = 'firm'; x.a.detail = { at: at.toISOString() };
    return { body: { last_seen_activity_at: at.toISOString() } };
  });
}

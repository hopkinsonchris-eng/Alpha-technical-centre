/**
 * Technology register (M19).
 *   GET  /api/technology?application=&status=&w=&full=      current entries scored and ranked (status=proposed: the review list)
 *   GET  /api/technology/applications                      the application areas and their counts
 *   GET  /api/technology/:id                               one version and its key's history
 *   POST /api/technology                                   propose an entry, or a revision when the body carries a key
 *   POST /api/technology/:id/confirm|reject|retire         partners
 *   POST /api/technology/citations                         partners and service jobs: append paper counts
 *   GET  /api/projects/:id/technology/conditions           stored, derived-from-figures and merged conditions
 *   POST /api/projects/:id/technology/conditions           set the project's conditions (a new version)
 *   GET  /api/projects/:id/technology/match?application=&w= the register screened against the project, ranked
 *   GET  /api/projects/:id/technology/suggestions          the project's current decision per entry
 *   POST /api/projects/:id/technology/suggestions          {key, status: suggested|shortlisted|dismissed, note}
 *
 * Entries are firm knowledge (lt-firm) built from public sources: evidence may cite a Vault record only when that
 * record is itself firm or public, so client material never reaches the register. Proposals are visible to partners
 * and their author, confirmed entries to everyone who may see firm records. Project reads need the project to be
 * visible; project writes need it writable.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, assertVisible, bad, forbidden, isPartner, jsonBody, loadAccess, notFound, requirePartner, requireWritableProject, route, uuidParam, type Access, type Ctx } from './common.ts';
import { figuresFor } from './standing.routes.ts';
import { APPLICATIONS, APPLICATION_IDS, Conditions, EntryBody, issuePath, type EntryBody as Body } from '../technology/model.ts';
import { citationScores, costBenefit, overall, parseWeights, rank, type Scored } from '../technology/score.ts';
import { deriveConditions, mergeConditions, screen } from '../technology/screen.ts';
import {
  appendCitation, currentEntries, decide, history, insertConditions, insertEntry, insertSuggestion, latestCitations, latestConditions,
  latestSuggestions, loadEntry, proposals, StoreError, type CitationRow, type EntryRow,
} from '../technology/store.ts';

const FIRM_TAG = 'lt-firm';
const SUGGESTION_STATUSES = ['suggested', 'shortlisted', 'dismissed'] as const;

const storeErr = (e: unknown): never => {
  if (e instanceof StoreError) throw new ApiError(e.status, e.status === 404 ? 'not_found' : e.status === 409 ? 'conflict' : 'invalid', e.message, e.path);
  throw e;
};
const mayRead = (acc: Access, e: EntryRow) => e.status !== 'proposed' && e.status !== 'rejected' ? true : isPartner(acc.person) || e.author === acc.person.id;

async function access(x: Ctx): Promise<Access> {
  const acc = await loadAccess(x.db, x.person, x.now);
  assertVisible(acc, FIRM_TAG, 'firm', 'the technology register');
  x.a.scope = 'firm';
  return acc;
}
function application(x: Ctx): string | undefined {
  const a = x.c.req.query('application') || undefined;
  if (a && !APPLICATION_IDS.includes(a as any)) throw bad(`application must be one of ${APPLICATION_IDS.join(', ')}`, '?application');
  return a;
}
function weights(x: Ctx) {
  const w = parseWeights(x.c.req.query('w') || undefined);
  if (typeof w === 'string') throw bad(w, '?w');
  return w;
}

/** Evidence may cite doc:/run: only when the record exists and is firm or public (AC3). */
async function checkEvidenceRefs(x: Ctx, acc: Access, body: Body): Promise<void> {
  const refs: Array<[string, string]> = [];
  body.evidence.forEach((e, i) => refs.push([`/evidence/${i}/source`, e.source]));
  if (body.capex_source) refs.push(['/capex_source', body.capex_source]);
  if (body.opex_source) refs.push(['/opex_source', body.opex_source]);
  for (const [path, ref] of refs) {
    const m = /^(run|doc):([0-9a-f-]{36})$/i.exec(ref);
    if (!m) continue;
    const r = (await x.db.query<{ legal_tag: string; hidden: boolean }>(`SELECT legal_tag, hidden FROM ${m[1] === 'run' ? 'runs' : 'items'} WHERE id = $1`, [m[2].toLowerCase()])).rows[0];
    if (!r || r.hidden) throw bad(`${ref} does not exist`, path);
    const t = acc.tags.get(r.legal_tag);
    if (!t || !['firm', 'public'].includes(String(t.classification)) || t.client_id) {
      throw bad(`${ref} carries ${r.legal_tag}: the register is firm knowledge and may cite only firm or public records`, path);
    }
  }
}

interface View {
  id: string; key: string; version: number; application: string; name: string; status: string; summary: string; readiness: number;
  components: { capex: number; opex: number; benefit: number }; best_tier: string | null; reference_fit: Body['reference_fit'] | null;
  citations: Pick<CitationRow, 'since_2016' | 'since_2023' | 'counted_at' | 'source'> | null;
  providers: number; adipec_2026: number; abstract_only: number; scores: Scored; record?: Body;
  author: string; created_at: string; decided_by: string | null; decided_at: string | null;
}

/** Scores every entry; the citation score is scaled within each entry's own application. fitOf overrides the reference fit. */
async function scoreRows(x: Ctx, rows: EntryRow[], w = weights(x), full = false, fitOf?: (e: EntryRow) => number | null): Promise<Array<View & { rank: number }>> {
  const cites = await latestCitations(x.db, rows.map(r => r.key));
  const cscore = new Map<string, number | null>();
  for (const app of new Set(rows.map(r => r.application))) {
    const group = rows.filter(r => r.application === app);
    citationScores(group.map(r => cites.get(r.key)?.since_2016 ?? null)).forEach((s, i) => cscore.set(group[i].id, s));
  }
  const views: View[] = rows.map(r => {
    const s = r.record.scores, c = cites.get(r.key);
    const fit = fitOf ? fitOf(r) : r.record.reference_fit?.score ?? null;
    const parts = { citation: cscore.get(r.id) ?? null, cost_benefit: costBenefit(s), evidence: s.evidence, fit };
    const tiers = r.record.evidence.map(e => e.tier).sort();
    return {
      id: r.id, key: r.key, version: r.version, application: r.application, name: r.name, status: r.status,
      summary: r.record.summary, readiness: r.record.readiness, components: { capex: s.capex, opex: s.opex, benefit: s.benefit },
      best_tier: tiers[0] ?? null, reference_fit: r.record.reference_fit ?? null,
      citations: c ? { since_2016: c.since_2016, since_2023: c.since_2023, counted_at: c.counted_at, source: c.source } : null,
      providers: r.record.providers.length, adipec_2026: r.record.providers.filter(p => p.adipec_2026).length,
      abstract_only: r.record.evidence.filter(e => e.abstract_only).length,
      scores: { ...parts, overall: overall(parts, w) },
      ...(full ? { record: r.record } : {}),
      author: r.author, created_at: r.created_at, decided_by: r.decided_by, decided_at: r.decided_at,
    };
  });
  return rank(views);
}

async function projectFor(x: Ctx, write: boolean) {
  const acc = await loadAccess(x.db, x.person, x.now);
  const id = x.c.req.param('id')!;
  const p = acc.projects.get(id);
  if (!p) throw notFound(`project ${id} not found`);
  assertVisible(acc, p.default_legal_tag, p.id, `project "${id}"`);
  if (write) requireWritableProject(acc, id, '/project');
  x.a.scope = `project:${id}`; x.a.refs = [`project:${id}`];
  return { acc, p };
}

async function conditionsOf(x: Ctx, acc: Access, p: any) {
  const stored = await latestConditions(x.db, p.id);
  const figures = await figuresFor(x.db, acc, p);
  const derived = deriveConditions(figures as any);
  const merged = mergeConditions(stored?.conditions ?? null, derived, { set_at: stored?.set_at });
  return { stored, derived, ...merged };
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/technology/applications', 'technology.applications', async (x) => {
    await access(x);
    const counts = (await x.db.query<{ application: string; n: number }>(`SELECT application, count(*)::int AS n FROM tech_entries WHERE status = 'confirmed' AND superseded_by IS NULL GROUP BY application`)).rows;
    const prop = (await x.db.query<{ application: string; n: number }>(`SELECT application, count(*)::int AS n FROM tech_entries WHERE status = 'proposed' GROUP BY application`)).rows;
    return { body: { applications: APPLICATION_IDS.map(id => ({ id, ...APPLICATIONS[id], entries: counts.find(c => c.application === id)?.n ?? 0, proposals: prop.find(c => c.application === id)?.n ?? 0 })) } };
  });

  route(app, 'GET', '/api/technology', 'technology.list', async (x) => {
    const acc = await access(x);
    const a = application(x);
    const status = x.c.req.query('status') ?? 'confirmed';
    if (!['confirmed', 'proposed'].includes(status)) throw bad('status must be confirmed or proposed', '?status');
    const w = weights(x), full = x.c.req.query('full') === '1';
    let rows = status === 'confirmed' ? await currentEntries(x.db, a) : await proposals(x.db, a);
    if (status === 'proposed') rows = rows.filter(r => mayRead(acc, r));
    const entries = await scoreRows(x, rows, w, full);
    x.a.refs = entries.slice(0, 100).map(e => `tech:${e.key}`); x.a.detail = { application: a ?? null, status, count: entries.length };
    return { body: { application: a ?? null, status, weights: w, count: entries.length, entries } };
  });

  route(app, 'GET', '/api/technology/:id', 'technology.get', async (x) => {
    const acc = await access(x);
    const id = uuidParam(x.c);
    const e = await loadEntry(x.db, id);
    if (!e || !mayRead(acc, e)) throw notFound(`technology entry ${id} not found`);
    const versions = (await history(x.db, e.key)).filter(v => mayRead(acc, v));
    const scored = (await scoreRows(x, [e], undefined, true))[0];
    const cites = (await x.db.query<any>(`SELECT source, since_2016, since_2023, counted_at, query FROM tech_citations WHERE key = $1 ORDER BY counted_at DESC LIMIT 24`, [e.key])).rows;
    x.a.refs = [`tech:${e.key}`];
    return { body: { ...scored, rank: undefined, history: versions.map(v => ({ id: v.id, version: v.version, status: v.status, note: v.note, author: v.author, created_at: v.created_at, decided_by: v.decided_by, decided_at: v.decided_at, superseded_by: v.superseded_by })), citation_history: cites } };
  });

  route(app, 'POST', '/api/technology', 'technology.propose', async (x) => {
    const acc = await access(x);
    const raw = await jsonBody(x.c);
    const { status: wanted, id: _i, version: _v, author: _a, legal_tag: _l, ...rest } = raw;
    const parsed = EntryBody.safeParse(rest);
    if (!parsed.success) { const { path, message } = issuePath(parsed.error); throw bad(`technology entry ${path}: ${message}`, path); }
    await checkEvidenceRefs(x, acc, parsed.data);
    const status = wanted === 'confirmed' && isPartner(x.person) ? 'confirmed' : 'proposed';
    let r; try { r = await insertEntry(x.db, parsed.data, { author: x.person.id, status, now: x.now }); } catch (e) { return storeErr(e); }
    x.a.refs = [`tech:${r.row.key}`]; x.a.detail = { key: r.row.key, version: r.row.version, status: r.row.status, duplicate: r.duplicate };
    return { status: r.duplicate ? 200 : 201, body: { ...r.row, duplicate: r.duplicate } };
  });

  for (const [verb, to] of [['confirm', 'confirmed'], ['reject', 'rejected'], ['retire', 'retired']] as const) {
    route(app, 'POST', `/api/technology/:id/${verb}`, `technology.${verb}`, async (x) => {
      await access(x);
      requirePartner(x.person, `${verb === 'retire' ? 'retiring' : verb === 'confirm' ? 'confirming' : 'rejecting'} a technology entry`);
      let e; try { e = await decide(x.db, uuidParam(x.c), to, x.person.id, x.now); } catch (err) { return storeErr(err); }
      x.a.refs = [`tech:${e.key}`]; x.a.detail = { key: e.key, version: e.version, status: e.status };
      return { body: e };
    });
  }

  route(app, 'POST', '/api/technology/citations', 'technology.citations', async (x) => {
    await access(x);
    if (!isPartner(x.person) && x.person.role !== 'service') throw forbidden('appending citation counts is restricted to partners and service jobs');
    const b = await jsonBody(x.c);
    if (!Array.isArray(b.counts) || !b.counts.length || b.counts.length > 500) throw bad('counts must be an array of 1–500 rows', '/counts');
    const known = new Set((await x.db.query<{ key: string }>('SELECT DISTINCT key FROM tech_entries')).rows.map(r => r.key));
    const okN = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0);
    b.counts.forEach((c: any, i: number) => {
      if (!c || typeof c.key !== 'string' || !known.has(c.key)) throw bad(`unknown key ${c?.key}`, `/counts/${i}/key`);
      if (typeof c.query !== 'string' || !c.query || c.query.length > 600) throw bad('query is required', `/counts/${i}/query`);
      if (!['semantic-scholar', 'openalex', 'import'].includes(c.source)) throw bad('source must be semantic-scholar, openalex or import', `/counts/${i}/source`);
      if (!okN(c.since_2016) || !okN(c.since_2023)) throw bad('counts must be non-negative integers or null', `/counts/${i}`);
    });
    for (const c of b.counts) await appendCitation(x.db, { key: c.key, query: c.query, source: c.source, since_2016: c.since_2016, since_2023: c.since_2023, counted_by: x.person.id, counted_at: x.now.toISOString() });
    x.a.detail = { appended: b.counts.length };
    return { status: 201, body: { appended: b.counts.length } };
  });

  /* ── projects ─────────────────────────────────────────────────────── */

  route(app, 'GET', '/api/projects/:id/technology/conditions', 'technology.conditions.get', async (x) => {
    const { acc, p } = await projectFor(x, false);
    const c = await conditionsOf(x, acc, p);
    return { body: { project_id: p.id, stored: c.stored, derived: c.derived, conditions: c.conditions, sources: c.sources } };
  });

  route(app, 'POST', '/api/projects/:id/technology/conditions', 'technology.conditions.set', async (x) => {
    const { p } = await projectFor(x, true);
    const b = await jsonBody(x.c);
    const parsed = Conditions.safeParse(b.conditions ?? {});
    if (!parsed.success) { const { path, message } = issuePath(parsed.error); throw bad(`conditions ${path}: ${message}`, '/conditions' + (path === '/' ? '' : path)); }
    if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 400)) throw bad('note must be text of 400 characters or fewer', '/note');
    await insertConditions(x.db, p.id, parsed.data, x.person.id, b.note ?? null, x.now);
    x.a.detail = { keys: Object.keys(parsed.data) };
    return { status: 201, body: { project_id: p.id, conditions: parsed.data, set_by: x.person.id, set_at: x.now.toISOString() } };
  });

  route(app, 'GET', '/api/projects/:id/technology/match', 'technology.match', async (x) => {
    const { acc, p } = await projectFor(x, false);
    const a = application(x), w = weights(x);
    const c = await conditionsOf(x, acc, p);
    const rows = await currentEntries(x.db, a);
    const screens = new Map(rows.map(r => [r.id, screen(r.record.screening, c.conditions)]));
    const scored = await scoreRows(x, rows, w, false, r => screens.get(r.id)!.fit);
    const sugg = await latestSuggestions(x.db, p.id);
    const entries = scored.map(e => ({ ...e, screen: screens.get(e.id), suggestion: sugg.get(e.key) ?? null }));
    x.a.detail = { application: a ?? null, count: entries.length, fails: entries.filter(e => e.screen!.verdict === 'fail').length };
    return { body: { project_id: p.id, application: a ?? null, weights: w, conditions: c.conditions, sources: c.sources, count: entries.length, entries } };
  });

  route(app, 'GET', '/api/projects/:id/technology/suggestions', 'technology.suggestions.list', async (x) => {
    const { p } = await projectFor(x, false);
    const s = await latestSuggestions(x.db, p.id);
    return { body: { project_id: p.id, suggestions: [...s.values()] } };
  });

  route(app, 'POST', '/api/projects/:id/technology/suggestions', 'technology.suggestions.set', async (x) => {
    const { p } = await projectFor(x, true);
    const b = await jsonBody(x.c);
    if (typeof b.key !== 'string') throw bad('key is required', '/key');
    if (!SUGGESTION_STATUSES.includes(b.status)) throw bad(`status must be one of ${SUGGESTION_STATUSES.join(', ')}`, '/status');
    if (b.note !== undefined && b.note !== null && (typeof b.note !== 'string' || b.note.length > 600)) throw bad('note must be text of 600 characters or fewer', '/note');
    const cur = (await currentEntries(x.db)).find(e => e.key === b.key);
    if (!cur) throw bad(`no confirmed register entry has key ${b.key}`, '/key');
    await insertSuggestion(x.db, p.id, { key: cur.key, entry_id: cur.id, status: b.status, note: b.note ?? null, by_person: x.person.id }, x.now);
    x.a.refs.push(`tech:${cur.key}`); x.a.detail = { key: cur.key, status: b.status };
    return { status: 201, body: { project_id: p.id, key: cur.key, entry_id: cur.id, version: cur.version, status: b.status, note: b.note ?? null, by_person: x.person.id, at: x.now.toISOString() } };
  });
}

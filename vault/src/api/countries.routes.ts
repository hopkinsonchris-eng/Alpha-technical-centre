/**
 * Where the firm works (wave 2, docs/vault-hub/wave2/05-markup.md §1.3):
 *   GET /api/countries → projects grouped by country, only those the caller
 *   may see, each with the attention flags the globe colours by: stale
 *   runs or documents, days until the legal tag expires, documents in the
 *   filing queue suggested for the project. Projects without a country are
 *   returned under `unplaced` so nothing is silently dropped.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, bad, canSee, iso, loadAccess, notFound, route, type Access, type ProjectRow } from './common.ts';
import { countryName, isCountryCode } from '../opportunities.ts';
import { openProvider, type LlmProvider } from '../llm/provider.ts';
import { assembleCountryContext, withLiveRisk, writeBrief, type LiveRisk } from '../llm/brief.ts';
import { countryRisk, worldMonitorConfigured, NOT_CONNECTED } from '../intel/worldmonitor.ts';
import { recordRisk } from '../intel/risk-log.ts';
import { locationCheck } from '../assets/geo.ts';

/* ── the country brief: provider injection (tests) ───────────────────── */
interface BriefDeps { provider?: LlmProvider | null }
let briefDeps: BriefDeps = {};
export function configureBrief(d: BriefDeps) { briefDeps = { ...briefDeps, ...d }; }
const briefProvider = () => (briefDeps.provider === undefined ? openProvider() : briefDeps.provider);

const DAY = 864e5;

export interface Attention { stale: number; filing: number; expiring_days: number | null }
export interface CountryAsset { id: string; name: string; kind: string; lat: number | null; lon: number | null; location_source: string | null; outside: string | null }
export interface CountryProject {
  id: string; name: string; status: string; stage: string; client_id: string | null; client_name: string | null;
  lat: number | null; lon: number | null; last_run_at: string | null; attention: Attention; assets: CountryAsset[];
}
/** Wave 3: World Monitor's composite risk for the country; null without a key or when the feed refuses. */
export interface CountryRiskLine { score: number | null; level: string | null; trend: string | null; computed_at: string | null; fetched_at: string; sanctions_active: boolean | null; sanctions_count: number | null; /** wave 8 (W8-AC1): the score's move since the previous distinct reading in the log, null on the first */ change: number | null; previous_computed_at: string | null }
export interface CountrySummary { code: string; name: { en: string; es: string }; projects: CountryProject[]; counts: { projects: number; stale: number; filing: number; expiring: number }; risk: CountryRiskLine | null }

function expiringDays(acc: Access, p: ProjectRow): number | null {
  const tag = acc.tags.get(p.default_legal_tag);
  if (!tag?.expires_at) return null;
  const days = Math.ceil((Date.parse(tag.expires_at + 'T00:00:00Z') - Date.UTC(acc.now.getUTCFullYear(), acc.now.getUTCMonth(), acc.now.getUTCDate())) / DAY);
  return days <= 30 ? days : null;
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/countries', 'country.summary', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    // Archived projects are hidden from the globe, the panel and the counts (never deleted: the file still opens by id).
    // Wave 7 (S4): the internal holding project is not an opportunity; it is never on the globe or in the unplaced list.
    const visible = [...acc.projects.values()].filter(p => p.id !== 'firm' && p.status !== 'archived' && canSee(acc, p.default_legal_tag, p.id));
    const ids = visible.map(p => p.id);
    const orgs = new Map((await x.db.query<{ id: string; name: string }>('SELECT id, name FROM organisations')).rows.map(o => [o.id, o.name]));

    // Stale records per project, counting only what the caller may see.
    const stale = new Map<string, number>();
    const staleRows = ids.length ? (await x.db.query<any>(
      `SELECT project_id, legal_tag FROM runs WHERE project_id = ANY($1::text[]) AND stale AND NOT hidden AND status <> 'superseded'
       UNION ALL SELECT project_id, legal_tag FROM items WHERE project_id = ANY($1::text[]) AND stale AND NOT hidden`, [ids])).rows : [];
    for (const r of staleRows) if (canSee(acc, r.legal_tag, r.project_id)) stale.set(r.project_id, (stale.get(r.project_id) ?? 0) + 1);

    // Latest run per project (visible runs only).
    const lastRun = new Map<string, string>();
    const runRows = ids.length ? (await x.db.query<any>(
      `SELECT DISTINCT ON (project_id, legal_tag) project_id, legal_tag, created_at FROM runs WHERE project_id = ANY($1::text[]) AND NOT hidden ORDER BY project_id, legal_tag, created_at DESC`, [ids])).rows : [];
    for (const r of runRows) {
      if (!canSee(acc, r.legal_tag, r.project_id)) continue;
      const at = iso(r.created_at)!;
      if (!lastRun.has(r.project_id) || lastRun.get(r.project_id)! < at) lastRun.set(r.project_id, at);
    }

    // Open filing-queue rows whose top suggestion is one of these projects.
    const filing = new Map<string, number>();
    const fq = (await x.db.query<{ suggestions: { project_id?: string }[] }>("SELECT suggestions FROM filing_queue WHERE status = 'open'")).rows;
    for (const f of fq) {
      const top = Array.isArray(f.suggestions) ? f.suggestions[0]?.project_id : undefined;
      if (top && ids.includes(top)) filing.set(top, (filing.get(top) ?? 0) + 1);
    }

    // Wave 3: the fields attached to each project, for the globe and the country panel.
    const allAssetIds = [...new Set(visible.flatMap(p => p.asset_ids))];
    const assetRows = allAssetIds.length ? (await x.db.query<any>('SELECT id, name, kind, country, lat, lon, location_source FROM assets WHERE id = ANY($1::text[])', [allAssetIds])).rows : [];
    const assetById = new Map(assetRows.map((a: any) => [a.id, a]));
    const view = (p: ProjectRow): CountryProject => ({
      id: p.id, name: p.name, status: p.status, stage: p.stage, client_id: p.client_id, client_name: p.client_id ? orgs.get(p.client_id) ?? null : null,
      lat: p.lat, lon: p.lon, last_run_at: lastRun.get(p.id) ?? null,
      attention: { stale: stale.get(p.id) ?? 0, filing: filing.get(p.id) ?? 0, expiring_days: expiringDays(acc, p) },
      assets: p.asset_ids.filter(id => assetById.has(id)).map(id => { const a = assetById.get(id); const chk = locationCheck(p.country ?? null, { lat: a.lat, lon: a.lon, country: a.country }); return { id: a.id, name: a.name, kind: a.kind, lat: a.lat ?? null, lon: a.lon ?? null, location_source: a.location_source ?? null, outside: chk?.outside ? chk.found : null }; }),
    });

    const byCode = new Map<string, CountryProject[]>();
    const unplaced: CountryProject[] = [];
    for (const p of visible.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!p.country) { unplaced.push(view(p)); continue; }
      if (!byCode.has(p.country)) byCode.set(p.country, []);
      byCode.get(p.country)!.push(view(p));
    }
    // Wave 3: live risk per country from World Monitor (server-side, cached an hour); null without a key.
    const connected = worldMonitorConfigured();
    const riskNotes: string[] = [];
    const risks = new Map<string, CountryRiskLine | null>();
    if (connected) await Promise.all([...byCode.keys()].map(async code => {
      const r = await countryRisk(code);
      if (r.ok) { const log = await recordRisk(x.db, code, r.data, r.fetched_at); risks.set(code, { score: r.data.score, level: r.data.level, trend: r.data.trend, computed_at: r.data.computed_at, fetched_at: r.fetched_at, sanctions_active: r.data.sanctions_active, sanctions_count: r.data.sanctions_count, ...log }); }
      else { risks.set(code, null); if (!riskNotes.includes(r.reason)) riskNotes.push(r.reason); }
    }));
    const countries: CountrySummary[] = [...byCode.entries()].map(([code, projects]) => ({
      code, name: countryName(code), projects,
      counts: {
        projects: projects.length,
        stale: projects.reduce((n, p) => n + p.attention.stale, 0),
        filing: projects.reduce((n, p) => n + p.attention.filing, 0),
        expiring: projects.filter(p => p.attention.expiring_days !== null).length,
      },
      risk: risks.get(code) ?? null,
    })).sort((a, b) => a.name.en.localeCompare(b.name.en));

    x.a.scope = 'firm'; x.a.refs = visible.map(p => `project:${p.id}`); x.a.detail = { countries: countries.length, projects: visible.length, world_monitor: connected ? 'live' : 'not_connected' };
    return { body: { countries, unplaced, generated_at: x.now.toISOString(), world_monitor: connected ? { status: 'live', notes: riskNotes } : { status: 'not_connected', reason: NOT_CONNECTED, notes: [] } } };
  });

  /**
   * POST /api/countries/:code/brief {language?} → a cited brief of what the Vault holds for the
   * country within the caller's scope (docs/vault-hub/wave2/05-markup.md §1.6). Cached per
   * (country, language, scope tags, source set); a cached row is served only to a caller who may
   * see every tag it was built from, and regenerated when any source changed. Never written to
   * items, so a brief cannot widen a scope. 503 not_configured without a provider (wave 7: the same code Write to… uses).
   */
  route(app, 'POST', '/api/countries/:code/brief', 'country.brief', async (x) => {
    const code = x.c.req.param('code')!;
    if (!isCountryCode(code)) throw bad('code must be an ISO 3166-1 alpha-2 code in capitals (e.g. "CO")', '/code');
    let b: any = {};
    try { const raw = await x.c.req.text(); if (raw.trim()) b = JSON.parse(raw); } catch { throw bad('request body must be valid JSON', '/', 'invalid_json'); }
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('request body must be a JSON object', '/', 'invalid_json');
    const language: 'en' | 'es' = b.language === 'es' ? 'es' : 'en';
    const name = countryName(code);
    const acc = await loadAccess(x.db, x.person, x.now);
    const projects = [...acc.projects.values()].filter(p => p.country === code && p.status !== 'archived' && canSee(acc, p.default_legal_tag, p.id)).sort((a, c) => a.name.localeCompare(c.name));
    x.a.scope = 'firm'; x.a.refs = projects.map(p => `project:${p.id}`);
    if (!projects.length) throw notFound(`no projects in ${name.en} (${code}) in your scope`);
    const ctx = await withLiveRisk(await assembleCountryContext(x.db, acc, code, projects));
    const liveMeta = (l: LiveRisk | undefined) => (l ? { status: l.status, reason: l.reason ?? null, fetched_at: l.fetched_at, notes: l.notes } : { status: 'not_connected', reason: NOT_CONNECTED, fetched_at: null, notes: [] });
    // Wave 7 PR3 (S8, W7-AC15): a brief ages. Past max_age_days it is still served (its sources are unchanged) but
    // `due` tells the Hub to show its date and offer Regenerate.
    const view = (body: any, cached: boolean, created_at: string, model: string | null, maxAgeDays: number) => ({
      country: code, name, language, cached, generated_at: created_at, model, max_age_days: maxAgeDays, due: briefDue(created_at, maxAgeDays, x.now),
      projects: projects.map(p => ({ id: p.id, name: p.name, stage: p.stage, status: p.status, client_id: p.client_id })),
      world_monitor: liveMeta(ctx.live),
      ...body,
    });
    const hit = (await x.db.query<any>('SELECT body, model, created_at, max_age_days FROM country_briefs WHERE country = $1 AND language = $2 AND scope_hash = $3 AND source_hash = $4 ORDER BY id DESC LIMIT 1',
      [code, language, ctx.scope_hash, ctx.source_hash])).rows[0];
    if (hit) {
      x.a.detail = { country: code, cached: true, language, due: briefDue(iso(hit.created_at)!, hit.max_age_days, x.now) };
      return { body: view(hit.body, true, iso(hit.created_at)!, hit.model ?? null, hit.max_age_days) };
    }
    const provider = briefProvider();
    if (!provider) throw new ApiError(503, 'not_configured', 'The drafting assistant is not connected. Ask Chris.');
    const r = await writeBrief(ctx, name[language], language, provider);
    const body = { paragraphs: r.paragraphs, citations: r.citations, sources: ctx.sources, warnings: r.warnings, questions: r.questions };
    const ins = (await x.db.query<{ max_age_days: number }>('INSERT INTO country_briefs (country, language, scope_hash, source_hash, tags, body, model, created_by, created_at) VALUES ($1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,$9) RETURNING max_age_days',
      [code, language, ctx.scope_hash, ctx.source_hash, ctx.tags, JSON.stringify(body), r.model ?? null, x.person.id, x.now.toISOString()])).rows[0];
    if (r.usage) await x.db.query("INSERT INTO audit_events (person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out) VALUES ($1,'llm.brief',$2,$3::text[],$4::jsonb,$5,$6,$7)",
      [x.person.id, 'firm', x.a.refs, JSON.stringify({ country: code, model: r.model, language }), r.usage.input, r.usage.cached, r.usage.output]);
    x.a.detail = { country: code, cached: false, language, citations: r.citations.length, questions: r.questions.length, model: r.model ?? null, world_monitor: ctx.live?.status ?? 'not_connected' };
    x.a.refs = [...x.a.refs, ...r.citations];
    return { body: view(body, false, x.now.toISOString(), r.model ?? null, ins?.max_age_days ?? DEFAULT_BRIEF_MAX_AGE_DAYS) };
  });

  /**
   * GET /api/countries/:code/brief?language= → the cached brief for the caller's scope with generated_at,
   * max_age_days and due, never asking the provider (wave 7 PR3, S8). The latest brief for the scope is served
   * even when its sources changed since (then `due` is true and `stale_sources` says why); 404 when none exists.
   */
  route(app, 'GET', '/api/countries/:code/brief', 'country.brief.read', async (x) => {
    const code = x.c.req.param('code')!;
    if (!isCountryCode(code)) throw bad('code must be an ISO 3166-1 alpha-2 code in capitals (e.g. "CO")', '/code');
    const language: 'en' | 'es' = x.c.req.query('language') === 'es' ? 'es' : 'en';
    const name = countryName(code);
    const acc = await loadAccess(x.db, x.person, x.now);
    const projects = [...acc.projects.values()].filter(p => p.country === code && p.status !== 'archived' && canSee(acc, p.default_legal_tag, p.id)).sort((a, c) => a.name.localeCompare(c.name));
    x.a.scope = 'firm'; x.a.refs = projects.map(p => `project:${p.id}`);
    if (!projects.length) throw notFound(`no projects in ${name.en} (${code}) in your scope`);
    const ctx = await withLiveRisk(await assembleCountryContext(x.db, acc, code, projects));
    const live = ctx.live;
    // The brief built from today's sources when there is one; otherwise the latest for the scope, flagged.
    const hit = (await x.db.query<any>('SELECT body, model, created_at, max_age_days, source_hash FROM country_briefs WHERE country = $1 AND language = $2 AND scope_hash = $3 ORDER BY (source_hash = $4) DESC, id DESC LIMIT 1',
      [code, language, ctx.scope_hash, ctx.source_hash])).rows[0];
    if (!hit) throw notFound(`no brief for ${name.en} (${code}) yet; POST to write one`);
    const staleSources = hit.source_hash !== ctx.source_hash;
    const generated = iso(hit.created_at)!;
    const due = staleSources || briefDue(generated, hit.max_age_days, x.now);
    x.a.detail = { country: code, cached: true, language, due, stale_sources: staleSources };
    return { body: {
      country: code, name, language, cached: true, generated_at: generated, model: hit.model ?? null, max_age_days: hit.max_age_days, due, stale_sources: staleSources,
      projects: projects.map(p => ({ id: p.id, name: p.name, stage: p.stage, status: p.status, client_id: p.client_id })),
      world_monitor: live ? { status: live.status, reason: live.reason ?? null, fetched_at: live.fetched_at, notes: live.notes } : { status: 'not_connected', reason: NOT_CONNECTED, fetched_at: null, notes: [] },
      ...hit.body,
    } };
  });
}

const DEFAULT_BRIEF_MAX_AGE_DAYS = 90;
/** True when the brief is older than its max_age_days. */
export function briefDue(generatedAt: string, maxAgeDays: number, now: Date): boolean {
  const t = Date.parse(generatedAt);
  return !Number.isNaN(t) && now.getTime() - t > (maxAgeDays ?? DEFAULT_BRIEF_MAX_AGE_DAYS) * DAY;
}

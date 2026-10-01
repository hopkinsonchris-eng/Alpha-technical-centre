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
import { assembleCountryContext, writeBrief } from '../llm/brief.ts';

/* ── the country brief: provider injection (tests) ───────────────────── */
interface BriefDeps { provider?: LlmProvider | null }
let briefDeps: BriefDeps = {};
export function configureBrief(d: BriefDeps) { briefDeps = { ...briefDeps, ...d }; }
const briefProvider = () => (briefDeps.provider === undefined ? openProvider() : briefDeps.provider);

const DAY = 864e5;

export interface Attention { stale: number; filing: number; expiring_days: number | null }
export interface CountryProject {
  id: string; name: string; status: string; stage: string; client_id: string | null; client_name: string | null;
  lat: number | null; lon: number | null; last_run_at: string | null; attention: Attention;
}
export interface CountrySummary { code: string; name: { en: string; es: string }; projects: CountryProject[]; counts: { projects: number; stale: number; filing: number; expiring: number } }

function expiringDays(acc: Access, p: ProjectRow): number | null {
  const tag = acc.tags.get(p.default_legal_tag);
  if (!tag?.expires_at) return null;
  const days = Math.ceil((Date.parse(tag.expires_at + 'T00:00:00Z') - Date.UTC(acc.now.getUTCFullYear(), acc.now.getUTCMonth(), acc.now.getUTCDate())) / DAY);
  return days <= 30 ? days : null;
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/countries', 'country.summary', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const visible = [...acc.projects.values()].filter(p => canSee(acc, p.default_legal_tag, p.id));
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

    const view = (p: ProjectRow): CountryProject => ({
      id: p.id, name: p.name, status: p.status, stage: p.stage, client_id: p.client_id, client_name: p.client_id ? orgs.get(p.client_id) ?? null : null,
      lat: p.lat, lon: p.lon, last_run_at: lastRun.get(p.id) ?? null,
      attention: { stale: stale.get(p.id) ?? 0, filing: filing.get(p.id) ?? 0, expiring_days: expiringDays(acc, p) },
    });

    const byCode = new Map<string, CountryProject[]>();
    const unplaced: CountryProject[] = [];
    for (const p of visible.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!p.country) { unplaced.push(view(p)); continue; }
      if (!byCode.has(p.country)) byCode.set(p.country, []);
      byCode.get(p.country)!.push(view(p));
    }
    const countries: CountrySummary[] = [...byCode.entries()].map(([code, projects]) => ({
      code, name: countryName(code), projects,
      counts: {
        projects: projects.length,
        stale: projects.reduce((n, p) => n + p.attention.stale, 0),
        filing: projects.reduce((n, p) => n + p.attention.filing, 0),
        expiring: projects.filter(p => p.attention.expiring_days !== null).length,
      },
    })).sort((a, b) => a.name.en.localeCompare(b.name.en));

    x.a.scope = 'firm'; x.a.refs = visible.map(p => `project:${p.id}`); x.a.detail = { countries: countries.length, projects: visible.length };
    return { body: { countries, unplaced, generated_at: x.now.toISOString() } };
  });

  /**
   * POST /api/countries/:code/brief {language?} → a cited brief of what the Vault holds for the
   * country within the caller's scope (docs/vault-hub/wave2/05-markup.md §1.6). Cached per
   * (country, language, scope tags, source set); a cached row is served only to a caller who may
   * see every tag it was built from, and regenerated when any source changed. Never written to
   * items, so a brief cannot widen a scope. 501 without a provider, like /api/llm.
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
    const projects = [...acc.projects.values()].filter(p => p.country === code && canSee(acc, p.default_legal_tag, p.id)).sort((a, c) => a.name.localeCompare(c.name));
    x.a.scope = 'firm'; x.a.refs = projects.map(p => `project:${p.id}`);
    if (!projects.length) throw notFound(`no projects in ${name.en} (${code}) in your scope`);
    const ctx = await assembleCountryContext(x.db, acc, code, projects);
    const view = (body: any, cached: boolean, created_at: string, model: string | null) => ({
      country: code, name, language, cached, generated_at: created_at, model,
      projects: projects.map(p => ({ id: p.id, name: p.name, stage: p.stage, status: p.status, client_id: p.client_id })),
      ...body,
    });
    const hit = (await x.db.query<any>('SELECT body, model, created_at FROM country_briefs WHERE country = $1 AND language = $2 AND scope_hash = $3 AND source_hash = $4 ORDER BY id DESC LIMIT 1',
      [code, language, ctx.scope_hash, ctx.source_hash])).rows[0];
    if (hit) {
      x.a.detail = { country: code, cached: true, language };
      return { body: view(hit.body, true, iso(hit.created_at)!, hit.model ?? null) };
    }
    const provider = briefProvider();
    if (!provider) throw new ApiError(501, 'not_implemented', 'the Vault assistant is not connected (no LLM provider configured)');
    const r = await writeBrief(ctx, name[language], language, provider);
    const body = { paragraphs: r.paragraphs, citations: r.citations, sources: ctx.sources, warnings: r.warnings, questions: r.questions };
    await x.db.query('INSERT INTO country_briefs (country, language, scope_hash, source_hash, tags, body, model, created_by, created_at) VALUES ($1,$2,$3,$4,$5::text[],$6::jsonb,$7,$8,$9)',
      [code, language, ctx.scope_hash, ctx.source_hash, ctx.tags, JSON.stringify(body), r.model ?? null, x.person.id, x.now.toISOString()]);
    if (r.usage) await x.db.query("INSERT INTO audit_events (person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out) VALUES ($1,'llm.brief',$2,$3::text[],$4::jsonb,$5,$6,$7)",
      [x.person.id, 'firm', x.a.refs, JSON.stringify({ country: code, model: r.model, language }), r.usage.input, r.usage.cached, r.usage.output]);
    x.a.detail = { country: code, cached: false, language, citations: r.citations.length, questions: r.questions.length, model: r.model ?? null };
    x.a.refs = [...x.a.refs, ...r.citations];
    return { body: view(body, false, x.now.toISOString(), r.model ?? null) };
  });
}

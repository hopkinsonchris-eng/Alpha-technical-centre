/**
 * The risk table (wave 8, docs/vault-hub/wave8/01-risk-lens.md §2).
 *   GET /api/risk/table → one row per opportunity the caller may see, with the opportunity register's five
 *   columns: Geopolitical, Sanctions and Security read live from World Monitor (the instability index, the OFAC
 *   designations, ACLED events near the project's point), Technical and Commercial as entered on the project's
 *   register block. Every live cell carries its source, its as-of time and the formula in words, so a cell can be
 *   opened to its evidence as the register's scorecard does. Overall is the register's rule (the mean of the three
 *   highest columns with a value). The project's own execution risk rides beside the row, named apart (R11).
 *   Nothing is simulated: without a key the three live columns say "unavailable" and the entered two stand.
 *   GET /api/risk/shock?country=XX → the chokepoint the country's energy trade runs through and World Monitor's
 *   scenario for losing half its flow (crude loss in kb/d, days of cover), for a country the caller holds a project in.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { bad, canSee, loadAccess, notFound, route, type ProjectRow } from './common.ts';
import { countryName, isCountryCode } from '../opportunities.ts';
import { acledEvents, bandOf, chokepointIndex, countryRisk, energyShock, worldMonitorConfigured, NOT_CONNECTED, type AcledEvent, type CountryRisk, type RiskBand, type WmResult } from '../intel/worldmonitor.ts';
import { RISK_COLUMNS, enteredCell, nearby, overallScore, round1, sanctionsScore, securityScore, unavailable, type RiskCell, type RiskColumn } from '../intel/risk-table.ts';
import { deltas } from '../intel/risk-snapshots.ts';
import { NEAR_RADIUS_KM, NEAR_WINDOW_DAYS } from './countries.routes.ts';

export interface RiskRow {
  project_id: string; name: string; country: string; country_name: { en: string; es: string }; stage: string; status: string;
  cells: Record<RiskColumn, RiskCell>; overall: number | null; band: RiskBand | null;
  execution: { risk: string; risk_score: number | null } | null;
  delta_7d: number | null; delta_30d: number | null; since: string | null;
}

const GEO_SOURCE = 'World Monitor instability index';
const SAN_SOURCE = 'World Monitor sanctions (OFAC)';
const SEC_SOURCE = 'ACLED via World Monitor';

function geopoliticalCell(name: string, r: WmResult<CountryRisk>): RiskCell {
  if (!r.ok) return unavailable(GEO_SOURCE, r.reason);
  const d = r.data;
  if (d.score === null) return unavailable(GEO_SOURCE, 'World Monitor holds no instability score for this country.');
  const comps = d.components ? Object.entries(d.components).map(([k, v]) => `${k} ${round1(v)}`).join(', ') : null;
  return { score: round1(d.score), status: 'live', source: GEO_SOURCE, as_of: d.computed_at ?? r.fetched_at,
    evidence: `World Monitor scores ${name} ${round1(d.score)} of 100, ${d.trend ?? 'trend unknown'}${d.level ? `, advisory ${d.level}` : ''}${comps ? ` (components: ${comps})` : ''}. The column is the score itself.` };
}
function sanctionsCell(name: string, r: WmResult<CountryRisk>): RiskCell {
  if (!r.ok) return unavailable(SAN_SOURCE, r.reason);
  const d = r.data;
  const score = sanctionsScore(d.sanctions_active, d.sanctions_count);
  if (score === null) return unavailable(SAN_SOURCE, 'World Monitor does not say whether OFAC designations are active here.');
  return { score, status: 'live', source: SAN_SOURCE, as_of: r.fetched_at,
    evidence: d.sanctions_active ? `${d.sanctions_count ?? 'an unknown number of'} designated entities under active OFAC programmes name ${name}: 40, plus 20 per decade of entities, capped at 100.` : `No active OFAC designations name ${name}: 5.` };
}
function securityCell(p: ProjectRow, ev: WmResult<AcledEvent[]>, now: Date): RiskCell {
  if (!ev.ok) return unavailable(SEC_SOURCE, ev.reason);
  const where = p.lat !== null && p.lon !== null ? nearby(ev.data, p.lat, p.lon, NEAR_RADIUS_KM) : null;
  const events = where ? where.events : ev.data.length;
  const fatalities = where ? where.fatalities : ev.data.reduce((n, e) => n + (e.fatalities ?? 0), 0);
  const score = securityScore(events, fatalities)!;
  const scope = where ? `within ${NEAR_RADIUS_KM} km of the project point` : `country-wide (the project has no point yet)`;
  return { score, status: 'live', source: SEC_SOURCE, as_of: now.toISOString(),
    evidence: `${events} event${events === 1 ? '' : 's'} and ${fatalities} fatalit${fatalities === 1 ? 'y' : 'ies'} ${scope} in the last ${NEAR_WINDOW_DAYS} days${where && where.nearest_km !== null ? `, the nearest ${where.nearest_km} km away` : ''}: 10, plus 8 per event and 3 per fatality, capped at 100.` };
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/risk/table', 'risk.table', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const visible = [...acc.projects.values()].filter(p => p.id !== 'firm' && p.status !== 'archived' && !!p.country && canSee(acc, p.default_legal_tag, p.id));
    const connected = worldMonitorConfigured();
    const notes: string[] = [];
    const note = (reason: string) => { if (!notes.includes(reason)) notes.push(reason); };
    const codes = [...new Set(visible.map(p => p.country!))];
    const byCode = new Map<string, { risk: WmResult<CountryRisk>; events: WmResult<AcledEvent[]>; delta: Awaited<ReturnType<typeof deltas>> }>();
    if (connected) await Promise.all(codes.map(async code => {
      const [risk, events] = await Promise.all([countryRisk(code), acledEvents(code, NEAR_WINDOW_DAYS)]);
      if (!risk.ok) note(risk.reason);
      if (!events.ok) note(`events: ${events.reason}`);
      byCode.set(code, { risk, events, delta: await deltas(x.db, code, risk.ok ? risk.data.score : null, x.now) });
    }));
    const off: WmResult<never> = { ok: false, reason: NOT_CONNECTED };
    const rows: RiskRow[] = visible.map(p => {
      const code = p.country!, name = countryName(code);
      const c = byCode.get(code);
      const cells: Record<RiskColumn, RiskCell> = {
        geopolitical: geopoliticalCell(name.en, c ? c.risk : off),
        sanctions: sanctionsCell(name.en, c ? c.risk : off),
        security: securityCell(p, c ? c.events : off, x.now),
        technical: enteredCell(p.register, 'technical'),
        commercial: enteredCell(p.register, 'commercial'),
      };
      const reg = p.register ?? {};
      const execution = typeof reg.risk === 'string' && reg.risk ? { risk: reg.risk, risk_score: typeof reg.risk_score === 'number' ? reg.risk_score : null } : null;
      const score = c && c.risk.ok ? c.risk.data.score : null;
      return {
        project_id: p.id, name: p.name, country: code, country_name: name, stage: p.stage, status: p.status,
        cells, overall: overallScore(cells), band: bandOf(score), execution,
        delta_7d: c ? c.delta.delta_7d : null, delta_30d: c ? c.delta.delta_30d : null, since: c ? c.delta.since : null,
      };
    }).sort((a, b) => ((b.overall ?? -1) - (a.overall ?? -1)) || a.name.localeCompare(b.name));
    x.a.scope = 'firm'; x.a.refs = visible.map(p => `project:${p.id}`); x.a.detail = { rows: rows.length, world_monitor: connected ? 'live' : 'not_connected' };
    return { body: {
      columns: [...RISK_COLUMNS], rows, radius_km: NEAR_RADIUS_KM, window_days: NEAR_WINDOW_DAYS, generated_at: x.now.toISOString(),
      world_monitor: connected ? { status: 'live', notes } : { status: 'not_connected', reason: NOT_CONNECTED, notes: [] },
    } };
  });

  const SHOCK_PCT = 50;
  route(app, 'GET', '/api/risk/shock', 'risk.shock', async (x) => {
    const code = x.c.req.query('country') ?? '';
    if (!isCountryCode(code)) throw bad('country must be an ISO 3166-1 alpha-2 code in capitals (e.g. "CO")', '/country');
    const acc = await loadAccess(x.db, x.person, x.now);
    const held = [...acc.projects.values()].filter(p => p.country === code && p.id !== 'firm' && p.status !== 'archived' && canSee(acc, p.default_legal_tag, p.id));
    x.a.scope = 'firm'; x.a.refs = held.map(p => `project:${p.id}`);
    if (!held.length) throw notFound(`no projects in ${countryName(code).en} (${code}) in your scope`);
    if (!worldMonitorConfigured()) return { body: { country: code, chokepoint: null, disruption_pct: SHOCK_PCT, shock: null, world_monitor: { status: 'not_connected', reason: NOT_CONNECTED, notes: [] } } };
    const ck = await chokepointIndex(code);
    if (!ck.ok || !ck.data.primary) { x.a.detail = { country: code, chokepoint: null }; return { body: { country: code, chokepoint: null, disruption_pct: SHOCK_PCT, shock: null, world_monitor: { status: 'live', notes: ck.ok ? [] : [ck.reason] } } }; }
    const sh = await energyShock(code, ck.data.primary.id, SHOCK_PCT);
    x.a.detail = { country: code, chokepoint: ck.data.primary.id, shock: sh.ok };
    return { body: { country: code, chokepoint: ck.data.primary, disruption_pct: SHOCK_PCT, shock: sh.ok ? sh.data : null, world_monitor: { status: 'live', notes: sh.ok ? [] : [sh.reason] } } };
  });
}

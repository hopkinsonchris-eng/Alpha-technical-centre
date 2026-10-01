/**
 * Country intelligence from World Monitor (wave 3 PR 4).
 *   GET /api/countries/:code/intel → every section the feed holds for the country, each
 *   {ok, data} or {ok:false, reason} so a Pro-gated or failed section never hides the rest.
 * Read server-side with the Vault's key; cached an hour per endpoint in the adapter; public
 * scope (nothing here is a Vault record); audited with which sections answered.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { bad, route } from './common.ts';
import { countryName, isCountryCode } from '../opportunities.ts';
import {
  acledEvents, advisories, countryFacts, countryRisk, coverage, energyProfile, headlines, humanitarian, intelBrief, intelTimeline, outages, portActivity,
  resilience, sanctions, ucdpEvents, worldMonitorConfigured, NOT_CONNECTED, type WmResult,
} from '../intel/worldmonitor.ts';

const SECTIONS = {
  risk: countryRisk, brief: intelBrief, coverage, headlines, events: acledEvents, ucdp: ucdpEvents, humanitarian, energy: energyProfile, ports: portActivity,
  facts: countryFacts, advisories, sanctions, resilience, outages, timeline: intelTimeline,
} as const;
export type IntelSection = keyof typeof SECTIONS;

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/countries/:code/intel', 'country.intel', async (x) => {
    const code = x.c.req.param('code')!;
    if (!isCountryCode(code)) throw bad('code must be an ISO 3166-1 alpha-2 code in capitals (e.g. "VE")', '/code');
    const only = (x.c.req.query('sections') ?? '').split(',').map(s => s.trim()).filter(Boolean) as IntelSection[];
    for (const s of only) if (!(s in SECTIONS)) throw bad(`unknown section "${s}"; one of ${Object.keys(SECTIONS).join(', ')}`, '?sections');
    const names = (only.length ? only : (Object.keys(SECTIONS) as IntelSection[]));
    x.a.scope = 'public';
    if (!worldMonitorConfigured()) {
      x.a.detail = { country: code, world_monitor: 'not_connected' };
      return { body: { country: code, name: countryName(code), world_monitor: { status: 'not_connected', reason: NOT_CONNECTED }, sections: Object.fromEntries(names.map(n => [n, { ok: false, reason: NOT_CONNECTED }])) } };
    }
    const results = await Promise.all(names.map(async n => [n, await (SECTIONS[n] as (c: string) => Promise<WmResult<unknown>>)(code)] as const));
    const sections = Object.fromEntries(results);
    const answered = results.filter(([, r]) => r.ok).map(([n]) => n);
    const pro = results.filter(([, r]) => !r.ok && r.pro).map(([n]) => n);
    const failed = results.filter(([, r]) => !r.ok && !r.pro).map(([n, r]) => `${n}: ${(r as { reason: string }).reason}`);
    const fetchedAt = results.map(([, r]) => (r.ok ? r.fetched_at : null)).filter(Boolean).sort().pop() ?? null;
    x.a.detail = { country: code, answered, pro, failed: failed.length };
    return { body: { country: code, name: countryName(code), world_monitor: { status: answered.length ? 'live' : 'not_connected', fetched_at: fetchedAt, answered, pro_gated: pro, failed }, sections } };
  });
}

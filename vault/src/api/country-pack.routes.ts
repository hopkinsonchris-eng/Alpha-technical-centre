/**
 * The country opening pack (wave 7 PR4, docs/vault-hub/wave7/05-markup.md §1.8):
 *   POST /api/countries/:code/pack           queues a build (any signed-in person); 202 {country, job_id, state}
 *   GET  /api/countries/:code/pack           the PackView: ten sections in order, the open or latest build, the spend
 *   GET  /api/countries/:code/pack/sources   what the build will read for the country (the resolved registry)
 *   GET  /api/countries/:code/pack/:section  one PackSectionView
 * The pack is public scope (lt-public, built from public sources only): every read is audited under scope 'public'
 * and visible to every signed-in person. The API server runs a queued build in the background at once (tests call
 * runQueuedPacks themselves); the weekly cron finishes what a restart left. A build past its budget is reaped by
 * the read and by the POST, so a stuck build never blocks the button.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { bad, notFound, route } from './common.ts';
import { isCountryCode } from '../opportunities.ts';
import { enqueuePack, kickPacks, packView, type PackRunOptions } from '../jobs/country-pack.ts';
import { loadRegistry, sourcesFor } from '../country/registry.ts';
import { SECTION_IDS, type CountryRegistry, type SectionId } from '../country/types.ts';

let runOpts: PackRunOptions = {};
let autorun: boolean | null = null;
let registry: CountryRegistry | null = null;
/** Tests inject fetch, the clock, the ingest deps and the drafting hook, and switch the in-process run off. */
export function configurePack(o: PackRunOptions & { autorun?: boolean }) { const { autorun: a, ...rest } = o; runOpts = { ...runOpts, ...rest }; if (a !== undefined) autorun = a; if (rest.registry) registry = rest.registry; }
/** Never in a test process (node --test sets NODE_TEST_CONTEXT): a test that wants a build calls runQueuedPacks itself. */
const shouldAutorun = () => (autorun ?? (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT));
const reg = () => (registry ??= loadRegistry());

function codeParam(raw: string | undefined): string {
  if (!isCountryCode(raw)) throw bad('code must be an ISO 3166-1 alpha-2 code in capitals (e.g. "CO")', '/code');
  return raw;
}

/** Queues a pack when a project is created with a country (the trigger in §1.8); never throws, so the create cannot fail because of it. */
export async function triggerPack(db: RouteDeps['db'], country: string | null | undefined, by: string): Promise<void> {
  if (!isCountryCode(country)) return;
  try { await enqueuePack(db, country, by); if (shouldAutorun()) kickPacks(db, runOpts); }
  catch (e) { console.warn('[country-pack] could not queue a build for', country, (e as Error).message); }
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/countries/:code/pack', 'country.pack.build', async (x) => {
    const code = codeParam(x.c.req.param('code'));
    x.a.scope = 'public'; x.a.refs = [`country:${code}`];
    const r = await enqueuePack(x.db, code, x.person.id);
    if (shouldAutorun()) kickPacks(x.db, runOpts);
    x.a.detail = { job_id: r.job_id, state: r.state };
    return { status: 202, body: { country: code, job_id: r.job_id, state: r.state } };
  });

  route(app, 'GET', '/api/countries/:code/pack', 'country.pack.read', async (x) => {
    const code = codeParam(x.c.req.param('code'));
    x.a.scope = 'public'; x.a.refs = [`country:${code}`];
    const view = await packView(x.db, code, x.now);
    // A build still waiting (a restart dropped the in-process runner) starts on the next poll, not the next cron.
    if (view.job?.status === 'running' && shouldAutorun()) kickPacks(x.db, runOpts);
    x.a.detail = { built: view.counts.built, stale: view.counts.stale, unreachable: view.counts.unreachable, job: view.job?.id ?? null };
    return { body: view };
  });

  route(app, 'GET', '/api/countries/:code/pack/sources', 'country.pack.sources', async (x) => {
    const code = codeParam(x.c.req.param('code'));
    x.a.scope = 'public'; x.a.refs = [`country:${code}`];
    const r = sourcesFor(reg(), code);
    x.a.detail = { sources: r.sources.length, registered: r.note === null };
    return { body: { country: r.country, name: r.name, regulator: r.regulator, accounts_note: r.accounts_note, seeded_by_hand: r.seeded_by_hand, note: r.note, sources: r.sources } };
  });

  route(app, 'GET', '/api/countries/:code/pack/:section', 'country.pack.section', async (x) => {
    const code = codeParam(x.c.req.param('code'));
    const section = x.c.req.param('section') as SectionId;
    if (!SECTION_IDS.includes(section)) throw notFound(`no pack section "${section}"; the ten are ${SECTION_IDS.join(', ')}`);
    x.a.scope = 'public'; x.a.refs = [`country:${code}`];
    const view = await packView(x.db, code, x.now);
    const s = view.sections.find(v => v.section === section)!;
    x.a.detail = { section, version: s.version, status: s.status };
    return { body: s };
  });
}

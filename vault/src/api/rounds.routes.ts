/**
 * Licence rounds (wave 7 PR6; docs/vault-hub/wave7/05-markup.md §1.9, W7-AC21 and W7-AC22).
 *   GET  /api/rounds?country=CO,BR&status=confirmed&within=90   RoundsView: countries with `open`, the confirmed deadlines
 *                                                               within the window soonest first, the proposals waiting;
 *                                                               default countries: those of the caller's active and prospect projects
 *   GET  /api/rounds/:id                                        one event
 *   POST /api/rounds/:id/confirm | /dismiss                     the direct form of the queue's accept and reject (members)
 * Round events come from public regulator pages filed in public scope, so the view is public scope and audited as such.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, bad, canSee, intParam, loadAccess, notFound, route, scopeLabel, uuidParam, type Ctx } from './common.ts';
import { isCountryCode } from '../opportunities.ts';
import { confirmRound, dismissRound, EVENT_STATUSES, RoundDecisionError, roundEvent, roundsView, type EventStatus } from '../rounds/store.ts';
import { seenBefore } from '../rounds/seen-before.ts';

const MAX_WITHIN = 3650;

/** Without ?country=: every country that has a round event; the Hub narrows the deadlines to the person's projects itself. */
async function countriesWithEvents(x: Ctx): Promise<string[]> {
  return (await x.db.query<{ country: string }>('SELECT DISTINCT upper(trim(country)) AS country FROM round_events ORDER BY 1')).rows.map(r => r.country);
}

function countriesParam(raw: string | undefined): string[] | null {
  if (raw === undefined || raw.trim() === '') return null;
  const list = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
  for (const c of list) if (!isCountryCode(c)) throw bad(`"${c}" is not an ISO 3166-1 alpha-2 country code`, '?country');
  return list.sort();
}

const decide = async (x: Ctx, verb: 'confirm' | 'dismiss') => {
  const id = uuidParam(x.c);
  x.a.scope = 'public'; x.a.refs = [`round:${id}`];
  try {
    const e = verb === 'confirm' ? await confirmRound(x.db, id, x.person.id, x.now) : await dismissRound(x.db, id, x.person.id, x.now);
    x.a.detail = { country: e.country, round: e.round, stage: e.stage, event_date: e.event_date, status: e.status };
    if (e.source_item) x.a.refs.push(`doc:${e.source_item}`);
    return { body: e };
  } catch (err) {
    if (err instanceof RoundDecisionError) throw new ApiError(err.status, err.code, err.message);
    throw err;
  }
};

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/rounds', 'rounds.view', async (x) => {
    x.a.scope = 'public';
    const countries = countriesParam(x.c.req.query('country')) ?? await countriesWithEvents(x);
    const status = (x.c.req.query('status') ?? 'confirmed') as EventStatus | 'all';
    if (status !== 'all' && !EVENT_STATUSES.includes(status)) throw bad(`status must be one of ${EVENT_STATUSES.join(', ')}, all`, '?status');
    const within = intParam(x.c, 'within', 90, MAX_WITHIN);
    const view = await roundsView(x.db, { countries, status, within, now: x.now });
    x.a.scope = 'public'; x.a.refs = countries.map(c => `country:${c}`);
    x.a.detail = { countries: countries.length, status, within, deadlines: view.deadlines.length, proposed: view.proposed };
    return { body: view };
  });

  route(app, 'GET', '/api/rounds/:id', 'rounds.get', async (x) => {
    const id = uuidParam(x.c);
    x.a.scope = 'public'; x.a.refs = [`round:${id}`];
    const e = await roundEvent(x.db, id, x.now);
    if (!e) throw notFound(`round event ${id} not found`);
    if (e.source_item) x.a.refs.push(`doc:${e.source_item}`);
    return { body: e };
  });

  route(app, 'POST', '/api/rounds/:id/confirm', 'round.confirm', (x) => decide(x, 'confirm'));
  route(app, 'POST', '/api/rounds/:id/dismiss', 'round.dismiss', (x) => decide(x, 'dismiss'));

  // P3 "have we seen this before" (optional in PR6): the project's organisation, country, fields and holder, and its first
  // document, against the firm's own records in the caller's scope. One cited paragraph; the project itself is left out.
  route(app, 'GET', '/api/projects/:id/seen-before', 'project.seen_before', async (x) => {
    const pid = x.c.req.param('id') as string;
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = acc.projects.get(pid);
    if (!p || !canSee(acc, p.default_legal_tag, p.id)) throw notFound(`project ${pid} not found`);
    x.a.scope = scopeLabel(p.id, p.client_id);
    const assets = p.asset_ids?.length ? (await x.db.query<{ name: string }>('SELECT name FROM assets WHERE id = ANY($1::text[])', [p.asset_ids])).rows.map(r => r.name) : [];
    const reg: any = p.register ?? {};
    const names = [p.name, ...assets, reg.holder, reg.partners].filter((s): s is string => typeof s === 'string' && s.trim().length >= 3);
    const first = (await x.db.query<any>('SELECT id, legal_tag, project_id, type, extracted FROM items WHERE project_id = $1 AND NOT hidden ORDER BY created_at ASC LIMIT 5', [p.id])).rows.find((r: any) => canSee(acc, r.legal_tag, p.id, r));
    const r = await seenBefore(x.db, x.person, { country: p.country, organisation_ids: p.client_id ? [p.client_id] : [], names, first_item_id: first?.id ?? null, exclude_project_id: p.id }, { now: x.now, acc });
    x.a.refs = [`project:${p.id}`, ...r.cites.slice(0, 50)];
    x.a.detail = { matches: r.matches.length, projects: r.matches.filter(m => m.kind === 'project').length, documents: r.matches.filter(m => m.kind === 'document').length };
    return { body: { project_id: p.id, ...r } };
  });
}

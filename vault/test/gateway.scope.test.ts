import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { buildPredicate, resolveScope, ScopeError, type ProjectInfo } from '../src/gateway/scope.ts';
import { hybridSearch } from '../src/gateway/search.ts';
import type { Person } from '../src/auth.ts';

const NOW = new Date('2026-09-29T12:00:00Z');
const PARTNER: Person = { id: 'chris', email: 'chris@alpha-technical-centre.com', name: 'Chris', role: 'partner' };
const ASSOC: Person = { id: 'ana', email: 'ana@alpha-technical-centre.com', name: 'Ana', role: 'associate' };
const CLIENTS = ['a', 'b', 'c'];
const WORDS = ['cubiro', 'waterflood', 'boscan', 'polymer', 'npv10', 'royalty', 'carabobo', 'injector', 'viscosity', 'vintage'];

async function seed(): Promise<{ db: Db; projects: Map<string, ProjectInfo>; expected: Map<number, any> }> {
  const db = await openDb(undefined); await migrate(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('chris','chris@x','Chris','partner'),('ana','ana@x','Ana','associate')");
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-public','public','public','ANH'),('lt-firm','firm','first-party','ATC'),('lt-firm-po','firm','first-party','ATC')");
  await db.query("UPDATE legal_tags SET partners_only = true WHERE id = 'lt-firm-po'");
  await db.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('firm','Firm','lt-firm')");
  for (const c of CLIENTS) {
    await db.query('INSERT INTO organisations (id,name,kind) VALUES ($1,$2,$3)', [c, `Client ${c.toUpperCase()}`, 'client']);
    await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ($1,'client-nda','second-party',$2,$3)", [`lt-${c}-nda`, c, c]);
    await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator,expires_at) VALUES ($1,'client-nda','second-party',$2,$3,'2020-01-01')", [`lt-${c}-expired`, c, c]);
    await db.query('INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ($1,$2,$3,$4,$5::text[])', [`p-${c}-1`, c, `${c} one`, `lt-${c}-nda`, c === 'a' ? ['ana'] : []]);
    await db.query('INSERT INTO projects (id,client_id,name,default_legal_tag,members) VALUES ($1,$2,$3,$4,$5::text[])', [`p-${c}-2`, c, `${c} two`, `lt-${c}-nda`, []]);
  }
  const projects = new Map<string, ProjectInfo>((await db.query<any>('SELECT id, client_id, members FROM projects')).rows.map(r => [r.id, { id: r.id, client_id: r.client_id, members: r.members }]));
  const expected = new Map<number, any>();
  let n = 0;
  const put = async (tag: string, client: string | null, project: string, partnersOnly: boolean, current: boolean, expires: string | null) => {
    const text = `${WORDS[n % WORDS.length]} ${WORDS[(n * 3) % WORDS.length]} chunk ${n} of ${project}`;
    const vec = '[' + Array.from({ length: 1024 }, (_, i) => (i === n % 1024 ? 1 : 0)).join(',') + ']';
    const r = await db.query<any>('INSERT INTO chunks (item_id, run_id, ordinal, text, legal_tag, client_id, project_id, partners_only, expires_at, current, embedding) VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9::vector) RETURNING id', [n, text, tag, client, project, partnersOnly, expires, current, vec]);
    expected.set(r.rows[0].id, { tag, client, project, partnersOnly, current, expires });
    n++;
  };
  await db.query("ALTER TABLE chunks DROP CONSTRAINT IF EXISTS chunks_check"); // seeded chunks have no item/run
  for (let i = 0; i < 6; i++) { await put('lt-public', null, 'firm', false, true, null); await put('lt-firm', null, 'firm', false, true, null); }
  await put('lt-firm-po', null, 'firm', true, true, null); await put('lt-firm', null, 'firm', false, false, null); await put('lt-firm', null, 'firm', false, true, '2026-01-01');
  for (const c of CLIENTS) for (const p of [`p-${c}-1`, `p-${c}-2`]) for (let i = 0; i < 5; i++) await put(`lt-${c}-nda`, c, p, false, true, null);
  for (const c of CLIENTS) await put(`lt-${c}-expired`, c, `p-${c}-1`, false, true, null);
  return { db, projects, expected };
}

/** Oracle: what a correct gateway must allow for this chunk in this scope. */
function allowed(meta: any, scope: string, person: Person, projects: Map<string, ProjectInfo>): boolean {
  if (!meta.current) return false;
  if (meta.expires && meta.expires < '2026-09-29') return false;
  if (meta.tag.endsWith('-expired')) return false;
  if (meta.partnersOnly && person.role !== 'partner') return false;
  const cls = meta.tag === 'lt-public' ? 'public' : meta.tag.startsWith('lt-firm') ? 'firm' : 'client-nda';
  const [kind, id] = scope.split(':');
  if (kind === 'public') return cls === 'public';
  if (kind === 'firm') return cls !== 'client-nda';
  const client = kind === 'client' ? id : projects.get(id)!.client_id;
  if (cls !== 'client-nda') return true;
  if (meta.client !== client) return false;
  if (person.role !== 'partner') return projects.get(meta.project)!.members.includes(person.id);
  return true;
}

async function visibleIds(db: Db, scope: string, person: Person, projects: Map<string, ProjectInfo>): Promise<Set<number>> {
  const s = resolveScope(scope, person, projects);
  const pred = buildPredicate(s, person, NOW, projects, 1);
  const rows = (await db.query<any>(`SELECT c.id FROM chunks c JOIN legal_tags lt ON lt.id = c.legal_tag WHERE ${pred.sql}`, pred.params)).rows;
  return new Set(rows.map(r => r.id));
}

test('scope grammar and authorisation', async () => {
  const { db, projects } = await seed();
  assert.throws(() => resolveScope(undefined, PARTNER, projects), (e: any) => e instanceof ScopeError && e.status === 400);
  assert.throws(() => resolveScope('galaxy:1', PARTNER, projects), (e: any) => e.status === 400);
  assert.throws(() => resolveScope('project:p-b-1', ASSOC, projects), (e: any) => e.status === 403);
  assert.throws(() => resolveScope('client:b', ASSOC, projects), (e: any) => e.status === 403);
  assert.equal(resolveScope('project:p-a-1', ASSOC, projects).client_id, 'a');
  assert.equal(resolveScope('client:b', PARTNER, projects).label, 'client:b');
  await db.close();
});

test('AC6: the predicate equals the oracle for every chunk, scope and person', async () => {
  const { db, projects, expected } = await seed();
  const scopes = ['public', 'firm', ...CLIENTS.map(c => `client:${c}`), ...[...projects.keys()].filter(p => p !== 'firm').map(p => `project:${p}`)];
  for (const person of [PARTNER, ASSOC]) for (const scope of scopes) {
    let vis: Set<number>;
    try { vis = await visibleIds(db, scope, person, projects); } catch (e) { if (e instanceof ScopeError) continue; throw e; }
    for (const [id, meta] of expected) assert.equal(vis.has(id), allowed(meta, scope, person, projects), `chunk ${id} ${JSON.stringify(meta)} scope=${scope} person=${person.role}`);
  }
  await db.close();
});

test('AC6 property: random queries in a client scope never return another client\'s NDA chunk', async () => {
  const { db, projects, expected } = await seed();
  const N = Number(process.env.GATEWAY_PROPERTY_N ?? 2000);
  const embed = async (q: string) => Array.from({ length: 1024 }, (_, i) => (i === (q.length % 1024) ? 1 : 0));
  let checked = 0;
  await fc.assert(fc.asyncProperty(
    fc.constantFrom(...CLIENTS), fc.constantFrom(PARTNER, ASSOC), fc.array(fc.constantFrom(...WORDS, 'chunk', 'of', 'p-a-1', 'p-b-2', 'x'), { minLength: 1, maxLength: 4 }), fc.boolean(),
    async (client, person, words, byProject) => {
      const scope = byProject ? `project:p-${client}-1` : `client:${client}`;
      let s; try { s = resolveScope(scope, person, projects); } catch { return; }
      const hits = await hybridSearch(db, words.join(' '), s, person, projects, { embed }, { k: 50, candidates: 50, now: NOW });
      for (const h of hits) {
        const meta = expected.get(Number((h as any).item_id ?? 0)) ?? [...expected.entries()].find(([, m]) => `${m.project}` === h.project_id && h.legal_tag === m.tag)?.[1];
        assert.ok(h.legal_tag === 'lt-public' || h.legal_tag.startsWith('lt-firm') || h.legal_tag === `lt-${client}-nda`, `leak: ${h.legal_tag} in ${scope}`);
        assert.ok(!h.legal_tag.endsWith('-expired'), 'expired tag returned');
        if (person.role !== 'partner') assert.notEqual(h.legal_tag, 'lt-firm-po', 'partners-only chunk returned to an associate');
        void meta;
      }
      checked++;
    }), { numRuns: N });
  assert.ok(checked > N * 0.5, `only ${checked} queries ran`);
  await db.close();
});

test('lexical hits for an exact identifier rank first and snippets carry the term', async () => {
  const { db, projects } = await seed();
  const s = resolveScope('firm', PARTNER, projects);
  const hits = await hybridSearch(db, 'boscan', s, PARTNER, projects, {}, { now: NOW });
  assert.ok(hits.length > 0);
  assert.match(hits[0].snippet.toLowerCase(), /boscan/);
  assert.ok(hits.every(h => h.legal_tag === 'lt-public' || h.legal_tag.startsWith('lt-firm')));
  await db.close();
});

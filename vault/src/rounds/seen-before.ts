/**
 * "Have we seen this before" (wave 7 PR6, optional; docs/vault-hub/wave7/04-step-changes.md P3; 05-markup.md §1.9).
 * On a new approach, the Vault's own records in the caller's scope: projects and organisations matched by name, by
 * client and by gazetteer (the assets table: basins, fields, blocks, wells), and the first document's text run through
 * the hybrid search gateway in firm scope (lexical, plus the embedding when an embedder is available). The answer is
 * one cited paragraph and the matches with their reasons. Scope never widens: a project is named only when `canSee`
 * admits it, and the search runs under the gateway's own predicate, so a client-NDA record never surfaces to anyone
 * outside its scope. Nothing is auto-linked; the reasons are shown.
 */
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { canSee, loadAccess, type Access, type ProjectRow } from '../api/common.ts';
import { hybridSearch, loadProjects, searchDeps, type SearchDeps, type SearchHit } from '../gateway/index.ts';
import { countryName } from '../opportunities.ts';

export interface SeenBeforeInput {
  country?: string | null;
  organisation_ids?: string[];
  /** Names worth matching: the project's, its fields and blocks, the holder and partners as written. */
  names?: string[];
  /** The project's first document: its text is searched against the firm's records. */
  first_item_id?: string | null;
  /** The project being screened, left out of the answer. */
  exclude_project_id?: string | null;
}
export interface SeenBeforeMatch {
  kind: 'project' | 'organisation' | 'document';
  ref: string;                         // project:<id> | organisation:<id> | doc:<id> | run:<id>
  name: string;
  project_id: string | null;
  reasons: string[];
  cite: string | null;                 // the record to open: [doc:<id>] or [run:<id>], when one exists
}
export interface SeenBefore { paragraph: { en: string; es: string } | null; matches: SeenBeforeMatch[]; cites: string[] }
export interface SeenBeforeOptions { now?: Date; acc?: Access; search?: SearchDeps | null; maxDocs?: number }

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const esc = (s: string) => s.replace(/[%_\\]/g, m => `\\${m}`);
const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** The search deps when an embedder is configured, else lexical only; never throws for want of a key. */
function searchDepsOrLexical(): SearchDeps {
  try {
    const d = searchDeps();
    return { embed: async (t) => { try { return await d.embed(t); } catch { return []; } }, reranker: d.reranker, maxDistance: d.maxDistance };
  } catch { return {}; }
}

export async function seenBefore(db: Db, person: Person, input: SeenBeforeInput, opts: SeenBeforeOptions = {}): Promise<SeenBefore> {
  const now = opts.now ?? new Date();
  const acc = opts.acc ?? await loadAccess(db, person, now);
  const exclude = input.exclude_project_id ?? null;
  const country = clean(input.country).toUpperCase() || null;
  const names = uniq((input.names ?? []).map(clean).filter(n => n.length >= 3));
  const orgIds = uniq((input.organisation_ids ?? []).map(clean).filter(Boolean));
  const visible = (p: ProjectRow) => p.id !== exclude && p.id !== 'firm' && canSee(acc, p.default_legal_tag, p.id);
  const reasons = new Map<string, string[]>();
  const reason = (pid: string, why: string) => { const r = reasons.get(pid) ?? reasons.set(pid, []).get(pid)!; if (!r.includes(why)) r.push(why); };

  // 1. Organisations by id and by name: the registry is firm-wide.
  const orgs = (orgIds.length || names.length)
    ? (await db.query<any>(`SELECT id, name, kind, country FROM organisations WHERE id = ANY($1::text[]) OR lower(name) = ANY($2::text[]) OR ($3::text[] <> '{}' AND EXISTS (SELECT 1 FROM unnest($3::text[]) n WHERE name ILIKE '%' || n || '%')) ORDER BY name LIMIT 20`,
      [orgIds, names.map(n => n.toLowerCase()), names.map(esc)])).rows
    : [];
  const orgNames = new Map<string, string>(orgs.map((o: any) => [o.id, o.name]));

  // 2. The gazetteer: assets whose name matches, and the projects that carry them.
  const assets = names.length ? (await db.query<any>(`SELECT id, kind, name, country FROM assets WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) n WHERE lower(name) = lower(n) OR name ILIKE '%' || n || '%') LIMIT 50`, [names.map(esc)])).rows : [];
  const assetIds = new Set<string>(assets.map((a: any) => a.id));
  const assetName = new Map<string, string>(assets.map((a: any) => [a.id, `${a.name}${a.kind ? ` (${a.kind})` : ''}`]));

  // 3. Projects in scope: same field, same client, same holder, a name that matches.
  for (const p of acc.projects.values()) {
    if (!visible(p)) continue;
    for (const a of p.asset_ids ?? []) if (assetIds.has(a)) reason(p.id, `same field: ${assetName.get(a) ?? a}`);
    if (p.client_id && orgIds.includes(p.client_id)) reason(p.id, `same client: ${orgNames.get(p.client_id) ?? p.client_id}`);
    const holder = clean((p.register as any)?.holder), partners = clean((p.register as any)?.partners);
    for (const n of names) {
      const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      if (re.test(p.name)) reason(p.id, `name matches "${n}"`);
      else if (holder && re.test(holder)) reason(p.id, `same holder: ${holder}`);
      else if (partners && re.test(partners)) reason(p.id, `partner named: ${n}`);
    }
    if (country && reasons.has(p.id) && p.country && p.country.toUpperCase() === country) reason(p.id, `same country: ${countryName(country).en}`);
  }
  // The same client on its own is not "seen before" (it would list every job for them); it supports a field, name or holder match.
  for (const [pid, why] of [...reasons]) if (why.every(w => w.startsWith('same client:') || w.startsWith('same country:'))) reasons.delete(pid);

  // 4. The first document against the firm's records, through the gateway in firm scope (never wider than Find).
  let hits: SearchHit[] = [];
  const firstItem = clean(input.first_item_id) || null;
  if (firstItem) {
    const it = (await db.query<any>('SELECT id, legal_tag, project_id, type, extracted FROM items WHERE id = $1 AND NOT hidden', [firstItem])).rows[0];
    if (it && canSee(acc, it.legal_tag, it.project_id, it)) {
      const text = (await db.query<{ text: string }>('SELECT text FROM chunks WHERE item_id = $1 AND current ORDER BY ordinal LIMIT 3', [firstItem])).rows.map(r => r.text).join(' ')
        || clean(it.extracted?.text ?? it.extracted?.summary ?? '');
      const q = text.slice(0, 1200);
      if (q.trim()) {
        const deps = opts.search === undefined ? searchDepsOrLexical() : (opts.search ?? {});
        const projects = await loadProjects(db);
        hits = (await hybridSearch(db, q, { kind: 'firm', label: 'firm' }, person, projects, deps, { k: opts.maxDocs ?? 6, now }))
          .filter(h => h.item_id !== firstItem && h.project_id !== exclude);
      }
    }
  }

  // 5. The matches, each with the record to open, and the paragraph.
  const matches: SeenBeforeMatch[] = [];
  const cites: string[] = [];
  const en: string[] = [], es: string[] = [];
  const projectRows = [...reasons.keys()].map(id => acc.projects.get(id)!).sort((a, b) => (reasons.get(b.id)!.length - reasons.get(a.id)!.length) || b.created_at.localeCompare(a.created_at)).slice(0, 6);
  for (const p of projectRows) {
    const newest = (await db.query<any>(`SELECT id, type, extracted, legal_tag FROM items WHERE project_id = $1 AND NOT hidden ORDER BY created_at DESC LIMIT 5`, [p.id])).rows.find((r: any) => canSee(acc, r.legal_tag, p.id, r));
    const run = newest ? null : (await db.query<any>(`SELECT id, legal_tag FROM runs WHERE project_id = $1 AND NOT hidden ORDER BY created_at DESC LIMIT 5`, [p.id])).rows.find((r: any) => canSee(acc, r.legal_tag, p.id));
    const cite = newest ? `doc:${newest.id}` : run ? `run:${run.id}` : null;
    if (cite) cites.push(cite);
    const why = reasons.get(p.id)!;
    matches.push({ kind: 'project', ref: `project:${p.id}`, name: p.name, project_id: p.id, reasons: why, cite });
    const client = p.client_id ? orgNames.get(p.client_id) ?? (await db.query<{ name: string }>('SELECT name FROM organisations WHERE id = $1', [p.client_id])).rows[0]?.name ?? p.client_id : null;
    const when = p.closed_at ? `closed ${String(p.closed_at).slice(0, 10)}` : `opened ${String(p.created_at).slice(0, 10)}`;
    en.push(`The firm already has "${p.name}"${client ? ` for ${client}` : ''} (${p.status}, ${p.stage}, ${when}; ${why.join('; ')}).${cite ? ` [${cite}]` : ''}`);
    es.push(`La firma ya tiene "${p.name}"${client ? ` para ${client}` : ''} (${p.status}, ${p.stage}, ${when}; ${why.join('; ')}).${cite ? ` [${cite}]` : ''}`);
  }
  for (const o of orgs) matches.push({ kind: 'organisation', ref: `organisation:${o.id}`, name: o.name, project_id: null, reasons: [orgIds.includes(o.id) ? 'named on the approach' : 'name matches', ...(o.kind ? [o.kind] : []), ...(o.country ? [countryName(o.country).en] : [])], cite: null });
  for (const h of hits.slice(0, opts.maxDocs ?? 6)) {
    const pname = acc.projects.get(h.project_id)?.name ?? h.project_id;
    matches.push({ kind: 'document', ref: h.ref, name: h.title ?? h.ref, project_id: h.project_id, reasons: ['the first document reads like this record'], cite: h.ref });
    cites.push(h.ref);
    const snip = h.snippet.replace(/\s+/g, ' ').trim();
    en.push(`On record in "${pname}": "${snip}" [${h.ref}]`);
    es.push(`Consta en "${pname}": "${snip}" [${h.ref}]`);
  }
  const paragraph = en.length ? { en: en.join(' '), es: es.join(' ') } : null;
  return { paragraph, matches, cites: uniq(cites) };
}

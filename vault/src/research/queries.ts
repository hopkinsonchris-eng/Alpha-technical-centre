/**
 * What a research run asks (wave 4, docs/vault-hub/wave4/05-markup.md §1.4.1). The names come
 * from the project itself (its name, client and country), from each attached field (the short
 * name, the Global Energy Monitor name and "name other") and from the operators those records
 * carry. The register's free text (source, thesis, next step) is never a search term. Short
 * names are anchored with the country and "oil field" so GDELT does not answer with noise.
 */
import type { TopicSpec } from '../miners/types.ts';

export interface ResearchField { id: string; name: string; kind: string; country: string | null; operator: string | null; props: Record<string, any> | null }
export interface ResearchProject { id: string; name: string; country: string | null; client_name: string | null; register: Record<string, unknown> | null }
export interface GdeltQuery { query: string; field_id: string | null; label: string }
export interface ResearchQueries {
  gdelt: GdeltQuery[];
  companies: string[];            // operators and the client: enrichment, signals and SEC filing search
  literature: TopicSpec[];        // one per field and per operator
  country: string | null;
}

const SHORT = 6;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const uniq = (xs: string[]) => { const seen = new Set<string>(); return xs.filter(x => { const k = x.toLowerCase(); if (!x || seen.has(k)) return false; seen.add(k); return true; }); };
const PLACEHOLDER = /^(new project|untitled|test|project)$/i;
/** "Petróleos de Venezuela (PDVSA) [100%]" → "Petróleos de Venezuela"; "Ecopetrol [100%]; Frontera [50%]" → two names. */
export function operatorNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return uniq(String(raw).split(/[;|]/).map(s => clean(s.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '')).replace(/\s*\d+(\.\d+)?%$/, '')).filter(s => s.length >= 3));
}

export function buildQueries(project: ResearchProject, fields: ResearchField[], countryName: string | null): ResearchQueries {
  const country = project.country ?? null;
  const cn = countryName ?? country ?? '';
  const gdelt: GdeltQuery[] = [];
  const anchor = (name: string) => (name.length < SHORT || /^\d/.test(name) ? `"${name}" oil field ${cn}`.trim() : cn ? `"${name}" ${cn}` : `"${name}"`);
  for (const f of fields) {
    const gem = f.props?.gem ?? {};
    const names = uniq([clean(f.name), clean(gem.name), clean(gem.name_other)].filter(n => n.length >= 3));
    for (const n of names) gdelt.push({ query: anchor(n), field_id: f.id, label: n });
  }
  const pname = clean(project.name);
  if (pname && !PLACEHOLDER.test(pname)) gdelt.push({ query: cn ? `"${pname}" ${cn}` : `"${pname}"`, field_id: null, label: pname });
  const companies = uniq([
    ...fields.flatMap(f => [...operatorNames(f.operator), ...operatorNames(f.props?.gem?.operator), ...operatorNames(f.props?.gem?.owners)]),
    ...(project.client_name ? [clean(project.client_name)] : []),
  ]);
  const literature: TopicSpec[] = [];
  for (const f of fields) {
    const n = clean(f.name);
    if (n.length < 3) continue;
    literature.push({ id: `research:${project.id}:${f.id}`, query: `${n} field ${cn} ${f.kind === 'block' ? 'block' : 'reservoir'}`.replace(/\s+/g, ' ').trim(), keywords: uniq([n, ...(f.props?.gem?.name ? [clean(f.props.gem.name)] : []), ...operatorNames(f.operator)]), negative: [] });
  }
  for (const c of companies) literature.push({ id: `research:${project.id}:co:${c.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, query: `${c} ${cn} oil gas`.replace(/\s+/g, ' ').trim(), keywords: [c], negative: [] });
  return { gdelt, companies, literature, country };
}

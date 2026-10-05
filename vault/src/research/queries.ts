/**
 * What a research run asks (wave 4, docs/vault-hub/wave4/05-markup.md §1.4.1; wave 7 §1.6, S17).
 * News and company lookups (World Monitor) take their names from the project itself (its name,
 * client and country), from each attached field (the short name, the Global Energy Monitor name
 * and "name other") and from the operators and register counterparties. The literature is
 * different: a paper is about a basin or a field, never about a company, so the literature
 * topics are built from the project's basin and field names (gazetteers, attached assets, the
 * register's own geology fields) and the country, and no organisation or counterparty name is
 * ever a literature query, keyword or context word. The register's free text (source, thesis,
 * next step) is never a search term. Short names are anchored with the country and "oil field"
 * so GDELT does not answer with noise.
 */
import type { FeedRecord, TopicSpec } from '../miners/types.ts';

export interface ResearchField { id: string; name: string; kind: string; country: string | null; operator: string | null; props: Record<string, any> | null;
  /** The basin this field sits in, when the asset hierarchy names one (the parent basin's name). */
  basin?: string | null }
export interface ResearchProject { id: string; name: string; country: string | null; client_name: string | null; register: Record<string, unknown> | null }
export interface GdeltQuery { query: string; field_id: string | null; label: string }
export interface ResearchQueries {
  gdelt: GdeltQuery[];
  companies: string[];            // operators and the client: enrichment, signals and SEC filing search (never the literature)
  literature: TopicSpec[];        // one per field and per basin
  country: string | null;
}

/** Papers filed per research run at most: the ones that name the basin or the field come first (S17). */
export const LITERATURE_CAP = 10;

const SHORT = 6;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const uniq = (xs: string[]) => { const seen = new Set<string>(); return xs.filter(x => { const k = x.toLowerCase(); if (!x || seen.has(k)) return false; seen.add(k); return true; }); };
const PLACEHOLDER = /^(new project|untitled|test|project)$/i;
/** "Petróleos de Venezuela (PDVSA) [100%]" → "Petróleos de Venezuela"; "Ecopetrol [100%]; Frontera [50%]" → two names. */
export function operatorNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return uniq(String(raw).split(/[;|]/).map(s => clean(s.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '')).replace(/\s*\d+(\.\d+)?%$/, '')).filter(s => s.length >= 3));
}

/** Register counterparties ("MinPetróleo / PDVSA", ["Chevron [30%]", "Eni"]) as company names; the lead at the firm and free text are never read. */
export function counterpartyNames(register: Record<string, unknown> | null | undefined): string[] {
  if (!register) return [];
  const raw = [register.holder, register.government, ...(Array.isArray(register.partners) ? register.partners : [])];
  return uniq(raw.flatMap(v => typeof v === 'string' ? v.split(/\s*[\/,]\s*/).flatMap(operatorNames) : []));
}

/** Words that make a paper about oil and gas; a strict topic needs one beside the field's name. No organisation is one. */
export const OIL_GAS_WORDS = ['oil', 'oilfield', 'oilfields', 'gas', 'petroleum', 'petróleo', 'petrolero', 'petrolera', 'reservoir', 'reservoirs', 'yacimiento', 'yacimientos', 'basin', 'cuenca', 'hydrocarbon', 'hydrocarbons', 'hidrocarburos', 'crude', 'crudo', 'waterflood', 'waterflooding', 'EOR', 'well log', 'drilling', 'perforación', 'formation', 'formación', 'heavy oil', 'bitumen', 'condensate', 'production', 'producción', 'exploration', 'exploración', 'upstream', 'E&P'];
/** The field's names as whole phrases, plus each distinctive part of a compound name ("Trico — Oficina" → Trico, Oficina). */
export function nameKeywords(names: unknown[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const n = clean(raw);
    if (n.length < 3) continue;
    out.push(n);
    for (const part of n.split(/\s*[—–\-\/,]\s*|\s+(?:y|and|&)\s+/i)) if (part.trim().length >= 4 && !/^\d+$/.test(part.trim())) out.push(part.trim());
  }
  return uniq(out);
}

/** The register keys that name geology rather than people or money. */
const GEOLOGY_KEYS = ['basin', 'play', 'formation', 'geology'];
const BASIN_WORD = /\s+(basin|cuenca)$/i;
/** "Llanos Basin" and "Llanos" are the same basin. */
const basinStem = (name: string) => clean(name).replace(BASIN_WORD, '');

/**
 * The basin names a project is about, in the order they are met: the parent basin of each attached field, the basin
 * the gazetteer record names, each attached basin asset, then the register's geology fields. Never an organisation.
 */
export function geologyNames(fields: ResearchField[], register: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const gem = f.props?.gem ?? {};
    if (f.kind === 'basin') out.push(clean(f.name), clean(gem.name));
    out.push(clean(f.basin), clean(f.props?.basin), clean(gem.basin));
  }
  for (const k of GEOLOGY_KEYS) { const v = register?.[k]; if (typeof v === 'string') out.push(clean(v)); }
  return uniq(out.filter(n => n.length >= 3));
}

/** A field or basin name as a whole phrase in the title or the abstract; the title counts for more. */
export function scorePaper(rec: Pick<FeedRecord, 'title' | 'text'>, basins: string[], fields: string[]): number {
  const title = ` ${clean(rec.title).toLowerCase()} `, text = ` ${clean(rec.text).toLowerCase()} `;
  const has = (hay: string, n: string) => n.length >= 3 && hay.includes(` ${n.toLowerCase()} `);
  let s = 0;
  for (const b of basins.map(basinStem)) { if (has(title, b)) s += 4; else if (has(text, b)) s += 2; }
  for (const f of fields) { if (has(title, f)) s += 1; }
  return s;
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
    ...counterpartyNames(project.register),
  ]);
  // Literature topics are strict (see screenPaper): the paper must name the field or basin (or a distinctive part of
  // its name) as a phrase and be about oil and gas or the country. Companies are not literature (S17).
  const basins = geologyNames(fields, project.register);
  const context = uniq([...OIL_GAS_WORDS, ...(cn ? [cn] : []), ...basins.map(basinStem)]);
  const literature: TopicSpec[] = [];
  for (const f of fields) {
    if (f.kind === 'basin') continue;
    const n = clean(f.name);
    if (n.length < 3) continue;
    literature.push({ id: `research:${project.id}:${f.id}`, query: `${n} field ${cn} ${f.kind === 'block' ? 'block' : 'reservoir'}`.replace(/\s+/g, ' ').trim(),
      keywords: nameKeywords([n, f.props?.gem?.name, f.props?.gem?.name_other]), negative: [], strict: true, context });
  }
  const seenBasin = new Set<string>();
  for (const b of basins) {
    const stem = basinStem(b);
    if (stem.length < 3 || seenBasin.has(stem.toLowerCase())) continue;
    seenBasin.add(stem.toLowerCase());
    const asset = fields.find(f => f.kind === 'basin' && basinStem(f.name).toLowerCase() === stem.toLowerCase());
    literature.push({ id: `research:${project.id}:${asset ? asset.id : 'basin:' + stem.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}`,
      query: `${stem} basin ${cn} petroleum geology`.replace(/\s+/g, ' ').trim(), keywords: nameKeywords([stem, b]), negative: [], strict: true, context: uniq([...OIL_GAS_WORDS, ...(cn ? [cn] : [])]) });
  }
  return { gdelt, companies, literature, country };
}

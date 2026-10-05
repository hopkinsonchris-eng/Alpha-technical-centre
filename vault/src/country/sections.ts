/**
 * The ten pack sections as the drafter sees them (wave 7 PR5; docs/vault-hub/wave7/04-step-changes.md P1, the table
 * "The sections, the source per section"; 05-markup.md §1.8, D67): for each section the question it answers, the
 * originals it may read, and the caveat line the card shows. Nothing here calls a model or the network.
 *
 * What a section may read, by construction:
 *   every section     the stored originals of its own registry sources (items under project 'firm', lt-public,
 *                     extracted.kind 'country-source', extracted.pack.section = this section)
 *   risk              the existing World Monitor card (GET /api/countries/:code/intel) is linked as a source chip,
 *                     never duplicated into sentences: a card reading is not a stored original and cannot be cited
 *   literature        the existing miners' papers (type 'paper', lt-public, project 'firm') whose title or topic
 *                     names one of the country's basins in vault/master/basins.json
 *   service           when it has no source: the Vault's own vendor organisations in the country, named in the caveat
 *                     and never in a sentence (no citation is possible, so no sentence is written)
 *   questions         derived from the other nine: no source, no model call
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.ts';
import { SECTIONS, type SectionId } from './types.ts';

export interface SectionSpec {
  id: SectionId;
  title: { en: string; es: string };
  ttl_days: number;
  /** The question the section answers (P1's table), put to the model verbatim. */
  question: { en: string; es: string };
  /** What the section may read, in words, for the connector and the card. */
  reads: { en: string; es: string };
  /** The caveat line the card shows under the section; null when none. */
  caveat: { en: string; es: string } | null;
}

const ORIENTATION = { en: 'orientation for screening; verify against the instrument in force', es: 'orientación para la evaluación preliminar; verifique contra el instrumento vigente' };
export const NO_PUBLIC_REGISTER = { en: 'no public register; the firm\'s contacts here are', es: 'sin registro público; los contactos de la firma aquí son' };
export const NONE_RECORDED = { en: 'none recorded', es: 'ninguno registrado' };

const T = Object.fromEntries(SECTIONS.map(s => [s.id, { en: s.en, es: s.es }])) as Record<SectionId, { en: string; es: string }>;
const TTL = Object.fromEntries(SECTIONS.map(s => [s.id, s.ttl_days])) as Record<SectionId, number>;
const spec = (id: SectionId, question: { en: string; es: string }, reads: { en: string; es: string }, caveat: { en: string; es: string } | null = null): SectionSpec => ({ id, title: T[id], ttl_days: TTL[id], question, reads, caveat });

export const SECTION_SPECS: Record<SectionId, SectionSpec> = {
  legal: spec('legal',
    { en: 'What is the hydrocarbon law, which are the main regulations, when was the last amendment, and who owns the resources in the ground?', es: '¿Cuál es la ley de hidrocarburos, cuáles son los reglamentos principales, cuándo fue la última reforma y a quién pertenecen los recursos en el subsuelo?' },
    { en: 'the Chambers and Legal 500 chapters for the jurisdiction, the law itself from the regulator, and the EITI country page, as fetched and stored', es: 'los capítulos de Chambers y Legal 500 para la jurisdicción, la ley misma del regulador y la página de país del EITI, tal como fueron descargados y almacenados' },
    ORIENTATION),
  licensing: spec('licensing',
    { en: 'How is acreage awarded (round, permanent offer, open door, direct negotiation), what is the current round, and what are its stages and dates?', es: '¿Cómo se adjudican las áreas (ronda, oferta permanente, puerta abierta, negociación directa), cuál es la ronda en curso y cuáles son sus etapas y fechas?' },
    { en: 'the regulator\'s own round page and schedule as fetched and stored, and the confirmed round events', es: 'la página de la ronda del regulador y su cronograma tal como fueron descargados y almacenados, y los eventos de ronda confirmados' }),
  fiscal: spec('fiscal',
    { en: 'What are the royalty, cost recovery, profit split, income tax, bonuses, ring-fencing and stability terms, and from which contract or regime do they come?', es: '¿Cuáles son los términos de regalía, recuperación de costos, reparto de utilidades, impuesto a la renta, bonos, cerco fiscal y estabilidad, y de qué contrato o régimen provienen?' },
    { en: 'the published contracts and model contract from ResourceContracts and the regulator, the tax summaries and the legal guides, as fetched and stored', es: 'los contratos publicados y el contrato modelo de ResourceContracts y del regulador, los resúmenes tributarios y las guías legales, tal como fueron descargados y almacenados' },
    ORIENTATION),
  companies: spec('companies',
    { en: 'Who operates and holds licences there, who are the partners, and what is the national oil company?', es: '¿Quién opera y tiene licencias allí, quiénes son los socios y cuál es la petrolera estatal?' },
    { en: 'the Global Energy Monitor tracker release, the EITI company lists and the contract parties, as fetched and stored', es: 'la versión del rastreador de Global Energy Monitor, las listas de empresas del EITI y las partes de los contratos, tal como fueron descargados y almacenados' }),
  service: spec('service',
    { en: 'Who can drill, log, test and build there, and what are the local-content rules?', es: '¿Quién puede perforar, registrar, probar y construir allí, y cuáles son las reglas de contenido local?' },
    { en: 'a public local-content or supplier register where one exists, as fetched and stored; otherwise nothing is drafted and the firm\'s own contacts are named', es: 'un registro público de contenido local o de proveedores donde exista, tal como fue descargado y almacenado; de lo contrario no se redacta nada y se nombran los contactos de la firma' },
    NO_PUBLIC_REGISTER),
  regulator: spec('regulator',
    { en: 'Who regulates, who holds the data, how does one get into the data room, and what does it cost?', es: '¿Quién regula, quién custodia los datos, cómo se accede a la sala de datos y cuánto cuesta?' },
    { en: 'the regulator\'s and the national data repository\'s pages, as fetched and stored', es: 'las páginas del regulador y del repositorio nacional de datos, tal como fueron descargadas y almacenadas' }),
  production: spec('production',
    { en: 'What are the country\'s production, reserves and market totals, and what is the trend?', es: '¿Cuáles son los totales de producción, reservas y mercado del país, y cuál es la tendencia?' },
    { en: 'the EIA, JODI, Energy Institute and OPEC series as fetched and stored (never an IEA dataset)', es: 'las series de EIA, JODI, Energy Institute y OPEP tal como fueron descargadas y almacenadas (nunca un conjunto de datos de la AIE)' }),
  risk: spec('risk',
    { en: 'What is the country\'s risk and context for the firm\'s work: stability, sanctions, advisories, events and headlines?', es: '¿Cuál es el riesgo y el contexto del país para el trabajo de la firma: estabilidad, sanciones, avisos, eventos y titulares?' },
    { en: 'the stored originals of its own sources; the existing World Monitor card is linked, not duplicated', es: 'los originales almacenados de sus propias fuentes; la tarjeta de World Monitor existente se enlaza, no se duplica' }),
  literature: spec('literature',
    { en: 'What technical literature exists on the country\'s basins, and what does it say?', es: '¿Qué literatura técnica existe sobre las cuencas del país y qué dice?' },
    { en: 'the papers the miners already filed for the country\'s basins (metadata and abstract only), plus the stored originals of its own sources', es: 'los artículos que los mineros ya archivaron para las cuencas del país (solo metadatos y resumen), más los originales almacenados de sus propias fuentes' }),
  questions: spec('questions',
    { en: 'What did no source answer, and who should be asked?', es: '¿Qué no respondió ninguna fuente y a quién habría que preguntar?' },
    { en: 'derived from the other nine sections: their open questions and the sections with no reachable source', es: 'derivada de las otras nueve secciones: sus preguntas abiertas y las secciones sin fuente alcanzable' }),
};

/** The caveat line a section's card shows; the service line names the firm's own contacts when there is no register. */
export function caveatFor(section: SectionId, opts: { contacts?: string[] } = {}): { en: string; es: string } | null {
  const c = SECTION_SPECS[section].caveat;
  if (!c) return null;
  if (section !== 'service') return c;
  const names = (opts.contacts ?? []).filter(Boolean);
  return { en: `${c.en} ${names.length ? names.join(', ') : NONE_RECORDED.en}`, es: `${c.es} ${names.length ? names.join(', ') : NONE_RECORDED.es}` };
}

/** The Vault's own vendor organisations in a country, by name: what the service caveat names when there is no register. */
export async function vendorContacts(db: Db, country: string): Promise<string[]> {
  return (await db.query<{ name: string }>("SELECT name FROM organisations WHERE kind = 'vendor' AND upper(country) = $1 ORDER BY name LIMIT 12", [country.toUpperCase()])).rows.map(r => r.name);
}

/* ── the extra originals two sections may read ─────────────────────── */

const BASINS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../master/basins.json');
let basinsCache: { id: string; name: string; country: string }[] | undefined;
/** The basin names of a country from vault/master/basins.json (read once). */
export function basinsOf(country: string): { id: string; name: string }[] {
  if (!basinsCache) {
    try { basinsCache = (JSON.parse(readFileSync(BASINS_PATH, 'utf8')) as any[]).filter(b => b?.kind === 'basin' && b.name && b.country).map(b => ({ id: String(b.id), name: String(b.name), country: String(b.country).toUpperCase() })); }
    catch { basinsCache = []; }
  }
  return basinsCache.filter(b => b.country === country.toUpperCase()).map(b => ({ id: b.id, name: b.name }));
}

export interface ExtraOriginal { id: string; title: string; source_id: string | null; fetched_at: string | null; version: number }

/**
 * The literature section's extra originals: the miners' papers (public, under the firm project) whose title or topic
 * names a basin of the country, newest first. They are stored originals, so a sentence may cite them.
 */
export async function literatureOriginals(db: Db, country: string, limit = 12): Promise<ExtraOriginal[]> {
  const basins = basinsOf(country);
  if (!basins.length) return [];
  const rows = (await db.query<any>(
    `SELECT i.id::text AS id, i.title, i.version, i.authored_at, i.created_at, i.tags, i.origin->>'source' AS source, i.origin->>'fetched_at' AS fetched_at
       FROM items i JOIN legal_tags lt ON lt.id = i.legal_tag
      WHERE i.type = 'paper' AND NOT i.hidden AND lt.classification = 'public' AND i.project_id = 'firm'
        AND NOT EXISTS (SELECT 1 FROM items n WHERE n.supersedes = i.id)
      ORDER BY coalesce(i.authored_at, i.created_at) DESC LIMIT 2000`)).rows;
  const names = basins.map(b => b.name.toLowerCase());
  const slugs = basins.map(b => b.id.replace(/^basin:/, '').toLowerCase());
  const out: ExtraOriginal[] = [];
  for (const r of rows) {
    const title = String(r.title ?? '').toLowerCase();
    const tags: string[] = (r.tags ?? []).map((t: string) => t.toLowerCase());
    if (names.some(n => title.includes(n)) || tags.some(t => slugs.some(s => t === `topic:${s}` || t.endsWith(`:${s}`)))) out.push({ id: r.id, title: r.title, source_id: r.source ?? null, fetched_at: r.fetched_at ?? null, version: Number(r.version) || 1 });
    if (out.length >= limit) break;
  }
  return out;
}

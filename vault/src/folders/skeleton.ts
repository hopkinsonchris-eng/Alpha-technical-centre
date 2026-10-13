/**
 * The project skeleton (wave 9, docs/vault-hub/wave9/01-project-folders.md). Every project, new or old, has the same
 * numbered folders, read in the order a due-diligence review reads them. The skeleton is a view: nothing is created
 * per project and nothing moves; a record's place is its current row in `folder_filings`.
 *
 * Keys are paths: 'legal', 'subsurface/wells', 'subsurface/wells/<asset id>', 'apex/<tool id>'. The per-asset folders
 * come from the assets attached to the project (attach a well, get its folder); the per-app folders from the catalog.
 * Legal and Financial are partners-only: an associate never sees them, and a record filed there becomes partners-only
 * everywhere (folders/classify.ts).
 */

export type DocKind =
  | 'nda' | 'joa' | 'farmout-agreement' | 'contract' | 'corporate-record' | 'insurance'
  | 'licence-psc' | 'work-programme' | 'regulatory-filing'
  | 'proposal' | 'purchase-order' | 'offtake'
  | 'invoice' | 'expense' | 'timesheet' | 'bank-statement' | 'financial-model'
  | 'basin-study' | 'field-study' | 'reserves-report' | 'reservoir-study' | 'pvt-report' | 'core-analysis' | 'petrophysics'
  | 'well-log' | 'end-of-well-report' | 'drilling-report' | 'production-data' | 'seismic-survey'
  | 'facilities-description' | 'pipeline'
  | 'hse-plan' | 'environmental-assessment' | 'incident-report'
  | 'paper' | 'news' | 'company-profile' | 'correspondence' | 'deliverable' | 'other';

export const DOC_KINDS: Record<DocKind, [string, string]> = {
  nda: ['NDA', 'NDA'], joa: ['Joint operating agreement', 'Acuerdo de operación conjunta'], 'farmout-agreement': ['Farm-out agreement', 'Acuerdo de farm-out'],
  contract: ['Contract', 'Contrato'], 'corporate-record': ['Corporate record', 'Registro societario'], insurance: ['Insurance', 'Seguro'],
  'licence-psc': ['Licence or PSC', 'Licencia o contrato de producción compartida'], 'work-programme': ['Work programme', 'Programa de trabajo'],
  'regulatory-filing': ['Regulatory filing', 'Presentación regulatoria'],
  proposal: ['Proposal', 'Propuesta'], 'purchase-order': ['Purchase order', 'Orden de compra'], offtake: ['Offtake or marketing', 'Comercialización'],
  invoice: ['Invoice', 'Factura'], expense: ['Expense', 'Gasto'], timesheet: ['Timesheet', 'Hoja de horas'], 'bank-statement': ['Bank statement', 'Extracto bancario'],
  'financial-model': ['Financial model', 'Modelo financiero'],
  'basin-study': ['Basin study', 'Estudio de cuenca'], 'field-study': ['Field study', 'Estudio de campo'], 'reserves-report': ['Reserves report', 'Informe de reservas'],
  'reservoir-study': ['Reservoir study', 'Estudio de yacimiento'], 'pvt-report': ['PVT report', 'Informe PVT'], 'core-analysis': ['Core analysis', 'Análisis de núcleos'],
  petrophysics: ['Petrophysics', 'Petrofísica'], 'well-log': ['Well logs', 'Registros de pozo'], 'end-of-well-report': ['End of well report', 'Informe final de pozo'],
  'drilling-report': ['Drilling report', 'Informe de perforación'], 'production-data': ['Production data', 'Datos de producción'], 'seismic-survey': ['Seismic survey', 'Levantamiento sísmico'],
  'facilities-description': ['Facilities description', 'Descripción de instalaciones'], pipeline: ['Pipeline or export route', 'Oleoducto o ruta de exportación'],
  'hse-plan': ['HSE plan', 'Plan de SSA'], 'environmental-assessment': ['Environmental assessment', 'Evaluación ambiental'], 'incident-report': ['Incident report', 'Informe de incidente'],
  paper: ['Paper', 'Artículo'], news: ['News', 'Noticia'], 'company-profile': ['Company profile', 'Perfil de empresa'], correspondence: ['Correspondence', 'Correspondencia'],
  deliverable: ['Deliverable', 'Entregable'], other: ['Other', 'Otro'],
};
export const isDocKind = (k: unknown): k is DocKind => typeof k === 'string' && Object.prototype.hasOwnProperty.call(DOC_KINDS, k);

/** A document a folder expects; `per_asset` checks it in each asset's own folder (every well its logs). */
export interface Expect { kind: DocKind; per_asset?: boolean }

interface SlotDef { key: string; n?: string; en: string; es: string; partners_only?: boolean; expects?: Expect[]; children?: SlotDef[]; assets?: 'field' | 'reservoir' | 'well'; apps?: boolean }

export const SKELETON: SlotDef[] = [
  { key: 'unsorted', n: '00', en: 'Unsorted', es: 'Sin clasificar' },
  { key: 'legal', n: '01', en: 'Legal', es: 'Legal', partners_only: true, expects: [{ kind: 'nda' }, { kind: 'joa' }] },
  { key: 'government', n: '02', en: 'Government & regulatory', es: 'Gobierno y regulación', expects: [{ kind: 'licence-psc' }, { kind: 'work-programme' }] },
  { key: 'commercial', n: '03', en: 'Commercial & contracts', es: 'Comercial y contratos' },
  { key: 'financial', n: '04', en: 'Financial', es: 'Finanzas', partners_only: true },
  { key: 'subsurface', n: '05', en: 'Subsurface', es: 'Subsuelo', children: [
    { key: 'subsurface/basin', en: 'Basin & regional', es: 'Cuenca y regional' },
    { key: 'subsurface/fields', en: 'Fields', es: 'Campos', assets: 'field', expects: [{ kind: 'reserves-report', per_asset: true }] },
    { key: 'subsurface/reservoirs', en: 'Reservoirs', es: 'Yacimientos', assets: 'reservoir' },
    { key: 'subsurface/wells', en: 'Wells', es: 'Pozos', assets: 'well', expects: [{ kind: 'well-log', per_asset: true }, { kind: 'end-of-well-report', per_asset: true }] },
    { key: 'subsurface/seismic', en: 'Seismic & geophysics', es: 'Sísmica y geofísica', expects: [{ kind: 'seismic-survey' }] },
  ] },
  { key: 'facilities', n: '06', en: 'Facilities & infrastructure', es: 'Instalaciones e infraestructura', expects: [{ kind: 'facilities-description' }] },
  { key: 'hse', n: '07', en: 'HSE', es: 'SSA', expects: [{ kind: 'environmental-assessment' }] },
  { key: 'apex', n: '08', en: 'APEX apps', es: 'Aplicaciones APEX', apps: true },
  { key: 'research', n: '09', en: 'Papers & research', es: 'Artículos e investigación', children: [
    { key: 'research/papers', en: 'Papers', es: 'Artículos' },
    { key: 'research/news', en: 'News & web', es: 'Noticias y web' },
    { key: 'research/companies', en: 'Company intelligence', es: 'Inteligencia de empresas' },
  ] },
  { key: 'correspondence', n: '10', en: 'Correspondence', es: 'Correspondencia' },
  { key: 'deliverables', n: '11', en: 'Deliverables', es: 'Entregables' },
];

export const PARTNERS_FOLDERS = new Set(SKELETON.filter(s => s.partners_only).map(s => s.key));
/** True for a key in Legal or Financial (or below them). */
export const isPartnersFolder = (key: string) => PARTNERS_FOLDERS.has(key.split('/')[0]);

export interface FolderAsset { id: string; name: string; kind: string }
export interface FolderApp { id: string; name: string }
export interface FolderNode {
  key: string; n: string | null; en: string; es: string; partners_only: boolean;
  expects: Expect[]; asset_id: string | null; app_id: string | null; children: FolderNode[];
}

const ASSET_SLOT: Record<string, string> = { field: 'subsurface/fields', reservoir: 'subsurface/reservoirs', well: 'subsurface/wells' };
/** The folder an attached asset's own records go to: a field, reservoir or well gets its own; a basin the regional folder; a block Government. */
export function assetFolder(a: { id: string; kind: string }): string | null {
  if (ASSET_SLOT[a.kind]) return `${ASSET_SLOT[a.kind]}/${a.id}`;
  if (a.kind === 'basin') return 'subsurface/basin';
  if (a.kind === 'block') return 'government';
  return null;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** The skeleton for one project: its asset folders and app folders filled in. `partners` false drops Legal and Financial. */
export function buildSkeleton(assets: FolderAsset[], apps: FolderApp[], partners: boolean): FolderNode[] {
  const node = (s: SlotDef): FolderNode => {
    const children = (s.children ?? []).map(node);
    if (s.assets) for (const a of assets.filter(a => a.kind === s.assets).sort((x, y) => collator.compare(x.name, y.name)))
      children.push({ key: `${s.key}/${a.id}`, n: null, en: a.name, es: a.name, partners_only: false, expects: (s.expects ?? []).filter(e => e.per_asset), asset_id: a.id, app_id: null, children: [] });
    if (s.apps) for (const t of apps) children.push({ key: `apex/${t.id}`, n: null, en: t.name, es: t.name, partners_only: false, expects: [], asset_id: null, app_id: t.id, children: [] });
    return { key: s.key, n: s.n ?? null, en: s.en, es: s.es, partners_only: !!s.partners_only, expects: (s.expects ?? []).filter(e => !e.per_asset), asset_id: null, app_id: null, children };
  };
  return SKELETON.filter(s => partners || !s.partners_only).map(node);
}

/** Every folder key a record may be filed into for this project, with its label path ("05 Subsurface › Wells › A-1"). */
export function folderLabels(assets: FolderAsset[], apps: FolderApp[], partners = true): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (nodes: FolderNode[], prefix: string) => {
    for (const f of nodes) {
      const label = prefix + (f.n ? `${f.n} ` : '') + f.en;
      out.set(f.key, label);
      walk(f.children, label + ' › ');
    }
  };
  walk(buildSkeleton(assets, apps, partners), '');
  return out;
}

/** The folder a document kind belongs in when no asset narrows it. */
export const KIND_FOLDER: Record<DocKind, string> = {
  nda: 'legal', joa: 'legal', 'farmout-agreement': 'legal', contract: 'legal', 'corporate-record': 'legal', insurance: 'legal',
  'licence-psc': 'government', 'work-programme': 'government', 'regulatory-filing': 'government',
  proposal: 'commercial', 'purchase-order': 'financial', offtake: 'commercial',
  invoice: 'financial', expense: 'financial', timesheet: 'financial', 'bank-statement': 'financial', 'financial-model': 'financial',
  'basin-study': 'subsurface/basin', 'field-study': 'subsurface/fields', 'reserves-report': 'subsurface/fields', 'reservoir-study': 'subsurface/reservoirs',
  'pvt-report': 'subsurface/reservoirs', 'core-analysis': 'subsurface/reservoirs', petrophysics: 'subsurface/wells', 'well-log': 'subsurface/wells',
  'end-of-well-report': 'subsurface/wells', 'drilling-report': 'subsurface/wells', 'production-data': 'subsurface/fields', 'seismic-survey': 'subsurface/seismic',
  'facilities-description': 'facilities', pipeline: 'facilities',
  'hse-plan': 'hse', 'environmental-assessment': 'hse', 'incident-report': 'hse',
  paper: 'research/papers', news: 'research/news', 'company-profile': 'research/companies', correspondence: 'correspondence',
  deliverable: 'deliverables', other: 'unsorted',
};
/** Kinds that narrow to one asset's folder when the record names exactly one attached asset of that level. */
export const KIND_ASSET_LEVEL: Partial<Record<DocKind, 'field' | 'reservoir' | 'well'>> = {
  'reserves-report': 'field', 'field-study': 'field', 'production-data': 'field',
  'reservoir-study': 'reservoir', 'pvt-report': 'reservoir', 'core-analysis': 'reservoir',
  'well-log': 'well', 'end-of-well-report': 'well', 'drilling-report': 'well', petrophysics: 'well',
};

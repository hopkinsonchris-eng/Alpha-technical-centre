/**
 * Filing a project's records into the skeleton (wave 9, docs/vault-hub/wave9/01-project-folders.md §3).
 *
 *   1. Rules first, at full confidence: the record's type, its source, the words in its title, file name and WorkDrive
 *      folder, and the attached assets it names. An invoice is Financial; a GDELT note News & web; "Frost 2 Openhole
 *      Logs.zip" is a well log of the attached well Frost 2.
 *   2. Otherwise, with a provider, the model reads the title, the WorkDrive folder and the first pages and picks one
 *      folder from this project's own list, a document kind and a verbatim quote. A folder outside the list or a quote
 *      the record does not contain is refused. At 0.8 or more it files; below, the record stays in Unsorted and a
 *      `folder` card waits in the queue with the suggestion.
 *   3. The people's own moves are the model's examples (only from records of the same client), so a correction made
 *      once is not made again.
 *
 * Filings are append-only: a new filing supersedes the record's current row. A record filed into Legal or Financial
 * becomes partners-only everywhere (items.extracted.partners_only and its chunks), which canSee and the gateway
 * already honour; moving it out does not lift that, a partner does.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { processSpendGbp } from '../llm/spend-guard.ts';
import { buildCatalog } from '../catalog.ts';
import { quoteInText } from '../ingest/legal-finance.ts';
import {
  DOC_KINDS, KIND_ASSET_LEVEL, KIND_FOLDER, assetFolder, folderLabels, isDocKind, isPartnersFolder,
  type DocKind, type FolderApp, type FolderAsset,
} from './skeleton.ts';

export type FilingMethod = 'rule' | 'model' | 'manual';
export interface Filing { folder: string; doc_kind: DocKind | null; method: FilingMethod; confidence: number | null; quote: string | null; reason: string | null }
export interface FileTarget {
  id: string; type: string; title: string; client_id: string | null; project_id: string;
  origin: any; extracted: any; asset_ids: string[];
}

/** Model filings at or above this confidence file themselves; below it they wait in the queue. */
export const AUTO_FILE_CONFIDENCE = 0.8;
const TEXT_CHARS = 4000;
const EXAMPLES = 12;

/* ── the apps (08 APEX apps) ─────────────────────────────────────────── */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
let catalogCache: { at: number; tools: { id: string; name: string; kind: string }[] } | null = null;
function catalogTools(): { id: string; name: string; kind: string }[] {
  if (!catalogCache || Date.now() - catalogCache.at > 10 * 60_000) {
    let tools: { id: string; name: string; kind: string }[] = [];
    try { tools = buildCatalog(REPO_ROOT).tools.map(t => ({ id: t.id, name: t.name, kind: t.kind })); } catch { tools = []; }
    catalogCache = { at: Date.now(), tools };
  }
  return catalogCache.tools;
}
/** Every APEX app in the catalog, then any other tool that has runs on the project (`jobs`), by name. */
export function projectApps(jobs: string[] = []): FolderApp[] {
  const tools = catalogTools();
  const apex = tools.filter(t => /^APEX\b/.test(t.name) && (t.kind === 'browser-tool' || t.kind === 'external-app'));
  const out = new Map<string, FolderApp>(apex.map(t => [t.id, { id: t.id, name: t.name }]));
  for (const j of jobs) if (!out.has(j)) out.set(j, { id: j, name: tools.find(t => t.id === j)?.name ?? j });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function projectAssets(db: Db, projectId: string): Promise<FolderAsset[]> {
  return (await db.query<FolderAsset>('SELECT a.id, a.name, a.kind FROM assets a JOIN projects p ON a.id = ANY(p.asset_ids) WHERE p.id = $1', [projectId])).rows;
}

/* ── 1. rules ────────────────────────────────────────────────────────── */

const RESEARCH_COMPANY = new Set(['company-enrichment', 'company-signals', 'sec-filings']);
const LITERATURE = new Set(['openalex', 'semantic-scholar', 'crossref']);
const TYPE_KIND: Record<string, DocKind> = {
  invoice: 'invoice', expense: 'expense', timesheet: 'timesheet', 'bank-statement': 'bank-statement', 'purchase-order': 'purchase-order',
  nda: 'nda', 'corporate-record': 'corporate-record', insurance: 'insurance', licence: 'licence-psc', 'regulatory-filing': 'regulatory-filing', proposal: 'proposal',
};
/** Words in a title, file name or folder that say what a document is; the first match wins, so the narrow ones come first. */
const KIND_WORDS: [DocKind, RegExp][] = [
  ['joa', /\bJOA\b|joint operating agreement/i],
  ['farmout-agreement', /farm[- ]?(out|in)\s+agreement/i],
  ['nda', /\bNDA\b|non[- ]disclosure|confidentiality agreement/i],
  ['licence-psc', /\bE?PSC\b|production sharing|concession agreement|\blicen[cs]e agreement\b|exploration licen[cs]e/i],
  ['work-programme', /work\s+program(me)?\b/i],
  ['end-of-well-report', /end[- ]of[- ]well|\bEOWR\b|well completion report|final well report/i],
  ['reserves-report', /\breserves?\s+(report|audit|evaluation|assessment)\b|\bCPR\b|competent person/i],
  ['pvt-report', /\bPVT\b/],
  ['core-analysis', /core analysis|\bSCAL\b|\bRCA\b/],
  ['drilling-report', /drilling report|daily drilling|\bDDR\b/],
  ['seismic-survey', /seismic|\bSEG-?Y\b|\.(sgy|segy)\b/i],
  ['well-log', /\.(las|dlis|lis)$|(^|[\s/_-])(open\s?hole|cased\s?hole|mud)?\s?logs?([\s/_.-]|$)/i],
  ['production-data', /production\s+(data|history|report|profile)/i],
  ['environmental-assessment', /\bESIA\b|[Ee]nvironmental ([Ii]mpact|and [Ss]ocial|[Bb]aseline)/],   // not "EIA": that is the US Energy Information Administration as often
  ['incident-report', /incident report/i],
  ['hse-plan', /\bH?SSE\b/],
  ['pipeline', /pipeline|export route|\bterminal\b/i],
  ['facilities-description', /facilit(y|ies)|flow\s?station|process(ing)? plant|\bCPF\b|\bFPSO\b/i],
  ['financial-model', /financial model|cash\s?flow model|economic(s)? model/i],
  ['invoice', /\binvoice\b/i],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The attached assets a piece of text names as whole words (names of three letters or more). */
export function namedAssets(text: string, assets: FolderAsset[]): FolderAsset[] {
  return assets.filter(a => a.name.length >= 3 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(a.name)}(?![\\p{L}\\p{N}])`, 'iu').test(text));
}

const wdPath = (t: FileTarget): string => (typeof t.extracted?.workdrive?.path === 'string' ? t.extracted.workdrive.path : '');
const fileName = (t: FileTarget): string => (typeof t.extracted?.filename === 'string' ? t.extracted.filename : '');

/** The one asset of `level` the record is about: named in its words, else its own asset_ids; null when none or several. */
function oneAsset(t: FileTarget, assets: FolderAsset[], level: string | null): FolderAsset | null {
  const pool = level ? assets.filter(a => a.kind === level) : assets.filter(a => a.kind === 'field' || a.kind === 'reservoir' || a.kind === 'well');
  const named = namedAssets(`${t.title}\n${fileName(t)}\n${wdPath(t)}`, pool);
  // The deepest level named wins (a well over its field), and only when exactly one asset of that level is named.
  for (const lv of ['well', 'reservoir', 'field']) { const m = named.filter(a => a.kind === lv); if (m.length === 1) return m[0]; if (m.length > 1) return null; }
  const own = pool.filter(a => t.asset_ids.includes(a.id));
  return own.length === 1 ? own[0] : null;
}

const rule = (folder: string, doc_kind: DocKind | null, reason: string): Filing => ({ folder, doc_kind, method: 'rule', confidence: 1, quote: null, reason });

/** The rule filing for a record, or null when the rules cannot tell and the model (or a person) must. */
export function ruleFiling(t: FileTarget, assets: FolderAsset[]): Filing | null {
  const src = String(t.origin?.source ?? '');
  const adapter = String(t.origin?.adapter ?? t.extracted?.source ?? '');
  if (t.type === 'email' || src === 'zoho-mail' || src === 'gmail') return rule('correspondence', 'correspondence', 'Captured mail');
  if (src === 'research') {
    if (RESEARCH_COMPANY.has(adapter)) return rule('research/companies', 'company-profile', `Research: ${adapter}`);
    if (t.type === 'paper' || LITERATURE.has(adapter)) return rule('research/papers', 'paper', `Research: ${adapter || 'literature'}`);
    return rule('research/news', 'news', `Research: ${adapter || 'web'}`);
  }
  if (t.type === 'paper' || LITERATURE.has(src)) return rule('research/papers', 'paper', `Literature: ${src || 'paper'}`);
  if (t.extracted?.kind === 'dossier') {
    const a = assets.find(x => x.id === t.extracted?.asset_id);
    return rule((a && assetFolder(a)) || 'subsurface/fields', 'field-study', `Dossier of ${t.extracted?.asset_name ?? 'an asset'}`);
  }
  const words = `${t.title}\n${fileName(t)}\n${wdPath(t)}`;
  let kind: DocKind | null = TYPE_KIND[t.type] ?? null;
  let why = kind ? `Record type: ${t.type}` : '';
  if (!kind && t.type === 'contract') { kind = (KIND_WORDS.find(([k, re]) => (k === 'joa' || k === 'farmout-agreement') && re.test(words))?.[0]) ?? 'contract'; why = 'Record type: contract'; }
  if (!kind) {
    // The title and file name speak first; the WorkDrive folder only when they say nothing.
    const own = `${t.title}\n${fileName(t)}`;
    const hit = KIND_WORDS.find(([, re]) => re.test(own)) ?? KIND_WORDS.find(([, re]) => wdPath(t).split('/').some(seg => re.test(seg)));
    if (hit) { kind = hit[0]; why = `Named as ${DOC_KINDS[hit[0]][0].toLowerCase()}`; }
  }
  if (!kind && (src === 'assistant' || src === 'tool') && ['letter', 'report', 'evaluation', 'presentation'].includes(t.type)) return rule('deliverables', 'deliverable', 'Written by the firm');
  if (kind) {
    const level = KIND_ASSET_LEVEL[kind] ?? null;
    const a = level ? oneAsset(t, assets, level) : null;
    return rule(a ? assetFolder(a)! : KIND_FOLDER[kind], kind, a ? `${why}; about ${a.name}` : why);
  }
  // A file named after exactly one attached well, reservoir or field is that asset's file.
  const a = oneAsset(t, assets, null);
  if (a) return rule(assetFolder(a)!, null, `About ${a.name}`);
  return null;
}

/* ── 2. the model ────────────────────────────────────────────────────── */

const SYSTEM = [
  "You file one document into an oil and gas project's folders. Reply with one JSON object and nothing else.",
  'Shape: {"folder":"<one key from the folder list>","doc_kind":"<one kind from the kind list>","confidence":<0 to 1>,"quote":"<a few exact words from the document, its title, file name or folder that decide it>","reason":"<one short sentence>"}.',
  'Choose only a folder key from the list. A document about one well, reservoir or field goes in that asset\'s own folder. Use "unsorted" when nothing fits. Never invent a quote: copy it exactly.',
].join('\n');

export interface ModelAnswer { filing: Filing | null; refused: string | null; spent?: boolean }

function parseJsonObject(s: string): any {
  const body = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

export interface Example { title: string; path: string | null; folder: string }

/** The model's filing, checked: a folder from `labels`, a kind from the list (else 'other'), a quote found verbatim. */
export async function modelFiling(t: FileTarget, text: string, labels: Map<string, string>, examples: Example[], provider: LlmProvider): Promise<ModelAnswer> {
  const doc = [`Title: ${t.title}`, fileName(t) ? `File name: ${fileName(t)}` : '', wdPath(t) ? `WorkDrive folder: ${wdPath(t)}` : '', `Record type: ${t.type}`, '', text.slice(0, TEXT_CHARS)].filter(s => s !== '').join('\n');
  const user = [
    'Folders (key — label):', ...[...labels].map(([k, l]) => `${k} — ${l}`), '',
    'Kinds:', Object.keys(DOC_KINDS).join(', '), '',
    ...(examples.length ? ['People filed these records here before (title | folder in WorkDrive → folder):', ...examples.map(e => `${e.title} | ${e.path ?? '-'} → ${e.folder}`), ''] : []),
    'Document:', doc,
  ].join('\n');
  let raw: any = null;
  try {
    const r = await provider.complete({ system: SYSTEM, messages: [{ role: 'user', content: user }], maxTokens: 300, effort: 'low', purpose: 'folders.file' });
    raw = parseJsonObject(r.text);
  } catch (e) { return { filing: null, refused: `the model call failed: ${(e as Error).message}` }; }
  if (!raw || typeof raw !== 'object') return { filing: null, refused: 'the model gave no answer' };
  const folder = typeof raw.folder === 'string' ? raw.folder.trim() : '';
  if (!labels.has(folder)) return { filing: null, refused: `the model chose a folder that is not in this project ("${folder.slice(0, 80)}")` };
  const quote = typeof raw.quote === 'string' ? raw.quote.replace(/\s+/g, ' ').trim() : '';
  if (quote.length < 3 || !quoteInText(doc, quote)) return { filing: null, refused: 'the model quoted words the document does not contain' };
  const conf = Number(raw.confidence);
  return { filing: { folder, doc_kind: isDocKind(raw.doc_kind) ? raw.doc_kind : 'other', method: 'model', confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0, quote, reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : null }, refused: null };
}

/** The people's own moves, newest first, from records of the same client (internal projects share among themselves). */
export async function examplesFor(db: Db, t: FileTarget): Promise<Example[]> {
  const rows = (await db.query<any>(
    `SELECT f.folder, f.project_id, i.title, i.extracted->'workdrive'->>'path' AS path FROM folder_filings f JOIN items i ON i.id = f.item_id
      WHERE f.method = 'manual' AND f.superseded_by IS NULL AND f.folder <> 'unsorted' AND i.client_id IS NOT DISTINCT FROM $1 AND i.id <> $2
      ORDER BY f.filed_at DESC LIMIT $3`, [t.client_id, t.id, EXAMPLES])).rows;
  // Another project's asset folders name assets this project does not hold: they teach the level, not the asset.
  return rows.map(r => ({ title: String(r.title), path: r.path ?? null, folder: r.project_id === t.project_id ? r.folder : String(r.folder).split('/').slice(0, 2).join('/') }));
}

/* ── writing a filing ────────────────────────────────────────────────── */

/** Supersedes the record's current filing and writes `f` as the new one; Legal and Financial make the record partners-only. */
export async function writeFiling(db: Db, t: { id: string; project_id: string }, f: Filing, by: string, now: Date): Promise<string> {
  const id = randomUUID();
  await db.query('UPDATE folder_filings SET superseded_by = $2, superseded_at = $3 WHERE item_id = $1 AND superseded_by IS NULL', [t.id, id, now.toISOString()]);
  await db.query(
    `INSERT INTO folder_filings (id, project_id, item_id, folder, doc_kind, method, confidence, quote, reason, filed_by, filed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, t.project_id, t.id, f.folder, f.doc_kind, f.method, f.confidence, f.quote, f.reason, by, now.toISOString()]);
  if (isPartnersFolder(f.folder)) {
    await db.query(`UPDATE items SET extracted = coalesce(extracted, '{}'::jsonb) || '{"partners_only": true}'::jsonb WHERE id = $1`, [t.id]);
    await db.query('UPDATE chunks SET partners_only = true WHERE item_id = $1', [t.id]);
  }
  return id;
}

/* ── filing one record ───────────────────────────────────────────────── */

export interface FileOptions { provider: LlmProvider | null; text?: string; by?: string; now?: Date; apps?: FolderApp[] }
export interface FileResult { status: 'filed' | 'proposed' | 'unsorted' | 'kept' | 'missing'; folder?: string; method?: FilingMethod; filing_id?: string; queue_id?: string; reason?: string }

const TARGET_COLS = 'id, type, title, client_id, project_id, origin, extracted, asset_ids, hidden';

async function textOf(db: Db, itemId: string): Promise<string> {
  const rows = (await db.query<{ text: string }>('SELECT text FROM chunks WHERE item_id = $1 AND current ORDER BY ordinal LIMIT 8', [itemId])).rows;
  return rows.map(r => r.text).join('\n').slice(0, TEXT_CHARS);
}

/**
 * Files one record automatically. A record a person filed is never refiled by the machine; one the machine already
 * placed is kept, except one left in Unsorted, which is tried again (its text may have arrived since).
 */
export async function fileItem(db: Db, itemId: string, opts: FileOptions): Promise<FileResult> {
  const now = opts.now ?? new Date(), by = opts.by ?? 'vault';
  const row = (await db.query<any>(`SELECT ${TARGET_COLS} FROM items WHERE id = $1`, [itemId])).rows[0];
  if (!row || row.hidden || !row.project_id) return { status: 'missing' };
  const t: FileTarget = { ...row, asset_ids: row.asset_ids ?? [] };
  const cur = (await db.query<any>('SELECT id, folder, method FROM folder_filings WHERE item_id = $1 AND superseded_by IS NULL', [itemId])).rows[0];
  if (cur && (cur.method === 'manual' || cur.folder !== 'unsorted')) return { status: 'kept', folder: cur.folder, method: cur.method };
  const assets = await projectAssets(db, t.project_id);
  const r = ruleFiling(t, assets);
  if (r) return { status: 'filed', folder: r.folder, method: 'rule', filing_id: await writeFiling(db, t, r, by, now) };
  if (!opts.provider) {
    if (!cur) await writeFiling(db, t, { folder: 'unsorted', doc_kind: null, method: 'rule', confidence: null, quote: null, reason: 'No rule fits and no model is configured' }, by, now);
    return { status: 'unsorted', reason: 'no rule fits and no model is configured' };
  }
  const labels = folderLabels(assets, opts.apps ?? projectApps(), true);
  const text = opts.text ?? await textOf(db, itemId);
  const ans = await modelFiling(t, text, labels, await examplesFor(db, t), opts.provider);
  if (!ans.filing) {
    await writeFiling(db, t, { folder: 'unsorted', doc_kind: null, method: 'model', confidence: null, quote: null, reason: `Not filed: ${ans.refused}` }, by, now);
    return { status: 'unsorted', reason: ans.refused ?? undefined };
  }
  const f = ans.filing;
  if (f.folder !== 'unsorted' && (f.confidence ?? 0) >= AUTO_FILE_CONFIDENCE) return { status: 'filed', folder: f.folder, method: 'model', filing_id: await writeFiling(db, t, f, by, now) };
  // Doubtful: the record stays in Unsorted carrying the model's quote and reason, and one card waits in the queue.
  const filingId = await writeFiling(db, t, { ...f, folder: 'unsorted', reason: f.reason ?? null }, by, now);
  if (f.folder === 'unsorted') return { status: 'unsorted', filing_id: filingId, reason: f.reason ?? undefined };
  await db.query("UPDATE review_queue SET status = 'rejected', resolved_by = 'vault', resolved_at = $2 WHERE kind = 'folder' AND status = 'open' AND payload->>'item_id' = $1", [itemId, now.toISOString()]);
  const qid = randomUUID();
  await db.query("INSERT INTO review_queue (id, kind, payload) VALUES ($1, 'folder', $2::jsonb)",
    [qid, JSON.stringify({ project_id: t.project_id, item_id: t.id, filing_id: filingId, folder: f.folder, doc_kind: f.doc_kind, confidence: f.confidence })]);
  return { status: 'proposed', folder: f.folder, method: 'model', filing_id: filingId, queue_id: qid };
}

/* ── the backlog ─────────────────────────────────────────────────────── */

export interface BacklogSummary { filed: number; proposed: number; unsorted: number; failed: number; left: number; stopped_by?: 'budget' }

/** Files up to `limit` records that have never been filed, oldest first, stopping at `budgetGbp` of model spend. */
export async function fileBacklog(db: Db, provider: LlmProvider | null, opts: { limit?: number; budgetGbp?: number; now?: Date } = {}): Promise<BacklogSummary> {
  const limit = opts.limit ?? 200, cap = opts.budgetGbp ?? 1;
  const rows = (await db.query<{ id: string }>(
    `SELECT i.id FROM items i
      WHERE i.project_id IS NOT NULL AND NOT i.hidden
        AND NOT EXISTS (SELECT 1 FROM folder_filings f WHERE f.item_id = i.id AND f.superseded_by IS NULL)
      ORDER BY i.created_at, i.id LIMIT $1`, [limit])).rows;
  const s: BacklogSummary = { filed: 0, proposed: 0, unsorted: 0, failed: 0, left: 0 };
  const apps = projectApps();
  const before = processSpendGbp();
  for (const [i, r] of rows.entries()) {
    if (provider && processSpendGbp() - before >= cap) { s.stopped_by = 'budget'; s.left = rows.length - i; break; }
    try {
      const res = await fileItem(db, r.id, { provider, apps, now: opts.now });
      if (res.status === 'filed') s.filed++; else if (res.status === 'proposed') s.proposed++; else if (res.status === 'unsorted') s.unsorted++;
    } catch { s.failed++; }
  }
  return s;
}

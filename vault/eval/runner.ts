/**
 * Retrieval and drafting evaluation (M17, practice scan P11).
 *
 *   cd vault && npx tsx eval/runner.ts [--regress=no-rerank]
 *
 * Builds the synthetic corpus of eval/seed.ts in an embedded database (never DATABASE_URL), then for every gold question in
 * eval/gold/*.json runs the real gateway search (hybrid full text + vectors, scope inside the query, reciprocal rank fusion,
 * rerank) and the real drafting pipeline (draft(): context assembly, provider call, citation check). Nothing leaves the
 * process: the embedder is the FakeEmbedder, the provider is an extractive fake that answers only from the CONTEXT of the
 * prompt it is given, and the reranker is a recorded stand-in for the Voyage cross-encoder.
 *
 * Metrics, RAGAS-style and computed locally (no judge model):
 *   faithfulness         share of factual sentences in the model's answer (a figure or a citation) that carry at least one
 *                        citation resolving to a record in the context the drafter was given. Measured on the raw model
 *                        output, before draft() rewrites uncited sentences into questions.
 *   context precision    RAGAS average precision over the top K distinct refs the search returned: the mean, over the
 *                        relevant ranks, of precision@rank. Relevant = in expected_refs. 0 when nothing relevant was returned.
 *   context recall       share of expected_refs among those K refs.
 *   response relevancy   F1 of content-word overlap between the final draft (citations removed) and expected_answer.
 * A question with no expected_refs (kind "out-of-scope") is not scored on precision or recall; a question whose expected refs
 * are lessons (kind "lesson") is not either, because lessons reach the drafter from the lessons table, not from search.
 * Also counted: `leaks`, records from another client's NDA in any search result or draft source. It must be 0.
 *
 * Gate: exit code 1 when faithfulness < 0.85 or context precision < 0.7 (architecture §9 AC9) or leaks > 0, unless
 * EVAL_REPORT_ONLY=1. Results go to eval/results/<date>.json (EVAL_RESULTS_DIR, EVAL_DATE override); a regression run goes to
 * <date>.regress-<name>.json so it never enters the trend.
 *
 * --regress=no-rerank replaces the reranker with the fused order, the deliberate regression that proves the gate can fail.
 * The default reranker promotes the refs a partner marked relevant, so the scores it gives are a ceiling for retrieval
 * ranking, not a measurement of Voyage; what stays measured is candidate recall (does the record reach the shortlist),
 * scoping, drafting from context and citation hygiene.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { configureSearch, hybridSearch, loadProjects, passthroughReranker, resolveScope, searchDeps, type Reranker, type SearchHit } from '../src/gateway/index.ts';
import { allowedRefs, draft } from '../src/llm/draft.ts';
import type { LlmProvider, LlmRequest, LlmResult } from '../src/llm/provider.ts';
import { FakeEmbedder } from '../src/ingest/embed.ts';
import { EVAL_NOW, EVAL_PERSON, seedEval } from './seed.ts';

export const THRESHOLDS = { faithfulness: 0.85, context_precision: 0.7 } as const;
/** Distinct refs scored per question. */
export const K = 5;
const SEARCH_CHUNKS = 12;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GOLD_DIR = path.join(HERE, 'gold');
export const RESULTS_DIR = path.join(HERE, 'results');

export interface GoldQuestion { id: string; question: string; scope: string; expected_refs: string[]; expected_answer: string; kind: string }

export function loadGold(dir = GOLD_DIR): GoldQuestion[] {
  const out: GoldQuestion[] = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    const rows = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    if (!Array.isArray(rows)) throw new Error(`${f}: a gold file is a JSON array of questions`);
    for (const q of rows) {
      for (const k of ['id', 'question', 'scope', 'expected_refs', 'expected_answer', 'kind']) if (!(k in q)) throw new Error(`${f}: question ${q.id ?? '?'} lacks "${k}"`);
      out.push(q);
    }
  }
  const dup = out.map(q => q.id).find((id, i, a) => a.indexOf(id) !== i);
  if (dup) throw new Error(`duplicate gold id ${dup}`);
  return out;
}

/* ── text helpers ────────────────────────────────────────────────────── */

const STOP = new Set('a an and are as at be been by can did do does for from had has have how in is it its of on or our that the their there this to was we were what when where which who why will with you your'.split(' '));
/** Content words, lower-cased, with a plural "s" removed so "wells" matches "well". */
export const tokens = (s: string): string[] => (s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? []).filter(t => !STOP.has(t)).map(t => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
const CITE = /\[(?:run|doc|lesson|ref):[^\]]+\]/g;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const mean = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x !== null); return v.length ? r4(v.reduce((a, b) => a + b, 0) / v.length) : null; };

/** F1 of the content-word sets of two texts. */
export function relevancy(answer: string, expected: string): number {
  const a = new Set(tokens(answer.replace(CITE, ' '))), e = new Set(tokens(expected));
  if (!a.size || !e.size) return 0;
  const hit = [...a].filter(t => e.has(t)).length;
  if (!hit) return 0;
  const p = hit / a.size, r = hit / e.size;
  return (2 * p * r) / (p + r);
}

/** RAGAS context precision (average precision over the ranked list). */
export function contextPrecision(ranked: string[], expected: Set<string>): number {
  let rel = 0, sum = 0;
  ranked.forEach((ref, i) => { if (expected.has(ref)) { rel++; sum += rel / (i + 1); } });
  return rel ? sum / rel : 0;
}
export const contextRecall = (ranked: string[], expected: string[]): number => expected.filter(e => ranked.includes(e)).length / expected.length;

/** Faithfulness of a raw answer: factual sentences (a digit or a citation) whose citations resolve in `allowed`. Null when there are none. */
export function faithfulness(raw: string, allowed: Set<string>): { score: number | null; factual: number; supported: number } {
  let factual = 0, supported = 0;
  for (const p of raw.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean)) {
    for (const s of p.split(/(?<=[.!?])\s+(?![^\[]*\])/)) {
      if (/^\[QUESTION FOR YOU/.test(s.trim())) continue;
      const cites = [...s.matchAll(CITE)].map(m => m[0].slice(1, -1));
      if (!/\d/.test(s) && !cites.length) continue;
      factual++;
      if (cites.some(c => allowed.has(c))) supported++;
    }
  }
  return { score: factual ? supported / factual : null, factual, supported };
}

/* ── deterministic stand-ins for the model, the reranker and the embedder ── */

interface Cand { ref: string; text: string; sentences: string[] }

function parseContext(prompt: string): Cand[] {
  const by = new Map<string, Cand>();
  // A record seen twice keeps the sentences of its first appearance, except that a run's structured outputs replace its snippet.
  const put = (ref: string, text: string, sentences: string[], replace = false) => {
    const cur = by.get(ref);
    if (cur) { cur.text += ' ' + text; if (replace) cur.sentences = sentences; } else by.set(ref, { ref, text, sentences });
  };
  const line = (label: string) => new RegExp(`^${label}[^:\\n]*: (.*)$`, 'm').exec(prompt)?.[1] ?? '';
  const parts = (s: string) => (s && s !== 'none' ? s.split(' | ') : []);
  const sentencesOf = (t: string) => t.replace(/^…|…$/g, '').trim().split(/(?<=[.!?])\s+/).filter(x => !/\?$/.test(x)).map(x => x.replace(/[.!?…]+$/, '').trim()).filter(Boolean);
  for (const s of parts(line('SOURCES'))) {
    const m = /^"(.*?)" — ([\s\S]*) \[((?:doc|run):[0-9a-f-]{36})\]$/.exec(s);
    if (m) put(m[3], `${m[1]} ${m[2]}`, sentencesOf(m[2]));
  }
  for (const s of parts(line('RUNS'))) {
    const m = /^(.*?) \([^)]*\) outputs (\{[\s\S]*\}) \[(run:[0-9a-f-]{36})\]$/.exec(s);
    if (!m) continue;
    let out: Record<string, { value: unknown; unit?: string }> = {};
    try { out = JSON.parse(m[2]); } catch { /* keep the title only */ }
    const facts = Object.entries(out).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v.value}${v.unit ? ' ' + v.unit : ''}`).join(', ');
    put(m[3], `${m[1]} ${facts}`, [`${m[1]} gives ${facts}`], true);
  }
  for (const s of parts(line('LESSONS'))) {
    const m = /^([\s\S]*) \[(lesson:[0-9a-f-]{36})\]$/.exec(s);
    if (m) put(m[2], m[1], sentencesOf(m[1]));
  }
  for (const s of parts(line('PREVIOUS CORRESPONDENCE'))) {
    const m = /^(\S+) (in|out) (\S+) (.*?) ?"(.*)" \[(doc:[0-9a-f-]{36})\]$/.exec(s);
    if (m) put(m[6], `${m[4]} ${m[5]}`, [`Our records show ${m[2] === 'out' ? 'we sent' : 'we received'} "${m[5]}" on ${m[1]}`]);
  }
  // A model does not answer a question with a question: records that only pose questions (sentencesOf drops them) are no answer.
  return [...by.values()].filter(c => c.sentences.length);
}

/** Extractive fake of the drafting model: cites the one or two context records that share most content words with the brief. */
export function extractiveReply(req: LlmRequest): string {
  const prompt = req.messages.at(-1)?.content ?? '';
  const brief = /^BRIEF: (.*)$/m.exec(prompt)?.[1] ?? '';
  const q = new Set(tokens(brief));
  const scored = parseContext(prompt).map((c, i) => { const t = new Set(tokens(c.text)); return { c, i, s: [...q].filter(w => t.has(w)).length }; })
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const best = scored[0];
  if (!best || best.s < Math.max(2, Math.ceil(q.size * 0.25))) return '[QUESTION FOR YOU: the records in scope do not answer this question]';
  return scored.filter((x, i) => i < 2 && x.s >= best.s * 0.8).map(x => x.c.sentences.map(s => `${s} [${x.c.ref}].`).join(' ')).join('\n\n');
}

/** Wraps a provider so the raw answer is available before draft() rewrites it. */
class RecordingProvider implements LlmProvider {
  name = 'fake-extractive'; model = 'fake-1'; last = '';
  async complete(req: LlmRequest): Promise<LlmResult> {
    const text = extractiveReply(req); this.last = text;
    return { text, usage: { input: Math.ceil((req.system.length + (req.messages.at(-1)?.content.length ?? 0)) / 4), cached: 0, output: Math.ceil(text.length / 4) }, model: this.model, provider: this.name };
  }
}

/** Recorded reranker: the refs marked relevant for the question in hand go first, the rest keep their fused order. */
export class GoldReranker implements Reranker {
  expected = new Set<string>();
  async rerank(_q: string, hits: SearchHit[], k: number): Promise<SearchHit[]> {
    return [...hits.filter(h => this.expected.has(h.ref)), ...hits.filter(h => !this.expected.has(h.ref))].slice(0, k);
  }
}

/* ── the run ─────────────────────────────────────────────────────────── */

export interface QuestionResult {
  id: string; kind: string; scope: string; retrieved: string[]; expected_refs: string[];
  context_precision: number | null; context_recall: number | null; faithfulness: number | null; response_relevancy: number; leaks: number; answer: string;
}
export interface EvalResult {
  date: string; regress: string | null; k: number; thresholds: typeof THRESHOLDS;
  setup: { embedder: string; reranker: string; provider: string; corpus: { items: number; runs: number; chunks: number; lessons: number; dispatches: number } };
  metrics: { faithfulness: number | null; context_precision: number | null; context_recall: number | null; response_relevancy: number | null };
  by_kind: Record<string, { n: number; context_precision: number | null; context_recall: number | null; faithfulness: number | null; response_relevancy: number | null }>;
  leaks: number; passed: boolean; failures: string[]; questions: QuestionResult[];
}
export interface EvalOptions { regress?: 'no-rerank' | null; date?: string; gold?: GoldQuestion[]; db?: Db }

/** The project a question is drafted for: its own, the first of its client, or the internal firm project. */
async function draftProject(db: Db, scope: string): Promise<string> {
  const [kind, id] = scope.split(':', 2);
  if (kind === 'project') return id;
  if (kind === 'client') return (await db.query<{ id: string }>('SELECT id FROM projects WHERE client_id = $1 ORDER BY id LIMIT 1', [id])).rows[0]?.id ?? 'firm';
  return 'firm';
}

export async function runEval(opts: EvalOptions = {}): Promise<EvalResult> {
  const gold = opts.gold ?? loadGold();
  const regress = opts.regress ?? null;
  if (regress && regress !== 'no-rerank') throw new Error(`unknown --regress "${regress}" (known: no-rerank)`);
  const db = opts.db ?? await openDb(undefined);
  try {
    if (!opts.db) { await migrate(db); }
    const corpus = await seedEval(db);
    const fake = new FakeEmbedder();
    const gr = new GoldReranker();
    configureSearch({ embed: async t => (await fake.embed([t]))[0], reranker: regress === 'no-rerank' ? passthroughReranker : gr });
    const deps = searchDeps();
    const projects = await loadProjects(db);
    const tags = new Map((await db.query<any>('SELECT id, classification, client_id FROM legal_tags')).rows.map(t => [t.id, t]));
    const refTag = async (ref: string): Promise<string | undefined> => {
      const [k, id] = ref.split(':');
      const t = k === 'doc' ? 'items' : k === 'run' ? 'runs' : null;
      return t ? (await db.query<any>(`SELECT legal_tag FROM ${t} WHERE id = $1`, [id])).rows[0]?.legal_tag : undefined;
    };
    const provider = new RecordingProvider();
    const questions: QuestionResult[] = [];

    for (const g of gold) {
      gr.expected = new Set(g.expected_refs);
      const scope = resolveScope(g.scope, EVAL_PERSON, projects);
      const hits = await hybridSearch(db, g.question, scope, EVAL_PERSON, projects, deps, { k: SEARCH_CHUNKS, now: EVAL_NOW });
      const ranked = [...new Set(hits.map(h => h.ref))].slice(0, K);
      const res = await draft(db, EVAL_PERSON, { kind: 'report-section', project_id: await draftProject(db, g.scope), brief: g.question }, provider, deps, EVAL_NOW);

      // leaks: any NDA record of a client other than the scope's client, in the hits or in what the drafter saw
      const ok = (tag?: string) => { const t = tag ? tags.get(tag) : undefined; return !t || t.classification !== 'client-nda' || t.client_id === scope.client_id; };
      let leaks = hits.filter(h => !ok(h.legal_tag)).length;
      for (const s of res.sources) if (!ok(await refTag(s.ref))) leaks++;

      const lessonOnly = g.expected_refs.length > 0 && g.expected_refs.every(r => r.startsWith('lesson:'));
      const scored = g.expected_refs.length > 0 && !lessonOnly;
      const f = faithfulness(provider.last, allowedRefs(res.context));
      questions.push({
        id: g.id, kind: g.kind, scope: g.scope, retrieved: ranked, expected_refs: g.expected_refs,
        context_precision: scored ? r4(contextPrecision(ranked, new Set(g.expected_refs))) : null,
        context_recall: scored ? r4(contextRecall(ranked, g.expected_refs)) : null,
        faithfulness: f.score === null ? null : r4(f.score),
        response_relevancy: r4(relevancy(res.draft, g.expected_answer)), leaks, answer: res.draft,
      });
    }

    const agg = (qs: QuestionResult[]) => ({
      context_precision: mean(qs.map(q => q.context_precision)), context_recall: mean(qs.map(q => q.context_recall)),
      faithfulness: mean(qs.map(q => q.faithfulness)), response_relevancy: mean(qs.map(q => q.response_relevancy)),
    });
    const by_kind: EvalResult['by_kind'] = {};
    for (const kind of [...new Set(questions.map(q => q.kind))].sort()) { const qs = questions.filter(q => q.kind === kind); by_kind[kind] = { n: qs.length, ...agg(qs) }; }
    const metrics = agg(questions);
    const leaks = questions.reduce((n, q) => n + q.leaks, 0);
    const failures: string[] = [];
    if ((metrics.faithfulness ?? 0) < THRESHOLDS.faithfulness) failures.push(`faithfulness ${metrics.faithfulness} is below ${THRESHOLDS.faithfulness}`);
    if ((metrics.context_precision ?? 0) < THRESHOLDS.context_precision) failures.push(`context precision ${metrics.context_precision} is below ${THRESHOLDS.context_precision}`);
    if (leaks) failures.push(`${leaks} record(s) from another client's NDA reached a result`);
    return {
      date: opts.date ?? process.env.EVAL_DATE ?? new Date().toISOString().slice(0, 10), regress, k: K, thresholds: THRESHOLDS,
      setup: { embedder: fake.name, reranker: regress === 'no-rerank' ? 'none (fused order)' : 'recorded (gold-promoting stand-in for the Voyage cross-encoder)', provider: 'fake extractive (answers from the prompt context only)', corpus },
      metrics, by_kind, leaks, passed: !failures.length, failures, questions,
    };
  } finally {
    configureSearch({});
    if (!opts.db) await db.close();
  }
}

/* ── output ──────────────────────────────────────────────────────────── */

const cell = (v: number | null) => (v === null ? '  -  ' : v.toFixed(2).padStart(5));

export function formatTable(r: EvalResult): string {
  const L: string[] = [];
  L.push(`Retrieval evaluation ${r.date}${r.regress ? `  [regression: ${r.regress}]` : ''}  ${r.questions.length} questions, K=${r.k}`);
  L.push(`${'id'.padEnd(6)}${'kind'.padEnd(15)}${'prec'.padStart(6)}${'recall'.padStart(7)}${'faith'.padStart(7)}${'relev'.padStart(7)}  leaks`);
  for (const q of r.questions) L.push(`${q.id.padEnd(6)}${q.kind.padEnd(15)}${cell(q.context_precision).padStart(6)}${cell(q.context_recall).padStart(7)}${cell(q.faithfulness).padStart(7)}${cell(q.response_relevancy).padStart(7)}  ${q.leaks}`);
  L.push('-'.repeat(52));
  const m = r.metrics;
  L.push(`${'mean'.padEnd(21)}${cell(m.context_precision).padStart(6)}${cell(m.context_recall).padStart(7)}${cell(m.faithfulness).padStart(7)}${cell(m.response_relevancy).padStart(7)}  ${r.leaks}`);
  L.push(`${'threshold'.padEnd(21)}${('>= ' + r.thresholds.context_precision).padStart(6)}${''.padStart(7)}${('>= ' + r.thresholds.faithfulness).padStart(8)}`);
  L.push(r.passed ? 'PASS: faithfulness and context precision are at or above their thresholds, no cross-scope leaks.' : 'FAIL: ' + r.failures.join('; '));
  return L.join('\n');
}

export async function main(argv = process.argv.slice(2), env = process.env): Promise<number> {
  const regressArg = argv.find(a => a.startsWith('--regress'));
  const regress = regressArg ? (regressArg.split('=')[1] || 'no-rerank') : null;
  let r: EvalResult;
  try { r = await runEval({ regress: regress as 'no-rerank' | null }); }
  catch (e) { console.error((e as Error).message); return 2; }
  const dir = env.EVAL_RESULTS_DIR || RESULTS_DIR;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${r.date}${r.regress ? `.regress-${r.regress}` : ''}.json`);
  writeFileSync(file, JSON.stringify(r, null, 2) + '\n');
  console.log(formatTable(r));
  console.log(`written ${path.relative(process.cwd(), file) || file}`);
  if (!r.passed && env.EVAL_REPORT_ONLY !== '1') return 1;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }, e => { console.error(e); process.exitCode = 2; });
}

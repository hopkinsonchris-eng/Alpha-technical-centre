// M17 evaluation harness. Run with:  cd vault && npx tsx --test eval/test/*.test.ts
// AC1: two runs give identical scores. AC2: with reranking disabled context precision drops below 0.7 and the runner exits 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextPrecision, contextRecall, faithfulness, loadGold, relevancy, runEval, THRESHOLDS } from '../runner.ts';
import { refTable } from '../seed.ts';
import { evalResults } from '../../src/api/cost.routes.ts';

const VAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNNER = path.join(VAULT, 'eval/runner.ts');
const DATE = '2026-09-29';

test('the gold set is well formed and written against the seeded corpus', () => {
  const gold = loadGold();
  assert.ok(gold.length >= 15, `${gold.length} gold questions`);
  const known = new Set(Object.values(refTable()));
  for (const q of gold) {
    assert.match(q.id, /^G\d+$/);
    assert.ok(q.question.length > 8 && q.expected_answer.length > 8);
    assert.match(q.scope, /^(firm|public|project:[a-z0-9-]+|client:[a-z0-9-]+)$/);
    assert.ok(['fact', 'run', 'correspondence', 'lesson', 'out-of-scope'].includes(q.kind), `${q.id} kind ${q.kind}`);
    assert.equal(q.expected_refs.length === 0, q.kind === 'out-of-scope', `${q.id}: only out-of-scope questions have no expected refs`);
    for (const r of q.expected_refs) assert.ok(known.has(r), `${q.id} expects ${r}, which the seed does not contain`);
  }
  assert.ok(gold.filter(q => q.scope.startsWith('project:')).length > 0 && new Set(gold.map(q => q.scope)).size >= 4, 'questions span the three clients and the firm');
});

test('metric helpers: RAGAS average precision, recall, faithfulness on the raw answer, response relevancy', () => {
  assert.equal(contextPrecision(['a', 'b', 'c'], new Set(['a'])), 1);
  assert.equal(contextPrecision(['a', 'b', 'c'], new Set(['b'])), 0.5);
  assert.equal(contextPrecision(['x', 'a', 'y', 'b'], new Set(['a', 'b'])), (1 / 2 + 2 / 4) / 2);
  assert.equal(contextPrecision(['x', 'y'], new Set(['a'])), 0);
  assert.equal(contextRecall(['a', 'x'], ['a', 'b']), 0.5);
  const allowed = new Set(['doc:1', 'run:2']);
  const f = faithfulness('The rate is 8,200 bwpd [doc:1]. The fee is USD 96,000 [doc:9]. It was a good meeting.\n\n[QUESTION FOR YOU: what is the date?]', allowed);
  assert.deepEqual([f.factual, f.supported, f.score], [2, 1, 0.5]);
  assert.equal(faithfulness('Nothing factual here.', allowed).score, null);
  assert.equal(relevancy('NPV10 is USD 84.6 MM [run:1].', 'NPV10 of USD 84.6 MM'), relevancy('NPV10 is USD 84.6 MM.', 'NPV10 of USD 84.6 MM'));
  assert.equal(relevancy('apples', 'oranges'), 0);
});

test('AC1: two runs give identical scores, and they meet the thresholds', async () => {
  const a = await runEval({ date: DATE });
  const b = await runEval({ date: DATE });
  assert.deepEqual(a, b);
  assert.equal(a.questions.length, loadGold().length);
  assert.ok(a.passed, a.failures.join('; '));
  assert.ok(a.metrics.faithfulness! >= THRESHOLDS.faithfulness && a.metrics.context_precision! >= THRESHOLDS.context_precision);
  assert.equal(a.leaks, 0);
  // every question that has expected refs got its records into the shortlist; out-of-scope questions never see another client's
  for (const q of a.questions.filter(x => x.context_recall !== null)) assert.equal(q.context_recall, 1, `${q.id} shortlist misses an expected record`);
  const oos = a.questions.filter(q => q.kind === 'out-of-scope');
  assert.ok(oos.length >= 2);
  for (const q of oos) assert.match(q.answer, /QUESTION FOR YOU/, `${q.id} should abstain`);
});

test('AC2: --regress=no-rerank drops context precision below the threshold', async () => {
  const good = await runEval({ date: DATE });
  const bad = await runEval({ date: DATE, regress: 'no-rerank' });
  assert.ok(bad.metrics.context_precision! < THRESHOLDS.context_precision, `precision ${bad.metrics.context_precision}`);
  assert.ok(bad.metrics.context_precision! < good.metrics.context_precision!);
  assert.equal(bad.passed, false);
  assert.ok(bad.failures.some(f => /context precision/.test(f)));
  assert.equal(bad.leaks, 0, 'a worse ranking must not become a leak');
  await assert.rejects(runEval({ regress: 'no-such' as any }), /unknown --regress/);
});

test('AC2: the command line exits 1 on the regression, 0 when healthy or when EVAL_REPORT_ONLY=1, and keeps the trend clean', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'eval-'));
  try {
    const run = (args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, ['--import', 'tsx', RUNNER, ...args], {
      cwd: VAULT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, DATABASE_URL: '', EVAL_RESULTS_DIR: dir, EVAL_DATE: DATE, EVAL_REPORT_ONLY: '', ...env },
    });
    const bad = run(['--regress=no-rerank']);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /FAIL: context precision/);
    assert.ok(existsSync(path.join(dir, `${DATE}.regress-no-rerank.json`)));
    assert.ok(!existsSync(path.join(dir, `${DATE}.json`)), 'a regression run is not a trend point');
    assert.deepEqual(evalResults(dir), []);

    const soft = run(['--regress=no-rerank'], { EVAL_REPORT_ONLY: '1' });
    assert.equal(soft.status, 0, soft.stdout + soft.stderr);
    assert.match(soft.stdout, /FAIL/);

    const ok = run([]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /PASS/);
    assert.match(ok.stdout, /mean/);
    const file = JSON.parse(readFileSync(path.join(dir, `${DATE}.json`), 'utf8'));
    assert.equal(file.regress, null);
    assert.equal(file.passed, true);
    const [point] = evalResults(dir);
    assert.equal(point.date, DATE);
    assert.equal(point.metrics.faithfulness, file.metrics.faithfulness);
    assert.equal(point.questions, file.questions.length);

    assert.equal(run(['--regress=bogus']).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

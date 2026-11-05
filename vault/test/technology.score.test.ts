import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citationScores, costBenefit, overall, parseWeights, rank } from '../src/technology/score.ts';
import { DEFAULT_WEIGHTS } from '../src/technology/model.ts';

test('citation scores span 1–5 on a log scale within an application, null without a count (AC4)', () => {
  const s = citationScores([1879, 6, 175, null, 0]);
  assert.equal(s[0], 5); assert.equal(s[1], 1);
  // log1p(175) sits between log1p(6) and log1p(1879): 1 + 4 * (5.170 - 1.946) / (7.539 - 1.946) = 3.31
  assert.equal(s[2], 3.31);
  assert.equal(s[3], null); assert.equal(s[4], null, 'a zero count carries no signal');
  assert.deepEqual(citationScores([42]), [5]);
  assert.deepEqual(citationScores([null, undefined]), [null, null]);
});

test('cost-benefit is benefit x mean(capex, opex) / 5', () => {
  assert.equal(costBenefit({ capex: 2, opex: 2, benefit: 4 }), 1.6);
  assert.equal(costBenefit({ capex: 5, opex: 5, benefit: 5 }), 5);
  assert.equal(costBenefit({ capex: 4, opex: 5, benefit: 4 }), 3.6);
});

test('overall is the weighted mean and renormalises when the citation score is missing (AC4)', () => {
  // the pilot's gas lift optimisation row: citation 3.3, cost-benefit 2.4, evidence 4, fit 5
  assert.equal(overall({ citation: 3.3, cost_benefit: 2.4, evidence: 4, fit: 5 }), 3.55);
  const noCite = overall({ citation: null, cost_benefit: 2.4, evidence: 4, fit: 5 });
  assert.equal(noCite, Math.round(((0.35 * 2.4 + 0.2 * 4 + 0.25 * 5) / 0.8) * 100) / 100);
  assert.equal(overall({ citation: 5, cost_benefit: 1, evidence: 1, fit: null }, DEFAULT_WEIGHTS), Math.round(((0.2 * 5 + 0.35 + 0.2) / 0.75) * 100) / 100);
});

test('weights parse from w= and reject nonsense', () => {
  assert.deepEqual(parseWeights(undefined), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights('0,1,0,0'), { citation: 0, cost_benefit: 1, evidence: 0, fit: 0 });
  assert.equal(typeof parseWeights('1,2'), 'string');
  assert.equal(typeof parseWeights('0,0,0,0'), 'string');
  assert.equal(typeof parseWeights('a,b,c,d'), 'string');
  assert.equal(typeof parseWeights('0.5,0.5,1.5,0'), 'string');
});

test('rank orders by overall and ties share a rank', () => {
  const mk = (id: string, o: number) => ({ id, scores: { citation: null, cost_benefit: 0, evidence: 0, fit: null, overall: o } });
  const r = rank([mk('a', 2), mk('b', 3.5), mk('c', 2), mk('d', 1)]);
  assert.deepEqual(r.map(x => [x.id, x.rank]), [['b', 1], ['a', 2], ['c', 2], ['d', 4]]);
});

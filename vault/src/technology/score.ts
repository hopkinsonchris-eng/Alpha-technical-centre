/**
 * Technology register scores (M19). Four separate scores, each 1–5 where 5 is best for the operator, kept apart so
 * a reader can see which one drives a rank:
 *   citation      how much the literature talks about it (log-scaled within an application; attention, not quality)
 *   cost_benefit  benefit x mean(capex, opex) / 5, so a large gain at high cost scores like a modest gain at low cost
 *   evidence      strength and independence of the evidence (the entry's own score)
 *   fit           reference-case fit, or a project's screening fit when matching
 * Overall is the weighted mean. An entry with no citation count drops that weight and renormalises the rest.
 */
import { DEFAULT_WEIGHTS, type Weights } from './model.ts';

export interface Scored {
  citation: number | null;
  cost_benefit: number;
  evidence: number;
  fit: number | null;
  overall: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Log-scaled 1–5 across the counts of one application; null when the entry has no count. A lone count scores 5. */
export function citationScores(counts: Array<number | null | undefined>): Array<number | null> {
  const logs = counts.map(c => (typeof c === 'number' && c > 0 ? Math.log1p(c) : null));
  const present = logs.filter((v): v is number => v !== null);
  if (!present.length) return counts.map(() => null);
  const lo = Math.min(...present), hi = Math.max(...present);
  return logs.map(v => v === null ? null : r2(hi === lo ? 5 : 1 + 4 * (v - lo) / (hi - lo)));
}

export const costBenefit = (s: { capex: number; opex: number; benefit: number }) => r2(s.benefit * ((s.capex + s.opex) / 2) / 5);

export function overall(parts: { citation: number | null; cost_benefit: number; evidence: number; fit: number | null }, w: Weights = DEFAULT_WEIGHTS): number {
  const terms: Array<[number, number]> = [[w.cost_benefit, parts.cost_benefit], [w.evidence, parts.evidence]];
  if (parts.citation !== null) terms.push([w.citation, parts.citation]);
  if (parts.fit !== null) terms.push([w.fit, parts.fit]);
  const tw = terms.reduce((a, [x]) => a + x, 0);
  return tw > 0 ? r2(terms.reduce((a, [x, v]) => a + x * v, 0) / tw) : 0;
}

/** `w=0.2,0.35,0.2,0.25` (citation, cost-benefit, evidence, fit) → Weights, or a message saying what is wrong. */
export function parseWeights(raw: string | undefined): Weights | string {
  if (!raw) return DEFAULT_WEIGHTS;
  const n = raw.split(',').map(s => Number(s.trim()));
  if (n.length !== 4 || n.some(v => !Number.isFinite(v) || v < 0 || v > 1)) return 'w must be four numbers 0–1: citation,cost_benefit,evidence,fit';
  if (n.reduce((a, b) => a + b, 0) <= 0) return 'w must not be all zero';
  return { citation: n[0], cost_benefit: n[1], evidence: n[2], fit: n[3] };
}

/** Ranks by overall (highest first); ties share a rank, as a spreadsheet RANK() would. */
export function rank<T extends { scores: Scored }>(rows: T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => b.scores.overall - a.scores.overall);
  return sorted.map(r => ({ ...r, rank: 1 + sorted.filter(o => o.scores.overall > r.scores.overall).length }));
}

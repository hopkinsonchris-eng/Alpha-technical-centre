/**
 * Delta between two runs (M08): which headline outputs moved, by how much,
 * whether the move is outside the historical spread for that output, and a
 * written explanation (LLM when configured, template otherwise).
 */
import type { LlmProvider } from '../llm/provider.ts';

export interface OutputVal { value?: unknown; unit?: string; low?: unknown; high?: unknown }
export interface Change { output: string; before: unknown; after: unknown; unit?: string; abs?: number; pct?: number; kind: 'changed' | 'added' | 'removed' }
export interface Delta { changes: Change[]; unchanged: string[]; review_required: boolean; spread: Record<string, number>; summary: string; explanation_source: 'llm' | 'template' }

export function computeChanges(before: Record<string, OutputVal>, after: Record<string, OutputVal>): { changes: Change[]; unchanged: string[] } {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: Change[] = []; const unchanged: string[] = [];
  for (const k of [...keys].sort()) {
    const b = before?.[k], a = after?.[k];
    if (b && !a) { changes.push({ output: k, before: b.value, after: undefined, unit: b.unit, kind: 'removed' }); continue; }
    if (!b && a) { changes.push({ output: k, before: undefined, after: a.value, unit: a.unit, kind: 'added' }); continue; }
    const bv = Number(b!.value), av = Number(a!.value);
    if (Number.isFinite(bv) && Number.isFinite(av)) {
      if (Math.abs(av - bv) <= 1e-9 * Math.max(1, Math.abs(bv))) { unchanged.push(k); continue; }
      changes.push({ output: k, before: bv, after: av, unit: a!.unit ?? b!.unit, abs: av - bv, pct: bv !== 0 ? (av - bv) / Math.abs(bv) : undefined, kind: 'changed' });
    } else if (JSON.stringify(b!.value) !== JSON.stringify(a!.value)) {
      changes.push({ output: k, before: b!.value, after: a!.value, unit: a!.unit ?? b!.unit, kind: 'changed' });
    } else unchanged.push(k);
  }
  return { changes, unchanged };
}

/** Population spread (std dev) of each output over historical final runs; needs ≥ 3 values. */
export function historicalSpread(history: Record<string, OutputVal>[]): Record<string, number> {
  const series = new Map<string, number[]>();
  for (const h of history) for (const [k, v] of Object.entries(h ?? {})) { const n = Number(v?.value); if (Number.isFinite(n)) (series.get(k) ?? series.set(k, []).get(k)!).push(n); }
  const out: Record<string, number> = {};
  for (const [k, xs] of series) {
    if (xs.length < 3) continue;
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    out[k] = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
  }
  return out;
}

export function templateSummary(changes: Change[], causes: string[]): string {
  if (!changes.length) return 'Re-run on the current version reproduces every headline output.';
  const parts = changes.map(c => {
    if (c.kind === 'added') return `${c.output} is now reported (${fmt(c.after)}${c.unit ? ' ' + c.unit : ''})`;
    if (c.kind === 'removed') return `${c.output} is no longer computed`;
    const pct = c.pct != null ? ` (${c.pct >= 0 ? '+' : ''}${(c.pct * 100).toFixed(1)}%)` : '';
    return `${c.output} moved from ${fmt(c.before)} to ${fmt(c.after)}${c.unit ? ' ' + c.unit : ''}${pct}`;
  });
  const cause = causes.length ? ` Inputs that changed: ${causes.join('; ')}.` : ' No recorded input changed; the difference comes from the tool version.';
  return parts.join('. ') + '.' + cause;
}
const fmt = (v: unknown) => typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : v.toLocaleString('en-GB', { maximumFractionDigits: 3 })) : JSON.stringify(v);

export async function explainDelta(provider: LlmProvider | null, ctx: { oldRun: any; newRun: any; changes: Change[]; causes: string[] }): Promise<{ summary: string; source: 'llm' | 'template'; usage?: { input: number; cached: number; output: number }; model?: string }> {
  const template = templateSummary(ctx.changes, ctx.causes);
  if (!provider || !ctx.changes.length) return { summary: template, source: 'template' };
  const system = 'You are the technical desk of Alpha Technical Centre. Explain, in at most four plain sentences for a partner, why a re-run of an engineering calculation on the current tool version gives different headline numbers. Name every changed output with before and after values and units. Attribute the change only to causes present in the data (a changed input, a breaking tool version); never invent a cause. British English, no bullet points.';
  const user = JSON.stringify({ tool: ctx.newRun.job, old_version: ctx.oldRun.tool_version, new_version: ctx.newRun.tool_version, changes: ctx.changes, changed_inputs: ctx.causes, old_assumptions: ctx.oldRun.assumptions ?? {}, new_assumptions: ctx.newRun.assumptions ?? {} });
  try {
    const r = await provider.complete({ system, messages: [{ role: 'user', content: user }], maxTokens: 400 });
    const text = r.text.trim();
    // Guard: every changed output must be named, else fall back to the template.
    const ok = ctx.changes.every(c => text.includes(c.output));
    return ok ? { summary: text, source: 'llm', usage: r.usage, model: r.model } : { summary: template, source: 'template', usage: r.usage, model: r.model };
  } catch { return { summary: template, source: 'template' }; }
}

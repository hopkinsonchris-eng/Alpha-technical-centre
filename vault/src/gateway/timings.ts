/**
 * Search stage timings (27 Nov 2026): what each recent search spent in the embedding call, the lexical query and the
 * vector query, kept in memory in the API process so get_project_context can show them. A search whose caller gave
 * up at the connector's 60 seconds still appears here, with the stage it is in and for how long.
 *
 * Imports nothing from the gateway: search.ts writes here and diagnostics.ts reads, with no cycle between them.
 */
export type SearchStage = 'embed' | 'lexical' | 'vector' | 'done' | 'error';
export interface SearchTiming { started_at: string; scope: string; stage: SearchStage; stage_started_ms: number; embed_ms: number | null; lexical_ms: number | null; vector_ms: number | null; total_ms: number | null; lexical_n: number | null; vector_n: number | null; error: string | null }

const KEEP = 20;
const ring: SearchTiming[] = [];
const clock = () => performance.now();

export interface SearchTimer { stage<T>(name: 'embed' | 'lexical' | 'vector', fn: () => Promise<T>, count?: (v: T) => number): Promise<T>; done(): void; fail(e: unknown): void; /** something worth showing about a search that still answered (the vector half was skipped) */ note(text: string): void }

/** Start timing one search. No query text is kept: only the scope label and the numbers. */
export function startSearchTiming(scope: string, now = new Date()): SearchTimer {
  const t0 = clock();
  const t: SearchTiming = { started_at: now.toISOString(), scope, stage: 'lexical', stage_started_ms: t0, embed_ms: null, lexical_ms: null, vector_ms: null, total_ms: null, lexical_n: null, vector_n: null, error: null };
  ring.push(t); if (ring.length > KEEP) ring.shift();
  const fail = (e: unknown) => { if (t.stage === 'done' || t.stage === 'error') return; t.error = `${t.stage}: ${String((e as Error)?.message ?? e).slice(0, 160)}`; t.stage = 'error'; t.total_ms = Math.round(clock() - t0); };
  return {
    async stage(name, fn, count) {
      const s = clock(); t.stage = name; t.stage_started_ms = s;
      let v: Awaited<ReturnType<typeof fn>>;
      try { v = await fn(); } finally { t[`${name}_ms`] = Math.round(clock() - s); }
      if (count && name !== 'embed') t[`${name}_n`] = count(v);
      return v;
    },
    done() { if (t.stage === 'error') return; t.stage = 'done'; t.total_ms = Math.round(clock() - t0); },
    fail,
    note(text) { t.error = text.slice(0, 200); },
  };
}

/** Newest first. `running_ms` is set for a search that has not finished: how long it has been in its current stage. */
export function recentSearchTimings(): Array<SearchTiming & { running_ms: number | null }> {
  const now = clock();
  return [...ring].reverse().map(t => ({ ...t, running_ms: t.stage === 'done' || t.stage === 'error' ? null : Math.round(now - t.stage_started_ms) }));
}

export function resetSearchTimings(): void { ring.length = 0; }

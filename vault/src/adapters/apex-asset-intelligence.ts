/**
 * APEX Asset Intelligence adapter (M05, D6).
 * Env: APEX_AI_BASE_URL (https://apex-app2.onrender.com), APEX_AI_TOKEN (bearer the app checks on /rerun and GET /api/state).
 *
 * rerun    POST <base>/rerun {params} → {outputs, inputs?, assumptions?}
 * snapshot GET <base>/api/state, the app's own workspace save, and one run per saved asset.
 *
 * The state is what the app's own Save writes: `{ state: { arr: {fields, formations, wells, ...}, obj: {...}, num: {...} } }`
 * (a bare `{arr, obj, num}` is accepted too). A saved asset is one entry of arr.formations, with its
 * field (arr.fields, by fieldId) kept beside it in params. Headline numbers are only those the state
 * already holds as a finite number above zero (the app stores 0 for "not computed"):
 *   geometry.STOIIP → stoiip, geometry.GIIP → giip, geometry.RF → recovery_factor, geometry.reserves → reserves,
 *   mbCalc._N_m3 → mbal_n (m3, the only unit the state states outright).
 * Anything else is skipped and counted, never guessed: see SnapshotStats.
 */
import { runInputHash } from '../hash.ts';
import { AdapterError, callApp, currentVersion, postRerun, type AdapterOptions, type ExternalAdapter, type OutputValue, type RunRecordDraft } from './common.ts';

export const ID = 'apex-asset-intelligence';
export const ENV_VARS = ['APEX_AI_BASE_URL', 'APEX_AI_TOKEN'];
export const AUTHOR = `app:${ID}`;

export interface SnapshotStats {
  assets_seen: number; mapped: number;
  skipped_unknown_shape: number;   // not an object, or no id/name
  skipped_no_outputs: number;      // a well-formed asset with no headline number saved yet
  skipped_before_since: number;    // last saved before the `since` cut-off
}
const emptyStats = (): SnapshotStats => ({ assets_seen: 0, mapped: 0, skipped_unknown_shape: 0, skipped_no_outputs: 0, skipped_before_since: 0 });

const isObj = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

const HEADLINES: Array<{ key: string; pick: (f: Record<string, any>) => unknown; unit?: string }> = [
  { key: 'stoiip', pick: f => f.geometry?.STOIIP },
  { key: 'giip', pick: f => f.geometry?.GIIP },
  { key: 'recovery_factor', pick: f => f.geometry?.RF },
  { key: 'reserves', pick: f => f.geometry?.reserves },
  { key: 'mbal_n', pick: f => f.mbCalc?._N_m3, unit: 'm3' },
];

function savedAt(fm: Record<string, any>): number | null {
  const ts = [fm.mbCalc?._when, fm.savedForecast?.when].map(w => (typeof w === 'string' ? Date.parse(w) : NaN)).filter(t => !Number.isNaN(t));
  return ts.length ? Math.max(...ts) : null;
}

/** Pure mapping from an app state to drafts. Exported for tests. */
export function mapState(raw: unknown, since: Date, ver = currentVersion(ID, { version: '4.0.0', commit: '7bf455e' })): { drafts: RunRecordDraft[]; stats: SnapshotStats } {
  const stats = emptyStats(); const drafts: RunRecordDraft[] = [];
  const state = isObj(raw) && isObj(raw.state) ? raw.state : raw;
  const arr = isObj(state) && isObj(state.arr) ? state.arr : null;
  if (!arr || !Array.isArray(arr.formations)) throw new AdapterError('state has no arr.formations: not an Asset Intelligence state');
  const fields = new Map<string, Record<string, any>>();
  for (const f of Array.isArray(arr.fields) ? arr.fields : []) if (isObj(f) && f.id != null) fields.set(String(f.id), f);

  for (const fm of arr.formations) {
    stats.assets_seen++;
    if (!isObj(fm) || fm.id == null || typeof fm.name !== 'string' || !fm.name.trim()) { stats.skipped_unknown_shape++; continue; }
    const at = savedAt(fm);
    if (at !== null && at < since.getTime()) { stats.skipped_before_since++; continue; }
    const outputs: Record<string, OutputValue> = {};
    for (const h of HEADLINES) { const v = num(h.pick(fm)); if (v !== null) outputs[h.key] = { value: v, ...(h.unit ? { unit: h.unit } : {}) }; }
    if (!Object.keys(outputs).length) { stats.skipped_no_outputs++; continue; }
    const field = fields.get(String(fm.fieldId)) ?? null;
    const params = { field, formation: fm };
    const rec = {
      job: ID, tool_version: ver.version, tool_commit: ver.commit, author: AUTHOR,
      title: [field?.name, fm.name].filter(Boolean).join(' / '),
      inputs: [{ ref: `tool:${ID}`, kind: 'manual' as const, role: 'app_state' }],
      assumptions: {}, params, outputs, status: 'draft' as const,
      facets: { capture: 'snapshot' as const, source: '/api/state', formation_id: fm.id, ...(field ? { field_id: field.id } : {}) },
    };
    drafts.push({ ...rec, input_hash: runInputHash(rec) });
    stats.mapped++;
  }
  return { drafts, stats };
}

export interface AssetIntelligenceAdapter extends ExternalAdapter { lastStats: SnapshotStats | null }

export function createAdapter(o: AdapterOptions = {}): AssetIntelligenceAdapter {
  const env = o.env ?? process.env;
  const base = () => { const b = env.APEX_AI_BASE_URL; if (!b) throw new AdapterError('APEX_AI_BASE_URL is not set'); return b; };
  const adapter: AssetIntelligenceAdapter = {
    id: ID,
    lastStats: null,
    rerun: async (params) => postRerun(o, base(), env.APEX_AI_TOKEN, params),
    async *snapshot(since: Date) {
      const state = await callApp(o, base(), env.APEX_AI_TOKEN, 'GET', '/api/state');
      const { drafts, stats } = mapState(state, since);
      adapter.lastStats = stats;
      yield* drafts;
    },
  };
  return adapter;
}

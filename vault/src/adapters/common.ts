/**
 * Shared adapter plumbing (M05, D6): the adapter interface, the error type and
 * the one HTTP call every adapter makes (POST <base>/rerun). Kept apart from
 * index.ts so the adapters can import it without a circular import.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type OutputValue = { value: unknown; unit?: string; low?: unknown; high?: unknown };
export interface RerunResult { outputs: Record<string, OutputValue>; inputs?: any[]; assumptions?: Record<string, any> }

/** A run the adapter built from an app snapshot. The job adds id, created_at, project_id and legal_tag. */
export interface RunRecordDraft {
  job: string; tool_version: string; tool_commit: string; author: string; title?: string;
  inputs: any[]; assumptions?: Record<string, any>; params: Record<string, unknown>; outputs: Record<string, OutputValue>;
  input_hash: string; status: 'draft'; asset_ids?: string[];
  facets: { capture: 'snapshot'; [k: string]: unknown };
}

export interface ExternalAdapter {
  id: string;
  rerun(params: Record<string, unknown>): Promise<RerunResult>;
  snapshot?(since: Date): AsyncIterable<RunRecordDraft>;
}

export type Env = Record<string, string | undefined>;
export type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
export interface AdapterOptions { env?: Env; fetch?: FetchLike; timeoutMs?: number }

/** The upstream app failed or answered something unusable. The vault reports it as 502. */
export class AdapterError extends Error {
  status = 502; code = 'adapter_failed';
  constructor(message: string) { super(message); }
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Current version and commit of an external app from tools/<id>/tool.json (the catalog's source), with a fallback. */
export function currentVersion(toolId: string, fallback: { version: string; commit: string }): { version: string; commit: string } {
  try {
    const m = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tools', toolId, 'tool.json'), 'utf8'));
    const v = (m.versions ?? []).find((x: any) => x.version === m.aliases?.current);
    if (v?.version && v?.commit) return { version: v.version, commit: v.commit };
  } catch { /* fall through */ }
  return fallback;
}

export function endpoint(base: string, p: string): string { return `${base.replace(/\/+$/, '')}${p}`; }

/** Call the app. Bearer token when configured; JSON in, JSON out; any failure becomes an AdapterError. */
export async function callApp(o: AdapterOptions, baseUrl: string, token: string | undefined, method: 'GET' | 'POST', p: string, body?: unknown): Promise<any> {
  const f: FetchLike = o.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const url = endpoint(baseUrl, p);
  let res;
  try {
    res = await f(url, {
      method,
      headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
    });
  } catch (e: any) { throw new AdapterError(`${method} ${url} failed: ${e?.message ?? e}`); }
  const text = await res.text();
  if (!res.ok) throw new AdapterError(`${method} ${url} answered ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new AdapterError(`${method} ${url} did not return JSON`); }
}

/** POST <base>/rerun {params} → {outputs, inputs?, assumptions?}; refuses an answer without an outputs object. */
export async function postRerun(o: AdapterOptions, baseUrl: string, token: string | undefined, params: Record<string, unknown>): Promise<RerunResult> {
  const j = await callApp(o, baseUrl, token, 'POST', '/rerun', { params });
  if (!j || typeof j !== 'object' || !j.outputs || typeof j.outputs !== 'object' || Array.isArray(j.outputs)) throw new AdapterError('/rerun must answer {outputs: {...}, inputs?, assumptions?}');
  return { outputs: j.outputs, ...(Array.isArray(j.inputs) ? { inputs: j.inputs } : {}), ...(j.assumptions && typeof j.assumptions === 'object' ? { assumptions: j.assumptions } : {}) };
}

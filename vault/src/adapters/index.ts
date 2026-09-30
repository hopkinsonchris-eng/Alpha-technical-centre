/** External-app adapters (M05, D6). adapterFor(toolId) answers only when the app's base URL is configured. */
import type { AdapterOptions, Env, ExternalAdapter } from './common.ts';
import * as ai from './apex-asset-intelligence.ts';
import * as m3d from './apex-3d-model.ts';

export type { ExternalAdapter, RunRecordDraft, RerunResult, AdapterOptions } from './common.ts';
export { AdapterError } from './common.ts';

const REGISTRY: Record<string, { baseEnv: string; envVars: string[]; create: (o?: AdapterOptions) => ExternalAdapter }> = {
  [ai.ID]: { baseEnv: 'APEX_AI_BASE_URL', envVars: ai.ENV_VARS, create: ai.createAdapter },
  [m3d.ID]: { baseEnv: 'APEX_3D_BASE_URL', envVars: m3d.ENV_VARS, create: m3d.createAdapter },
};

/** The adapter for a tool id, or undefined when there is none or its base URL env var is unset. */
export function adapterFor(toolId: string, o: AdapterOptions = {}): ExternalAdapter | undefined {
  const r = REGISTRY[toolId];
  const env: Env = o.env ?? process.env;
  if (!r || !env[r.baseEnv]) return undefined;
  return r.create(o);
}

/** Env vars an operator must set to enable a tool's adapter (for error messages). Empty when the tool has no adapter. */
export function adapterEnvVars(toolId: string): string[] { return REGISTRY[toolId]?.envVars ?? []; }

/**
 * APEX 3D Model adapter (M05, D6). Re-run only: the 3D viewer has no state
 * endpoint to snapshot, so its runs arrive by push (POST /api/app/runs).
 * Env: APEX_3D_BASE_URL (e.g. https://apex-3d-model.uk), APEX_3D_TOKEN (bearer the app checks on /rerun).
 */
import { postRerun, AdapterError, type AdapterOptions, type ExternalAdapter } from './common.ts';

export const ID = 'apex-3d-model';
export const ENV_VARS = ['APEX_3D_BASE_URL', 'APEX_3D_TOKEN'];

export function createAdapter(o: AdapterOptions = {}): ExternalAdapter {
  const env = o.env ?? process.env;
  return {
    id: ID,
    async rerun(params) {
      const base = env.APEX_3D_BASE_URL;
      if (!base) throw new AdapterError('APEX_3D_BASE_URL is not set');
      return postRerun(o, base, env.APEX_3D_TOKEN, params);
    },
  };
}

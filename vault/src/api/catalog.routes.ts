/**
 * M03: the tool catalog. Built from the repo root at first request, cached for
 * 60 s. Wave 2: external apps' live versions (sidecar version_url) are fetched
 * when the routes mount and every hour after, and written into each tool's
 * `hub.live_version`; `?live=wait` waits for the refresh in flight (tests).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { buildCatalog, liveVersions, resolve, withLiveVersions, type Catalog, type LiveVersion } from '../catalog.ts';

const TTL_MS = 60_000;
const LIVE_EVERY_MS = 60 * 60_000;
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function register(app: Hono<Env>, deps: RouteDeps): void {
  const root = process.env.CATALOG_ROOT_DIR ?? DEFAULT_ROOT;
  let cached: { at: number; catalog: Catalog } | undefined;
  let live = new Map<string, LiveVersion | null>();
  const base = (): Catalog => {
    if (!cached || Date.now() - cached.at > TTL_MS) cached = { at: Date.now(), catalog: buildCatalog(root) };
    return cached.catalog;
  };
  const get = (): Catalog => withLiveVersions(base(), live);

  // Live versions: never block a request on an external host; refresh in the background.
  let inflight: Promise<void> | null = null;
  const refresh = (): Promise<void> => {
    if (!inflight) inflight = liveVersions(base(), { fetch: deps.fetch }).then(m => { live = m; }).catch(() => {}).finally(() => { inflight = null; });
    return inflight;
  };
  // Only a server that hands in a fetch (src/server.ts) talks to external hosts; tests stay offline unless they inject one.
  if (deps.fetch && process.env.CATALOG_LIVE_VERSIONS !== '0') {
    refresh();
    const timer = setInterval(() => refresh(), LIVE_EVERY_MS);
    timer.unref?.();
  }

  app.get('/api/catalog', async (c) => {
    if (c.req.query('live') === 'wait') await (inflight ?? refresh());
    return c.json(get());
  });
  app.get('/api/tools/:id/resolve', (c) => {
    const id = c.req.param('id');
    try { return c.json(resolve(get(), id)); }
    catch (e) {
      if ((e as any).status === 404) return c.json({ error: { code: 'not_found', message: (e as Error).message } }, 404);
      throw e;
    }
  });
}

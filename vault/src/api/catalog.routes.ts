/** M03: the tool catalog. Built from the repo root at first request, cached for 60 s. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { buildCatalog, resolve, type Catalog } from '../catalog.ts';

const TTL_MS = 60_000;
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  const root = process.env.CATALOG_ROOT_DIR ?? DEFAULT_ROOT;
  let cached: { at: number; catalog: Catalog } | undefined;
  const get = (): Catalog => {
    if (!cached || Date.now() - cached.at > TTL_MS) cached = { at: Date.now(), catalog: buildCatalog(root) };
    return cached.catalog;
  };

  app.get('/api/catalog', (c) => c.json(get()));
  app.get('/api/tools/:id/resolve', (c) => {
    const id = c.req.param('id');
    try { return c.json(resolve(get(), id)); }
    catch (e) {
      if ((e as any).status === 404) return c.json({ error: { code: 'not_found', message: (e as Error).message } }, 404);
      throw e;
    }
  });
}

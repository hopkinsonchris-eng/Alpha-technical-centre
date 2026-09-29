/**
 * Route registry. Each wave-1+ module owns one `<name>.routes.ts` file in this
 * directory exporting `register(app, deps)`. Files are discovered at startup,
 * so adding a module never edits another module's file.
 *   M02 → runs, items, projects, organisations, dispatches, settings
 *   M03 → catalog     M08 → stale     M12 → search     M13 → draft
 *   M15 → lessons     M16 → analogues
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { Db } from '../db/client.ts';

export interface RouteDeps { db: Db }
export interface RouteModule { register(app: Hono<Env>, deps: RouteDeps): void }

const DIR = path.dirname(fileURLToPath(import.meta.url));

export async function mountRoutes(app: Hono<Env>, deps: RouteDeps): Promise<string[]> {
  const files = readdirSync(DIR).filter(f => f.endsWith('.routes.ts')).sort();
  for (const f of files) {
    const m = (await import(pathToFileURL(path.join(DIR, f)).href)) as RouteModule;
    if (typeof m.register !== 'function') throw new Error(`${f} must export register(app, deps)`);
    m.register(app, deps);
  }
  return files;
}

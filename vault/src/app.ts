/**
 * Hono application (M01). Routes are mounted here; business handlers arrive
 * with M02 onward. Every /api route (except /api/health) requires a Person.
 */
import { Hono } from 'hono';
import type { Db } from './db/client.ts';
import { authenticate, AuthError, configFromEnv, type AuthConfig, type Person } from './auth.ts';
import { mountRoutes } from './api/index.ts';

export type Env = { Variables: { person: Person; db: Db } };

export interface AppDeps { db: Db; auth?: AuthConfig; version?: string }

export async function createApp({ db, auth = configFromEnv(), version = process.env.RENDER_GIT_COMMIT ?? 'dev' }: AppDeps) {
  const app = new Hono<Env>();

  app.get('/api/health', async (c) => {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM schema_migrations');
    return c.json({ ok: true, version, migrations: rows[0].n, backend: db.backend });
  });

  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next();
    try {
      c.set('person', await authenticate(c.req.raw.headers, auth, db));
      c.set('db', db);
    } catch (e) {
      const status = e instanceof AuthError ? 401 : 500;
      return c.json({ error: { code: status === 401 ? 'unauthenticated' : 'error', message: (e as Error).message } }, status);
    }
    await next();
  });

  app.get('/api/me', (c) => c.json(c.get('person')));
  await mountRoutes(app, { db });

  app.notFound((c) => c.json({ error: { code: 'not_found', message: `no route for ${c.req.method} ${c.req.path}` } }, 404));
  app.onError((err, c) => {
    const status = (err as any).status ?? 500;
    return c.json({ error: { code: status === 400 ? 'invalid' : status === 409 ? 'conflict' : status === 403 ? 'forbidden' : 'error', message: err.message, errors: (err as any).errors } }, status);
  });
  return app;
}

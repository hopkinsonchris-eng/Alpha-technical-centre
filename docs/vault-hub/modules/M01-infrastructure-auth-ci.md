# M01 — Infrastructure, authentication, CI

**Wave 0 · Tier A for auth and secrets, Tier B for the rest · Depends on: M00 · Size M**

## Purpose
Stand up the `vault-api` service, database, storage, Cloudflare Access and
CI, so every later module deploys the same way. Prove the Access-on-paths
assumption before anything else is built.

## Read first
`render.yml`, `HANDOVER.md` §1 and §4 (Cloudflare holds DNS; Chris owns billing and DNS changes: **do not change MX records**), `../06-architecture.md` §1, §7, §8.

## Deliverables
- `vault/package.json`, `tsconfig.json`, Hono app skeleton with `GET /api/health` and `GET /api/me`.
- `render.yml`: add `vault-api` web service (root `vault/`, Node 22) and cron job entries (`nightly-staleness`, `weekly-dream`, `mail-poll` every 5 min, `miners` weekly) that call `node dist/jobs/<name>.js`; environment variable names documented in `vault/.env.example` (never values).
- Supabase project (Pro) with pgvector enabled; `001_init.sql` applied by a `npm run migrate` script.
- Cloudflare Access application covering `www.alpha-technical-centre.com/hub/*`, `/api/*`, `/mcp` with the one-time-PIN identity provider restricted to `@alpha-technical-centre.com`; `vault/src/auth.ts` verifies the `Cf-Access-Jwt-Assertion` header against the team's public keys and maps email → Person (creating on first sight with role `associate`; partners set in `vault/master/people.json`).
- Route `/api/*` from the static host to `vault-api` (Cloudflare Worker route or Render rewrite; record which in `vault/README.md`).
- GitHub Actions: `npm test` at root, `vault/npm test`, schema validation of every fixture, a grep that fails on key patterns (`sk-ant-`, `AIza`, `Bearer ` literals) in any served file (AC12), and a public-page diff against `main` for every URL in `sitemap.xml` (AC13).
- `AGENTS.md` at repo root, imported from `CLAUDE.md`, with build/test commands and the module-session procedure in `../07-build-plan.md` §6.

## Contract
```ts
export type Person = { id: string; email: string; name: string; role: 'partner'|'associate' };
export function requireUser(c: Context): Person; // throws 401
```

## Acceptance criteria
1. Unauthenticated request to `/hub/` and `/api/me` is redirected or refused by Access; authenticated `/api/me` returns the Person.
2. A public page (`/about.html`) is reachable without Access.
3. CI fails on a fixture that violates a schema and on a served file containing a key pattern.
4. `npm run migrate` on an empty database ends with all tables present.
5. `render.yml` still deploys the static site unchanged (AC13 diff is empty).

## Smoke tests
`vault/test/auth.test.mjs` (JWT verification with a recorded test key), `.github/workflows/ci.yml` runs green, a manual checklist in `vault/README.md` for the Access application with screenshots attached to the PR.

## Out of scope
Any business endpoint; DNS or MX changes; billing.

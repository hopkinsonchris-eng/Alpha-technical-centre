# AGENTS.md — how to work in this repository

Read this before touching anything. `CLAUDE.md` imports it.

## What this repo is
- Root: the public static site for Alpha Technical Centre (no build step) and its browser tools. See `README.md`, `STYLE-GUIDE.md`, `HANDOVER.md`.
- `vault/`: the Vault API (Node 22, TypeScript, Hono, Postgres + pgvector). See `vault/README.md`.
- `hub/`: the staff dashboard (static pages using the site's `style.css`).
- `docs/vault-hub/`: the design pack. **Every module has a spec in `docs/vault-hub/modules/M??-*.md`; read yours first, then `docs/vault-hub/06-architecture.md` §2 and §6, then the schemas in `docs/vault-hub/schemas/`.**

## Commands
```bash
npm test                     # root calculators (node --test test/*.test.mjs)
cd vault && npm test         # vault: tsx --test, embedded Postgres, no services needed
cd vault && npm run typecheck
cd vault && DEV_USER_EMAIL=chris@alpha-technical-centre.com npm run dev
python3 -m http.server 8000  # preview the site and hub
```

## Rules
1. Smoke tests first: write or extend the tests named in your module spec so they fail, then implement until green, then run the full suite.
2. Touch only the files your spec lists as deliverables. Routes go in your own file under `vault/src/api/` registered through `vault/src/api/index.ts`; never edit another module's file.
3. Schemas in `docs/vault-hub/schemas/` are Tier A contracts: do not change them. If a spec cannot be met as written, stop and say so in the PR.
4. Confidentiality is structural: anything that reads records goes through `isVisible`/the gateway with a scope. No handler returns a record without checking scope.
5. No secrets in files served to browsers. No provider calls from the browser.
6. Every public page must stay byte-identical (CI diffs the sitemap URLs against `main`). Hub pages are `noindex` and listed in `robots.txt` Disallow.
7. House style for any page: `STYLE-GUIDE.md` (shared `style.css`, `data-en`/`data-es` on every text node).
8. Commit messages: one line saying what changed for whom, body explaining why. No model names in commits.
9. Runs and items are immutable: supersede, never overwrite; hide, never delete.

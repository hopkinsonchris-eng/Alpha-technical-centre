# vault-api

Store of record for Alpha Technical Centre: runs, documents, correspondence,
legal and billing records, research, lessons. Node 22 + TypeScript (Hono),
Postgres 16 + pgvector. Design: `../docs/vault-hub/`.

```bash
cd vault
npm install
npm test                 # embedded Postgres (PGlite); no services needed
DEV_USER_EMAIL=chris@alpha-technical-centre.com npm run dev   # http://localhost:8787/api/health
DATABASE_URL=postgres://... npm run migrate                    # apply db/*.sql to Supabase
```

## Deploy (Render, from render.yml)

`vault-api` is a Render web service with root directory `vault/`. It runs
migrations on boot. Cron jobs (`nightly-staleness`, `weekly-dream`,
`mail-poll`, `miners`) call `node --import tsx src/jobs/<name>.ts` and
arrive with M08, M10, M11, M15.

## Cloudflare Access checklist (M01, done once by Chris or the developer with Cloudflare access)

The public site stays public. Only the staff surfaces are gated.

1. Zero Trust → Settings → Authentication → add **One-time PIN**.
2. Zero Trust → Access → Applications → **Add an application → Self-hosted**.
   Name `ATC Hub`. Application domain `www.alpha-technical-centre.com`, path `hub`
   (covers `/hub/*`). Add two more paths to the same application: `api` and `mcp`.
   Session duration 24 h.
3. Policy: **Allow** · Include · *Emails ending in* `@alpha-technical-centre.com`.
4. Copy the application's **AUD tag** → Render env `CF_ACCESS_AUD`. Team domain
   (`<team>.cloudflareaccess.com`) → `CF_ACCESS_TEAM_DOMAIN`.
5. Route the API: Cloudflare → Workers Routes → `www.alpha-technical-centre.com/api/*`
   and `/mcp*` → a one-line Worker that proxies to the `vault-api` Render URL,
   forwarding the `Cf-Access-Jwt-Assertion` header (the worker is in
   `cloudflare/api-proxy.js`). Access runs before the Worker, so the API only
   ever sees authenticated requests; the API still verifies the JWT itself.
6. Verify (AC in M01): `/hub/` and `/api/me` redirect to the Access login when
   signed out; `/about.html` loads without login; `/api/me` returns your Person
   after the PIN.

If Access cannot be scoped by path on this zone, fall back to a dedicated
hostname `hub.alpha-technical-centre.com` (CNAME to Render) and gate the whole
host; the Hub pages are served from the same repo either way.

## Re-run runner (M08)

`POST /api/runs/:id/rerun` drives the tool page in headless Chromium. It
needs `SITE_ORIGIN` (the static site's origin) and a Chromium binary:
`RERUN_CHROMIUM=/path/to/chrome`, or `PLAYWRIGHT_BROWSERS_PATH`, or a
Playwright cache. On Render's native Node runtime there is no Chromium, so
either deploy `vault-api` with the Docker runtime (`FROM
mcr.microsoft.com/playwright:v1.63.0-noble`) or leave re-runs to the Hub,
which can drive the same `ATC_TOOL` hook in the partner's own browser
(M07/M08 UI). Without a browser the endpoint answers 503 and everything
else keeps working.

## Operational notes from the build

- **OCR.** Scanned PDFs are OCRed with tesseract.js. The English language
  data is not bundled: put `eng.traineddata.gz` in `vault/.storage/tessdata/`
  (or set `VAULT_TESSDATA_DIR`), or set `VAULT_OCR_DOWNLOAD=1` to let it
  download. Without it scans are stored with `needs_ocr` and picked up later.
- **xlsx package.** `xlsx@0.18.5` (npm) carries open advisories with no npm
  fix; uploaded spreadsheets are untrusted input. Swap to SheetJS's own CDN
  build when convenient.
- **Zoho and feed endpoints.** WorkDrive, Zoho Books, ANP Brazil and
  Perupetro were built against documented shapes and recorded fixtures, not
  live calls; verify against a real account before relying on them. ANP and
  Perupetro are off in `master/topics.json` until then.
- **Re-run runner and PDF rendering** need Chromium (see above).

## Layout

```
db/            migrations (001_init.sql …)
src/legal.ts   legal-tag union and visibility (the two confidentiality rules)
src/schemas.ts JSON Schema validation against ../docs/vault-hub/schemas
src/auth.ts    Cloudflare Access JWT → Person
src/app.ts     Hono app and middleware
src/db/        client (pg or PGlite) and migrate
master/        basins, fields, wells, people
reference/     price decks, fiscal terms
firm/assets/   letterhead, templates, house style, logos
test/          node --test via tsx; fixtures under test/fixtures
```

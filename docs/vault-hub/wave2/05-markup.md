# Wave 2 — Gate 2 Markup: the Opportunity-centred Hub

Cites Choice Sheet decisions W2-D1…D5 and Innovation Options A and C. Built
only on the user's explicit approval of this document.

## 1. BEFORE → AFTER, surface by surface

### 1.1 Hub front page `hub/index.html` (W2-D1, W2-D2, P13, P19, Option C)

BEFORE: "Today": catalog grid of every tool, "Where I worked in the last 90 days" project cards, attention cards, latest runs.

AFTER, top to bottom:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ HUB · Wednesday 30 September            [ Find across the Vault ] [⌘K]   │
├───────────────────────────────────┬──────────────────────────────────────┤
│                                   │ WHERE WE WORK             5 countries│
│        ( the globe )              │ ● Venezuela   2 projects   ▲1 stale  │
│   navy sphere, gold countries     │ ● Kazakhstan  1 project              │
│   slowly turning; pulsing dots    │ ● Gabon       1 project              │
│   at project coordinates;         │ ● Egypt       1 project    ● NDA 12d │
│   drag · pinch · scroll · tap     │ ● Colombia    1 project              │
│                                   │ [ Brief this country ] (after a tap) │
├───────────────────────────────────┴──────────────────────────────────────┤
│ OPPORTUNITY REGISTER   stage ▾  risk ▾  country ▾  [+ Add opportunity]   │
│ name · country · client · stage · fact→plan · risk · owner · updated     │
│ (rows are the Vault projects; clicking a row opens the project file)     │
├──────────────────────────────────────────────────────────────────────────┤
│ Waiting on a partner · Latest runs in your scope        (unchanged)      │
├──────────────────────────────────────────────────────────────────────────┤
│ TOOLS   [Production 9] [Experimental 2] [Older 3]   (production default) │
└──────────────────────────────────────────────────────────────────────────┘
```

Globe behaviour (W2-D2): orthographic projection on a `<canvas>` (d3-geo, self-hosted under `hub/vendor/`), Natural Earth 110m polygons pruned to `iso2`, `en`, `es` names (`hub/geo/countries-110m.json`, built once by `scripts/build-geo.mjs`, committed). One revolution in about 90 s; slows to a quarter on hover; drag rotates with inertia; wheel and pinch zoom between 1× and 4×; tapping a country flies to it (rotate and zoom, 900 ms) and selects it; `?country=KZ` in the URL reproduces the state so it is linkable. Colours: navy sphere with a soft atmosphere glow, cream land, gold for countries with projects, amber outline when a project there has a stale final run or an unfiled document, red outline when a legal tag expires within 30 days (Option C). Project coordinates are pulsing dots. Reduced-motion users get a still globe and instant flights. The country list on the right is the keyboard and screen-reader path; the canvas is `aria-hidden` with a text alternative. On phones (<640 px) the globe sits above the list at full width.

Selecting a country: the list becomes that country's projects (name, client, stage, last run, attention), with "All countries" to go back and **Brief this country** (Option A, §1.6).

Register (W2-D1): the table is `GET /api/projects` with the new fields; "Add opportunity" (partners) opens the New project form extended with country, coordinates, stage and the register fields. The potential-model calculation stays in the Opportunity Register tool, which now opens from the project toolbar in that project's context (§1.2).

Tools (P17): filter chips with counts; `production` shown by default; `experimental` behind its chip; `deprecated` in a collapsed "Older tools" group; `retired` never. The choice is remembered per browser.

### 1.2 Project file `hub/project.html` (W2-D3, P14, P16, P21)

BEFORE: header with client, legal tag, KPIs; tabs; "Add documents"; record panel with a JSON dump.

AFTER:

```
┌ HUB / PROJECT FILE ────────────────────────────────────────────────────────┐
│ Western Kazakhstan Brownfield        KZ Kazakhstan · Intermediary          │
│ [Initial screen ▾]  client —  legal tag lt-firm  members 2                 │
│ TOOLS ▸ [Opportunity Register] [Nodal Analysis] [Financial Model] [APEX 3D]│
│         each opens with ?project=kaz-brownfield                            │
│ OPPORTUNITY   fact 16 → plan 22 kboe/d · risk amber 54 · owner Tom         │
│ thesis … · next: Validate ownership and sale status        [Edit]          │
│ Timeline · Headline numbers · Lineage · Basis notes · Lessons · Scorecard  │
│ (timeline now also shows stage changes: "Qualified ← Initial screen, Chris")│
└────────────────────────────────────────────────────────────────────────────┘
```

Toolbar: production tools whose sidecar `tools/<id>/hub.json` declares `"context": ["project"]`, ordered by `toolbar`, opening `entry` with `?<param>=<project id>` (browser tools already read `project` through `js/vault-client.js`; external apps get the same query string). Stage: a select for members and partners, writing `PATCH /api/projects/:id`; every change appends to `stage_history` and an audit event, and appears on the timeline. Opportunity card: the register fields, editable by members and partners.

Record panel (P15): highlights strip per record kind; related cards; the raw record behind a "Details" disclosure.

| kind | highlights | related cards |
|---|---|---|
| document | type, project, legal tag, version, ingested, chunks indexed, stale | versions (supersedes / superseded by), cites, cited by, original download |
| run | job and tool version, status, headline outputs (first three), inputs count, stale with reason | project, tool, supersedes / superseded by, dispatches that quote it |
| reference set | id, kind | the entries |

Layout fix: at 1200 px and wider the page keeps the side column but the project grids collapse to one column while the panel is open; below 1200 px the panel is a bottom sheet over a scrim (fixed, 85 vh, scrollable) so the page underneath is never squeezed. Verified at 1024×768 and 1366×1024 (iPad landscape and portrait) by the smoke tests.

### 1.3 Data model and API (W2-D1, P21)

Migration `vault/db/002_opportunities.sql` (additive, no Tier A schema touched):

```sql
ALTER TABLE projects
  ADD COLUMN country        char(2),                     -- ISO 3166-1 alpha-2
  ADD COLUMN lat            double precision,
  ADD COLUMN lon            double precision,
  ADD COLUMN stage          text NOT NULL DEFAULT 'Initial screen',
  ADD COLUMN stage_history  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{stage, at, by}]
  ADD COLUMN register       jsonb NOT NULL DEFAULT '{}'::jsonb;   -- source, current, plan, risk, risk_score, attractiveness, thesis, next, owner, risks
CREATE TABLE country_briefs (…);   -- §1.6
```

Stages are the register's five plus `Won`, `Lost`, `Closed`. Status `prospect` is an opportunity; `active` is a project we are working; the id never changes between them.

Routes (own file `vault/src/api/projects.wave2.routes.ts`, registered in `index.ts`; `projects.routes.ts` gains the new fields on create and list only):

| route | who | does |
|---|---|---|
| `POST /api/projects` | partner | accepts `country`, `lat`, `lon`, `stage`, `register` |
| `PATCH /api/projects/:id` | member or partner, project visible | `stage`, `status`, `country`, `lat`, `lon`, `register`; stage changes append to `stage_history`; audit `project.update` |
| `GET /api/projects/summary` | anyone signed in | per country: code, names en/es, projects visible to the caller with stage, client, last run, attention flags; counts only over what the caller may see |
| `POST /api/countries/:code/brief` | anyone signed in | §1.6 |

Scope: every row passes `canSee` before it counts, as today (rule 4).

### 1.4 Catalog and versions (W2-D3, P17)

Sidecar `tools/<id>/hub.json` (documented in `docs/vault-hub/wave2/hub-sidecar.md`, Hub-owned, not a Tier A schema):

```json
{ "context": ["project"], "param": "project", "toolbar": 10, "version_url": "https://apex-app2.onrender.com/version.json" }
```

`scripts/build-catalog.mjs` and `vault/src/catalog.ts` merge it as `hub` on the catalog entry, exactly as `releases` is merged today; a missing sidecar means `hub: null`. The Vault fetches every `version_url` at boot and hourly with a 3 s timeout and reports `hub.live_version = {version, released_at, checked_at}` or `null`; the Hub card shows "v4.1.0 · published by the app" or "version unverified" instead of the placeholder. `vault/ADAPTERS.md` gets the two-line instruction for the APEX developer: publish `/version.json` as `{"version": "...", "released_at": "YYYY-MM-DD"}`.

### 1.5 Command menu `hub/palette.js` (W2-D4, P20)

Cmd/Ctrl+K, or the header button, on every Hub page. Groups in order: **In this project** (on a project page: open each toolbar tool here, add documents, change stage), **Projects** (name, country, client, stage), **Countries** (fly the globe there), **Tools** (production), **Pages**. Fuzzy match on the typed text; arrow keys and Enter; Esc closes. No LLM (Option D).

### 1.6 Country brief (Option A)

`POST /api/countries/:code/brief` collects the projects in the country the caller may see, gathers for each the latest final run per job, the newest documents, analogue rows, confirmed lessons and open dispatches through the existing retrieval gateway, and asks the drafting engine (M13's provider path) for a cited brief: situation, what we hold, headline numbers, contradictions between runs and letters, open questions. The result is cached in `country_briefs (country, scope_hash, source_hash, body, created_at)` where `scope_hash` is the set of legal tags the sources carry and `source_hash` the content hash of the source set; a cached brief is served only to a caller whose visible tags cover its `scope_hash`, and regenerated when `source_hash` changes. Nothing is written to `items`, so a brief can never widen anyone's scope. Without a provider the route answers 501 with the same message `/api/llm` uses, and the button says so.

## 2. Files

| area | files |
|---|---|
| geo data | `scripts/build-geo.mjs` (new), `hub/geo/countries-110m.json` (new, generated, committed), `hub/vendor/d3-geo.min.js` + `LICENSE` (new) |
| Hub | `hub/index.html`, `hub/hub.js`, `hub/hub.css`, `hub/globe.js` (new), `hub/palette.js` (new), `hub/project.html`, `hub/project.js`, `hub/record.js` (new: highlights and related cards), every `hub/*.html` (⌘K button, palette script) |
| Vault | `vault/db/002_opportunities.sql`, `vault/src/api/projects.routes.ts` (new fields), `vault/src/api/projects.wave2.routes.ts` (new), `vault/src/api/countries.routes.ts` (new), `vault/src/api/index.ts`, `vault/src/catalog.ts`, `vault/src/api/catalog.routes.ts` (live versions), `vault/src/api/common.ts` (project row gains the new columns), `vault/ADAPTERS.md` |
| catalog | `scripts/build-catalog.mjs`, `tools/*/hub.json` (new, one per tool that takes a project; `version_url` on the three APEX apps), `hub/catalog.json` (regenerated), `tools/opportunity-register/tool.json` (lifecycle → deprecated, `aliases.current` → the Hub, in the last PR) |
| docs | `docs/vault-hub/wave2/hub-sidecar.md`, `docs/vault-hub/08-decision-log.md` (wave 2 entries), `HANDOVER.md` (globe data and version.json notes) |
| tests | `test/geo.test.mjs`, `test/e2e/hub-globe.spec.mjs`, `test/e2e/hub-project-toolbar.spec.mjs`, `test/e2e/hub-record-panel.spec.mjs`, `test/e2e/hub-palette.spec.mjs`, `test/e2e/hub-today.spec.mjs` (catalog filter), `vault/test/projects.wave2.test.ts`, `vault/test/catalog.sidecar.test.ts`, `vault/test/countries.brief.test.ts` |

Not touched: anything in `docs/vault-hub/schemas/`, any public page in the sitemap, `opportunity-register.html` (its manifest only).

## 3. Acceptance criteria

| # | criterion |
|---|---|
| AC1 | `hub/geo/countries-110m.json` has ≥ 170 features, each with `iso2` (two capitals), `en` and `es` names, and is under 400 KB; France, Norway and Kosovo carry real codes, not `-99`. |
| AC2 | The front page draws the globe on a canvas and rotates it: two frames 2 s apart differ; with `prefers-reduced-motion: reduce` they are identical. |
| AC3 | Countries with visible projects are listed on the right with correct counts computed only from projects the caller may see; a country with a stale final run shows the amber flag, an expiring tag the red one. |
| AC4 | Clicking a country in the list (or tapping it on the globe) sets `?country=XX`, shows that country's projects, and loading that URL directly restores the same state. |
| AC5 | Clicking a project in the country list opens `project.html?id=<id>`. |
| AC6 | The register table lists the projects with country, stage, fact→plan, risk and owner; stage, risk and country filters narrow it; "Add opportunity" (partners only) creates a `prospect` project with country, coordinates, stage and register fields through `POST /api/projects`, and the row appears. |
| AC7 | The Tools section shows only `production` tools until the Experimental chip is clicked; deprecated tools are inside a collapsed group; retired tools never appear; the choice persists across a reload. |
| AC8 | A tool with `hub.live_version` shows "published by the app" with that version; a tool with a `version_url` and no live version shows "version unverified"; a tool without a sidecar shows its manifest version as today. |
| AC9 | The project page shows a toolbar with exactly the production tools whose `hub.context` includes `project`, in `toolbar` order, each linking to `entry` with `?<param>=<project id>`; external apps open in a new tab. |
| AC10 | Changing the stage on the project page issues `PATCH /api/projects/:id`, the header updates, and a stage-change entry appears in the timeline; an associate who is not a member gets a 403 and a readable notice. |
| AC11 | `PATCH /api/projects/:id` appends `{stage, at, by}` to `stage_history`, writes an audit event, refuses unknown stages and refuses callers who cannot see the project (404, not 403, so existence is not leaked). |
| AC12 | `GET /api/projects/summary` groups by country, counts only projects visible to the caller, and returns the attention flags; a client-NDA project is absent from another client's associate's summary. |
| AC13 | Opening a document from the timeline shows a highlights strip (type, project, legal tag, version, ingested, chunks, stale) and related cards; the raw JSON is only inside a closed "Details" disclosure. |
| AC14 | With the panel open at 1024×768 and 1366×1024, no timeline text column is narrower than 240 px, the panel is a bottom sheet below 1200 px, and Escape closes it and returns focus. |
| AC15 | Cmd/Ctrl+K opens the palette on every Hub page; typing three letters of a project name and pressing Enter navigates to it; on a project page the first group offers the toolbar tools in that project. |
| AC16 | `POST /api/countries/:code/brief` returns cited paragraphs when a provider is configured (test provider), 501 without one, serves a cached brief only to callers whose visible tags cover its `scope_hash`, and regenerates when a source changes. |
| AC17 | `npm test`, `cd vault && npm test`, `npm run typecheck` and `npm run e2e` are green; the public-page byte-identity check passes. |
| AC18 | Evidence: screenshots of the globe front page, a selected country, the project page with toolbar and opportunity card, the record sheet on an iPad-sized viewport, and the palette, in `docs/vault-hub/evidence/w2-*.png`, taken by the e2e tests on realistic seeded data. |

## 4. Smoke plan (written before implementation)

| AC | test |
|---|---|
| AC1 | `test/geo.test.mjs`: parses the file, asserts count, properties, size and the three code overrides. |
| AC2 | `hub-globe.spec.mjs`: stub `/api/projects/summary`; capture the canvas as PNG twice; assert byte difference; repeat with `reducedMotion: 'reduce'` and assert equality. |
| AC3, AC4, AC5 | `hub-globe.spec.mjs`: seeded summary with Venezuela (stale), Egypt (expiring tag), Kazakhstan; assert list rows, flags, `?country=` round trip, project link. |
| AC6 | `hub-today.spec.mjs`: register rows and filters; "Add opportunity" posts the expected body and re-renders; associate sees no button. |
| AC7, AC8 | `hub-today.spec.mjs`: seeded catalog with all four lifecycles and three version states; chip behaviour, localStorage persistence, version pills. |
| AC9, AC10 | `hub-project-toolbar.spec.mjs`: seeded catalog with sidecars; toolbar order and hrefs; stage select → intercepted PATCH body; 403 path. |
| AC11, AC12 | `vault/test/projects.wave2.test.ts` on embedded Postgres: partner, member, non-member and other-client associate; audit row; 404 on invisible project. |
| AC13, AC14 | `hub-record-panel.spec.mjs` at 1440×900, 1366×1024 and 1024×768: highlights, related cards, `details` closed, column widths via `boundingBox`, Escape and focus. |
| AC15 | `hub-palette.spec.mjs`: keyboard open, fuzzy match, Enter navigation, project-page first group. |
| AC16 | `vault/test/countries.brief.test.ts`: fake provider, 501 without, cache hit and miss, scope refusal. |
| AC17 | the four commands in CI and locally before each push. |
| AC18 | evidence screenshots written by the specs above. |

## 5. Delivery: four pull requests, each green and mergeable on its own

1. **Foundation**: migration, project fields and routes, summary route, catalog sidecar and live versions, catalog filter defaults, record panel and sheet. (AC7, AC8, AC11, AC12, AC13, AC14)
2. **Globe and register**: geo data, globe, country drill-down, register table and Add opportunity. (AC1–AC6)
3. **Context**: toolbar, stage on the project page, opportunity card, command menu. (AC9, AC10, AC15)
4. **Brief**: country brief route and panel; register tool manifest deprecated in favour of the Hub. (AC16)

AC17 and AC18 apply to every PR. Estimated five working days of build; this session can run them back to back.

## 6. Risks and rollback

| risk | mitigation | rollback |
|---|---|---|
| Globe performance on an older iPad | 110m polygons (~10 k points); redraw only on motion; capped device pixel ratio 2 | the country list is the full navigation path; a `?flat=1` switch draws the equirectangular map |
| Natural Earth mirror unavailable when regenerating | the generated file is committed; the script is only for refreshes | none needed |
| `version.json` fetch from the API slows boot | 3 s timeout, in parallel, never blocks boot; failures are `null` | remove `version_url` from the sidecar |
| Brief quality with a thin Vault | the brief states what it has and what is missing; every sentence cited | the button is hidden when the provider is absent; the route can be disabled by env |
| Register fields drift from the register tool's own model | the Hub owns the summary fields only; the potential model stays in the tool's run records | none |
| Migration on production Supabase | additive columns with defaults; runs at boot like 001 | columns are unused by older code; no drop needed |
| Public-page byte identity | no sitemap page touched; CI check remains | revert the PR |

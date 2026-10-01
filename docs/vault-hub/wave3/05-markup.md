# Wave 3 — Gate 2 Markup: fields, contextualisation and live risk

Cites W3-D1…D4 and Options A and B. Built only on explicit approval.

## 1. BEFORE → AFTER

### 1.1 The globe and the country panel (P29, P23)

BEFORE: tapping a country lists its projects; a country with none says "No projects here yet".

AFTER:
```
Venezuela · 1 project                                   [ Create a project here ]
  Barinas–Apure Cluster · Technical review · 2 fields
    ● Barinas (GEM, 8.62 −70.21)   ● Apure (GeoNames, 7.9 −67.5)
[ Brief this country ]   risk 71 · advisory: reconsider travel  (World Monitor, 09:00)
```
- "Create a project here" opens the project form with the country set and the tapped point's
  coordinates filled (the globe reports the geographic point under the tap). Shown to partners
  on every country, with or without projects.
- Each project line lists its attached fields; the globe draws field points (smaller, cream)
  beside the project points (gold). Hovering a field point shows its name.
- When the World Monitor key is set, the country line shows the composite score and advisory
  level with the time fetched; otherwise nothing (no simulation).

### 1.2 The project file: Fields card (P23, P25, P26)

```
FIELDS                                                         [ Add field ]
● Barinas      field · Barinas-Apure basin · 8.62, −70.21 · GEM (Mar 2026) · producing, PDVSA   [dossier] [detach]
● Apure        field · 7.90, −67.50 · GeoNames                                                   [dossier] [detach]
PROPOSED FROM DOCUMENTS
  "…production from the Guafita and La Victoria fields…"  (Data room index, p. 3)
     Guafita → GEM: Guafita (8.0, −69.1, producing)   [Attach]  [Not a field]
     La Victoria → no gazetteer match                   [Attach without location]  [Not a field]
```
- Add field: a search box; candidates come from the Vault's assets first, then the imported
  GEM units, then GeoNames (feature L.OILF) and Wikidata (instance of oil field), each with a
  source pill and coordinates; Attach creates the asset if it is new and links it to the project.
- Proposals come from ingest (§1.3); Attach accepts the proposal (choosing a candidate or none);
  Not a field rejects it. Members and partners may do both.
- Dossier: the public items filed for the field (§1.4) open in the record panel.

### 1.3 Ingest: fields named in a document become proposals (Option A, W3-D1)

After a document is indexed, `extractAssets` runs:
1. With a provider: the model returns `{name, kind: field|block|basin|well|operator, quote}` candidates in JSON; a candidate is kept only if `quote` is verbatim in the text and contains `name`.
2. Without a provider, or in addition: a dictionary pass over the Vault's assets and the GEM units for the project's country (whole-word, case-insensitive).
3. Each kept field/block/basin candidate not already attached to the project becomes a `review_queue` row of kind `asset` with the quote, the page or sheet anchor, the kind and up to three gazetteer matches. Deduplicated on (project, name) while open.
4. The upload result row says "3 fields named: review them in the Fields card".

### 1.4 Attach files a dossier (P27, gazetteer part only, W3-D2)

Attaching a field (from Add field or a proposal) files public items into the project, each with `origin.source` naming the gazetteer, `origin.external_id` the record id or wiki URL, legal tag `lt-public`, and `extracted.kind = 'dossier'`:
- GEM: "Field dossier: <name>" with status, type, on/offshore, operator and owners, discovery, FID and start years, production and reserves as given, the wiki page URL; attribution "Global Oil and Gas Extraction Tracker, Global Energy Monitor, March 2026 release, CC BY 4.0".
- Wikidata: the item's label, description, coordinates, operator, discovery date, with the entity URL.
- GeoNames: the record with its feature code and coordinates.
Deduplicated on `external_id`; re-attaching does not duplicate. These items are ordinary records: searchable, citable in drafts and briefs, visible on the timeline.

### 1.5 World Monitor (Option B, W3-D3)

`vault/src/intel/worldmonitor.ts`: base `https://api.worldmonitor.app`, header `X-WorldMonitor-Key` from `WORLD_MONITOR_API_KEY` (never sent to a browser). Calls, each cached in memory for an hour and rate-limit aware (429 honours `Retry-After`):
- `GET /api/intelligence/v1/get-country-risk?country_code=XX` → `cii.combinedScore`, `advisoryLevel`, `components`, `computedAt`.
- `GET /api/conflict/v1/list-acled-events?country=XX&start=<30 days ago>` → events (type, admin1, actors, fatalities, date).
- `GET /api/news/v1/list-country-headlines?countries=XX` → recent headlines when available.
Used by: `GET /api/countries` (score and level per country, `null` without a key) and the brief's context ("LIVE RISK" block cited as `[wm:risk:XX]`, `[wm:acled:<id>]`, `[wm:news:<n>]`; the citation check learns the `wm` prefix; sources list the record ids and URLs). The brief's meta line says "World Monitor: live, fetched 09:00" or "not connected (set WORLD_MONITOR_API_KEY)". The public register page keeps its labelled simulation untouched.

### 1.6 Data

Migration `004_assets_wave3.sql` (additive):
```sql
ALTER TABLE assets ADD COLUMN IF NOT EXISTS lat double precision, ADD COLUMN IF NOT EXISTS lon double precision,
  ADD COLUMN IF NOT EXISTS location_source text, ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS created_by text, ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE review_queue DROP CONSTRAINT review_queue_kind_check;
ALTER TABLE review_queue ADD CONSTRAINT review_queue_kind_check CHECK (kind IN ('lesson','nda-expiry','organisation','rerun-delta','reconfirm-lesson','stale','asset'));
```
`projects.asset_ids` stays the link (already in the schema). GEM units are imported by `scripts/import-gem.mjs` from the .xlsx Chris downloads (the tracker is behind a form; no automated fetch) into `vault/master/gem-fields.json` (name, country, coordinates and accuracy, type, status, on/offshore, operator, owners, years, production, reserves, wiki URL) and seeded into `assets` as `field:<country>:<slug>` with `source_url` the wiki page; refreshed per GEM release. Until the file is imported, Add field and proposals fall back to GeoNames and Wikidata and say so.

### 1.7 Routes (new file `vault/src/api/assets.routes.ts`; `countries.routes.ts` and `rerun.routes.ts` accept extended)

| route | who | does |
|---|---|---|
| `GET /api/assets/locate?name=&country=` | signed in | candidates from Vault, GEM, GeoNames (`GEONAMES_USERNAME`), Wikidata, each `{name, kind, lat, lon, source, source_url, confidence, asset_id?}` |
| `POST /api/assets` | member or partner of the project it is for | creates `field|block|basin|well` with `location_source`; id `field:<cc>:<slug>` |
| `GET /api/projects/:id/assets` | project visible | attached assets with locations and dossier item ids |
| `POST /api/projects/:id/assets` `{asset_id}` or `{create:{…}}` | writable project | attaches (creating if needed), files the dossier (§1.4), audits |
| `DELETE /api/projects/:id/assets/:asset_id` | writable project | detaches; dossier items stay (hidden only by the usual route) |
| `POST /api/queue/review/:id/accept` kind `asset` `{asset_id?|create?}` | writable project (not partner-only) | attaches as above, resolves the proposal |
| `GET /api/countries` | as today | adds `assets` per project and `risk` per country |

## 2. Files

| area | files |
|---|---|
| Vault | `vault/db/004_assets_wave3.sql`, `vault/src/api/assets.routes.ts` (new), `vault/src/assets/gazetteers.ts` (new: GEM, GeoNames, Wikidata lookups with fetch injection), `vault/src/assets/dossier.ts` (new), `vault/src/ingest/entities.ts` (new: `extractAssets`), `vault/src/ingest/index.ts` (one call after indexing), `vault/src/intel/worldmonitor.ts` (new), `vault/src/api/countries.routes.ts`, `vault/src/llm/brief.ts` and `draft.ts` (`wm` citations), `vault/src/api/rerun.routes.ts` (accept for kind asset), `vault/src/db/seed.ts` (GEM units), `vault/master/gem-fields.json`, `scripts/import-gem.mjs`, `vault/.env.example`, `vault/SETUP.md` |
| Hub | `hub/project.html`, `hub/project.js` (Fields card, proposals), `hub/hub.js` and `hub/globe.js` (create here, field points, risk line), `hub/queue.js` (kind asset rows), `hub/hub.css` |
| tests | `vault/test/assets.routes.test.ts`, `vault/test/gazetteers.test.ts`, `vault/test/ingest.entities.test.ts`, `vault/test/worldmonitor.test.ts`, `vault/test/countries.brief.test.ts` (+wm), `test/e2e/hub-fields.spec.mjs`, `test/e2e/hub-globe.spec.mjs` (+create here, field points, risk) |
| docs | `docs/vault-hub/wave3/*`, `08-decision-log.md`, `HANDOVER.md` |

Not touched: `docs/vault-hub/schemas/*` (the vault-item schema already allows `origin.source` free text and `extracted` objects), any public page.

## 3. Acceptance criteria

| # | criterion |
|---|---|
| W3-AC1 | `GET /api/assets/locate?name=Guafita&country=VE` returns candidates ordered Vault → GEM → GeoNames → Wikidata, each with source, source_url and coordinates; with no GEM file imported and no GeoNames username the response says which sources were unavailable. |
| W3-AC2 | `POST /api/projects/:id/assets {create}` creates `field:ve:guafita` with `location_source`, attaches it, files the dossier items with `lt-public` and `origin.external_id`; a second attach of the same field files nothing new. |
| W3-AC3 | A non-member associate cannot attach to a client project (403); an invisible project is 404. |
| W3-AC4 | Indexing a document whose text names two known fields and one unknown name produces exactly two `asset` proposals (quote verbatim, anchor, candidates), none for the unknown name, and none for a field already attached. With a fake provider that invents a name whose quote is not in the text, that candidate is dropped. |
| W3-AC5 | Accepting a proposal with a chosen candidate attaches the field and files its dossier; rejecting resolves it; a member (not only a partner) may do either. |
| W3-AC6 | The Fields card lists attached fields with source and coordinates, the proposals with their quotes and candidates, and Attach / Not a field act and update in place; Add field searches and attaches. |
| W3-AC7 | The globe draws field points for attached fields with coordinates and shows the name on hover; the country panel lists fields under each project. |
| W3-AC8 | "Create a project here" appears for partners in the country panel, opens the form with the country set and the tapped coordinates filled, and the posted body carries them. |
| W3-AC9 | With `WORLD_MONITOR_API_KEY` unset, `GET /api/countries` carries `risk: null` and the brief meta says "not connected"; with a fake World Monitor, the country list shows the score and level, and the brief cites `[wm:risk:VE]` and `[wm:acled:…]` records that appear in its sources; a 429 is honoured and reported, never retried in a loop. |
| W3-AC10 | The World Monitor key never appears in any served file (AC12 scan) and no browser request goes to worldmonitor.app. |
| W3-AC11 | `scripts/import-gem.mjs` turns a sample tracker workbook into `gem-fields.json` with the expected columns; seeding loads it; the attribution text is on every GEM dossier. |
| W3-AC12 | Every suite green, typecheck clean, public pages byte-identical; evidence screenshots `w3-fields-card.png`, `w3-proposals.png`, `w3-globe-fields.png`, `w3-create-here.png`. |

## 4. Smoke plan

| AC | test |
|---|---|
| W3-AC1 | `gazetteers.test.ts` with injected fetch for GeoNames and Wikidata; `assets.routes.test.ts` for the route and the "unavailable" notes. |
| W3-AC2, AC3, AC5 | `assets.routes.test.ts` on embedded Postgres: partner, member, non-member; dossier rows; dedupe; proposal accept and reject. |
| W3-AC4 | `ingest.entities.test.ts`: dictionary pass and fake provider, including the invented-name case and the already-attached case. |
| W3-AC6, AC7, AC8 | `hub-fields.spec.mjs` and `hub-globe.spec.mjs` with stubbed routes; hover test reads the tooltip; the create-here test intercepts the POST body. |
| W3-AC9, AC10 | `worldmonitor.test.ts` (fake fetch, cache, 429), `countries.brief.test.ts` (+wm citations), the existing no-secrets scan, and an e2e assertion that no request leaves for worldmonitor.app. |
| W3-AC11 | `test/import-gem.test.mjs` on a three-row fixture workbook. |

## 5. Delivery: three pull requests, each green and mergeable

1. **Hierarchy and create-from-map**: migration, gazetteers, assets routes, Fields card, field points, create here, GEM import script. (AC1–AC3, AC6–AC8, AC11)
2. **Contextualisation**: `extractAssets`, proposals, accept/reject, Hub proposals and queue rows. (AC4, AC5)
3. **World Monitor**: adapter, countries risk, brief citations. (AC9, AC10)

## 6. Risks and rollback

| risk | mitigation | rollback |
|---|---|---|
| GEM workbook is behind a download form | the import is a script run on the downloaded file; everything else works without it | none needed |
| GeoNames needs a free username; Wikidata public endpoint is rate-limited | both optional; failures reported as "unavailable", never as empty results | unset the username |
| Model proposes wrong fields | quote must be verbatim; proposals never attach themselves; dictionary pass needs no model | reject in place |
| World Monitor tier: `get-country-intel-brief` is PRO-gated; risk and conflict endpoints need an active subscription | the adapter uses risk, conflict and headlines only; 401/403 are reported as "not connected: <reason>" | unset the key |
| Review-queue constraint change | additive value; migration is idempotent | the old kinds are unchanged |

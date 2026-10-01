# Wave 3 — Decision Log

The Tooler record for fields, contextualisation and live risk, 1 October 2026.

## Gate 1 (Choice Sheet, `02-choice-sheet.md`)

| # | Decision (verbatim) |
|---|---|
| W3-D1 | "Propose, you confirm (Recommended)" — fields a document names become proposals a member or partner attaches or dismisses; nothing attaches itself |
| W3-D2 | "Global Energy Monitor tracker (Recommended), GeoNames and Wikidata (Recommended)" — the per-field regulator and paper miners and model web search were not chosen (F13, F14) |
| W3-D3 | "Yes, build the adapter now (Recommended)" — World Monitor runs the moment `WORLD_MONITOR_API_KEY` is set; nothing is simulated before |
| W3-D4 | "Everything, in order (Recommended)" — three pull requests, each opened and merged when green |

## Gate 2

Markup `05-markup.md` approved 1 October 2026: "Approved, build it as written (Recommended)".

## What shipped

| PR | Scope | Acceptance criteria |
|---|---|---|
| [#29](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/29) | Hierarchy and create-from-map: migration 004, gazetteers (Vault, GEM, GeoNames, Wikidata), asset routes, dossiers, Fields card, field points, "Create a project here", GEM import script | W3-AC1, AC2, AC3, AC6 (attach part), AC7, AC8, AC11 |
| [#30](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/30) | Contextualisation: `extractAssets` (dictionary and verbatim-quote model pass), `asset` proposals in the review queue, accept and reject, proposals in the Fields card and the queue page, the upload note | W3-AC4, AC5, AC6 (proposals part) |
| #31 | World Monitor: the adapter (hourly cache, 429 honoured), risk per country on the globe and in the panel, the brief's LIVE RISK block cited as `[wm:…]`, the decision log | W3-AC9, AC10 |

W3-AC12 (every suite green, typecheck clean, public pages byte-identical) held on every PR; the evidence is in `../evidence/w3-*.png` (`w3-fields-card`, `w3-globe-fields`, `w3-create-here`, `w3-proposals`, `w3-live-risk`).

## Deviations from the Markup, stated

1. The GEM import is `vault/scripts/import-gem.ts` (TypeScript, sharing `gazetteers.ts` and the Vault's `xlsx` dependency), not `scripts/import-gem.mjs`.
2. `POST /api/assets` as a separate route was folded into `POST /api/projects/:id/assets {create}` and the review queue's accept, its only callers; assets are still created with a `location_source` and a `field:<cc>:<slug>` id.
3. A non-member associate deciding a proposal on a client project gets 404, not 403: the project is invisible to them, so the proposal does not exist (AGENTS.md rule 4).
4. The brief's cache key takes World Monitor's timestamps, so a cached brief is regenerated when the live picture changes (at most hourly, the adapter's cache); the Markup did not say how the cache and the feed interact.
5. The World Monitor list endpoints' exact JSON was not verifiable without a key; the adapter reads the documented fields and the common aliases (`events|data|items`, `headlines|articles`), and reports what it got. If the live shape differs, only `worldmonitor.ts` changes.

## Evidence

Final suites on the last head: Vault, Playwright and root suites green, typecheck clean, retrieval evaluation passing, secret scan clean, public pages byte-identical to `main`.

## Follow-ups opened

| # | Item | Plan |
|---|---|---|
| F13 | Per-field miners (regulator and paper feeds searched for each attached field), not chosen in W3-D2 | A `field` scope on the miner run with the asset's names and operator as queries; files under the asset's dossier |
| F14 | Model web search for a field, not chosen in W3-D2 | Only behind a provider that returns URLs it fetched; every fact quoted from the page it came from |
| F15 | Asset-aware staleness (Option C) | A dossier older than the GEM release in `gem-fields.json` is marked stale by the nightly job |

## Still only Chris can do

Set `GEONAMES_USERNAME` and `WORLD_MONITOR_API_KEY` on the Vault service; download the GEM tracker workbook and run `npx tsx scripts/import-gem.ts` once per release (SETUP.md §3); rotate the two provider keys seen on screen.

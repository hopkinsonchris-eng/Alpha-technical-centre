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

| #32 | The first real GEM import (March 2026, 7,673 units) and the reader for the workbook's real three-sheet layout | W3-AC11 |
| #33 | First-use fixes: World Monitor read on its published OpenAPI shapes with every country section in a Country intelligence card; fields outside the project's country flagged and attach asks first; archive a project (hide, never delete) | W3-AC9, AC10 widened; AC2, AC7 corrected |

W3-AC12 (every suite green, typecheck clean, public pages byte-identical) held on every PR; the evidence is in `../evidence/w3-*.png` (`w3-fields-card`, `w3-globe-fields`, `w3-create-here`, `w3-proposals`, `w3-live-risk`, `w3-country-intel`).

## First live use, 1 October 2026 (PR #33)

Chris's first session with wave 3 turned up four things:

1. **"All I have from World Monitor is one line."** The adapter had been written to the endpoint names without the published schemas (deviation 5 above), so events and headlines came back empty and the panel showed only the score. PR #33 reads `api.worldmonitor.app/openapi.json` shapes exactly (epoch-millisecond timestamps, `country_codes`, the headline bucket keyed by country, enum names) and adds every country-level reader the plan exposes: instability index with components and sanctions, World Monitor's own intel brief with its evidence, energy profile (JODI oil and gas, electricity mix), tanker traffic by port, ACLED and UCDP events, HAPI totals, headlines and the coverage timeline, travel advisories, sanctions pressure, the resilience index, internet outages and the intelligence timeline. `GET /api/countries/:code/intel` serves them as independent sections so a Pro-gated one says "needs Pro" rather than hiding the rest. The brief's LIVE RISK block gained energy and evidence citations (`[wm:energy:XX]`, `[wm:evidence:<id>]`).
2. **A field attached with coordinates in California on a Venezuelan project.** The Vault now checks every field's point against the same polygons the globe draws (`vault/src/assets/geo.ts`): the Fields card and the country panel flag "outside Venezuela: in United States", and attaching such a record answers 409 `outside_country` until the person confirms ("Attach anyway"). Coarse polygons mean a coastal miss is never evidence; a record without coordinates is judged by its gazetteer country.
3. **"I need to delete a project."** Rule 9 (hide, never delete): partners archive a project from its file after a confirmation; it leaves Today, the globe, the register and Cmd+K, every record stays, and Restore puts it back.
4. **"The system should spend the next hour populating its Vault about the project and its fields."** This is the per-field research that W3-D2 did not choose (F13 per-field miners, F14 web search). It is a new wave with its own Gate 1 and is not in PR #33.

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

# Wave 7 — Decision Log: an indispensable Hub

Tooler phase 6 close, 5 October 2026. Brief from Chris Hopkinson: a team of four (a debugging expert, a UI expert, a data expert, a next-big-thing expert) to make the Hub an indispensable tool for ATC team members; "Tooler everything".

## Phase 0 (the team, `00-practice-scan-research.md`, `01-snag-list.md`, `02-ui-review.md`, `03-data-hierarchy.md`, `04-step-changes.md`)

Five reviewers ran in parallel on a seeded Vault: 47 snags (2 blockers, 15 major), 14 ranked UI recommendations with four signature ideas, ten places the data model and the UI disagreed with three journeys traced in code, seven step changes with the country opening pack in full and 40 sources checked, and thirteen practices from direct analogues and four adjacent domains with their licence terms.

## Gate 1 (Choice Sheet, `02-choice-sheet.md`)

D64 "Clear first, then build (Recommended)"; D65 "Remove or hide all eleven (Recommended)"; D66 "All four (Recommended)" signature moves; D67 "Public licensed sources only (Recommended)".

## Gate 2 (Markup, `05-markup.md`)

"Approved, build it as written (Recommended)", 5 October 2026.

## What shipped

| PR | Merged as | What it does for the team |
|---|---|---|
| 1 Clearance | [#61](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/61) | A client project is created under its NDA tag from the form, so confidentiality holds in Find, Write to… and the connector; Find returns nothing for nothing and finds runs; the two gated tools open; one sidebar; the eleven removals; research past budget is reaped and literature comes from basin names; Write to… refuses clearly without a provider; Settings is Settings; a hub-health smoke of ten daily checks on every push. Three merge fixes: the vector ceiling belongs to the embedder (the retrieval evaluation stayed at its scores), the MCP draft test, two tool-page assertions. |
| 2 The instrument | [#62](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/62) | One stateline in three places; Today as the status strip, the globe and the live register scroll-linked, What came in beneath, the catalog moved to a Tools index; a record panel that shows the record with the passage anchored; sticky tabs, Add documents as a sheet, Write to… beside the file; the palette searches the Vault; Find never lands on an error; numbers as data with self-hosted fonts; a touch and type pass and a vocabulary pass enforced by tests on every page. |
| 3 Data that flows | [#63](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/63) | Migration 008; runs become reviewed and final by a status route and the headline numbers, scorecard and analogue rows read them; a standing endpoint the page and the connector share; figures with unit, as-of and source; milestones and counterparties as linked organisations; foreground and background in the timeline; basin, block, reservoir and well under a parent and a nodal run that names a well; a price deck that stales an NPV; draft warnings on weak figures; a project from the queue. |
| 4 and 5 The country pack | [#64](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/64) | Migration 009; a reviewed source registry (eleven generic sources, nine countries) with licences and attribution lines; two generic adapters and a CSV reader with recorded fixtures; every source filed as a dated immutable original; ten sections drafted only from those originals, bilingual, every sentence cited, honest where no source exists; per-section TTLs, a nightly stale mark and a weekly re-fetch and rebuild under a budget; the card, the sheet with a chip per sentence, the globe line, the Today line, the connector resource, the pack as Write to… sources. |
| 6 The round watch | this pull request | Migrations 010 and 011; regulator licensing pages watched for change and filed as the same originals the pack cites; dated stages extracted once with a verbatim quote that must be in the text; proposals in the queue confirmed before they count; `GET /api/rounds` with open rounds and deadlines; Deadlines on Today; a ring on the globe; round rows in the queue; the pack's licensing section carries confirmed dates; "have we seen this before" on a project. |

## The pack rework (6 October, after first live use)

Chris Hopkinson, on the first Venezuela pack: "If this doesn't work better than google then we might as well stop." Decision, same day: web-found pages are accepted as pack originals, filed and cited but not pre-vetted for licence, with the registry sources preferred ("yes build it"). What shipped is in `07-pack-rework.md`: the terms card first, every original shared across sections and cached, web search as a source the job fetches, World Monitor filed for risk, a quality bar the tests hold the pack to, and a build that re-drafts only what changed. The same day also showed the Vault spending without a brake (an unmetered ingest backlog): the daily cap in pull request #70.

## What the build taught

1. **A shared component is the integration point.** Writing the stateline, migration 008, the pack contracts and the round contracts myself before launching builders let three or four of them work in parallel on disjoint files and merge clean; where builders had to guess a shape, the seams showed up as test failures at the merge, never as product bugs.
2. **The language toggle rewrites any element carrying a bilingual pair, children included.** The stateline's first version lost its dot and date on a toggle; a token's words must live in a child span. Two builders hit the same thing on KPI tiles.
3. **The shared public stylesheet animates colour.** An accessibility check straight after a click measured a mid-fade button; the Hub overrides the transition. The same class of flake hid behind a palette debounce and a Settings reload; both were fixed at the root, not retried.
4. **The retrieval evaluation is the guard for the gateway.** The score floor that made Find trustworthy was tuned for Voyage; the fake embedder the evaluation uses sits farther, and precision fell to 0.05 in CI. Each embedder now states its own ceiling.
5. **Tier A schemas shape what is possible.** No well on the run record (it goes in `asset_ids`), no reply date on a dispatch (milestones keyed by its id), no country lesson (`country_notes`), no `stale` or `age_flags` on the run record (they sit under `facets.vault`). Every one of these is said plainly in the data review and honoured in the code.
6. **Licences decide the design.** ResourceContracts is share-alike, so its content stays in the public-scope pack; IEA datasets, OnePetro full text, OpenCorporates and LinkedIn are blocked by code; the service-industry section says "no public register" rather than guessing.
7. **The model never fetches and never remembers.** Every pack sentence and every round date comes from a stored original with a citation or a verbatim quote; a section with no reachable source says so without a model call; a date whose quote is not in the text is refused.
8. **Three suites, every time.** Vault, Hub and root suites green before every push; a CI run cancelled by a superseding push is re-run, not assumed.

## Evidence

`docs/vault-hub/wave7/evidence/`: the four reviews' screenshots (`ui-*.png`, `snag-*.png`), `w7-clearance-*.png`, `w7-today-{desk,ipadl,ipadp,phone}.png`, `w7-strip-desk.png`, `w7-stateline-*.png`, `w7-record-*.png`, `w7-find-*.png`, `w7-settings-desk.png`, `w7-cost-ipadl.png`, `w7-standing.png`, `w7-background.png`, `w7-asset-panel.png`, `w7-create-from-queue.png`, `w7-pack-card.png`, `w7-pack-sheet.png`, `w7-pack-globe.png`, `w7-pack-ipad.png`, `w7-deadlines.png`, `w7-globe-ring.png`, `w7-queue-round.png`. Final suites at the close of PR6: see the pull request.

## Deviations from the Markup, stated

- **PR4 and PR5 arrived as one pull request.** Their four builders ran in parallel against shared contracts and the result was one coherent change; the Markup's two acceptance groups (W7-AC17 to AC20) are all met in it.
- **Migration 011.** The review queue's kind check had to widen to admit `round`; migration 010 did not, so PR6 carries a second, one-line migration.
- **The weekly refresh re-fetches.** The Markup said stale sections are rebuilt; the refresh re-fetches their sources first through the job's own fetcher, so a changed page is read at its newest edition before the section is drafted again.
- **No model fetch of PDFs.** The proposal left a path for the provider to read a PDF itself with citations; D67 and the pack's guard rule out the model fetching anything, so every source is fetched by the server and drafted from the stored text.
- **Round deadlines and What came in.** The round watch's changed page is filed as an item under project `firm`; the activity feed was not changed to surface it, and Today's Deadlines card and the "moved to" line are read from the rounds view instead.
- **The status strip does not count round proposals.** The Deadlines card does; the strip's figures stay as PR2 defined them.

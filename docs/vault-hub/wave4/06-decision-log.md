# Wave 4 — Decision Log

The Tooler record for research runs per project, 1 October 2026.

## Gate 1 (Choice Sheet, `02-choice-sheet.md`)

| # | Decision (verbatim) |
|---|---|
| W4-D1 | "World Monitor research (Recommended), The Vault's own miners (Recommended)" — Claude web search and fetch, and GEM wiki pages, were not chosen (F14 stays open) |
| W4-D2 | "Button and automatic (Recommended)" — a run is queued when a project is created with a country and when a field is attached; a partner or member presses "Research this project" at any time |
| W4-D3 | "Research notes plus proposals (Recommended)" — every finding is a public note with its citation; operators, licences and production figures become `research` proposals a person decides |
| W4-D4 | "15 minutes or about £3" — the run stops at the wall clock or the model spend, whichever comes first, and says what it did not reach |

## Gate 2

Markup `05-markup.md` approved 1 October 2026: "Approved, build it as written (Recommended)". Option A of `04-innovation-options.md` (budgeted research runs with cited findings and proposals); B recorded as F16, C kept as F14, D rejected.

## W4-D1 revised (1 October 2026, after the first live run)

The first run on High Tech Electronica (seven small Oficina-area fields in Venezuela) found nothing: World Monitor's news window and the literature indexes have little on them, while Google reaches the GEM wiki pages, PDVSA and Wikipedia pages, old reports and trade press. Gate 1 reopened with one question; the answer, verbatim: "GEM wiki pages per field (Recommended), Web search with URL citations (Recommended)". The addendum `05-markup.md` §1.4.8 was approved: "Approved, build it as written (Recommended)". F14 closes with it. The same run showed two faults that are fixed first (PR #38, #39 below).

## What shipped

| PR | Scope | Acceptance criteria |
|---|---|---|
| [#34](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/34) | The run and its routes: migration 005 (`review_queue.kind` gains `research`), the four World Monitor research readers (GDELT documents, company enrichment, company signals, SEC filings), the query builder, the run with its time and spend budget, filing and deduplication, proposals with verbatim quotes, `POST`/`GET /api/projects/:id/research`, the triggers on project create and field attach, accept of kind `research`, the `atc-vault-research` cron, `RESEARCH_ENABLED` | W4-AC1, AC2, AC3, AC4, AC5, AC6 |
| #35 | The Hub: "Research this project" in the toolbar with the status line (queued, running with progress, last run with findings, proposals and where it stopped; polling every 10 s while a run is going), the Research tab (findings grouped by source, newest first, with date, source, the query, the verbatim excerpt and open into the record panel; the run summary and the not-reached line), research proposals in the Fields card and on the queue page (Set as operator / File as fact / Not a fact), this decision log | W4-AC7, AC8 |

| #37 | Boot skips the Global Energy Monitor re-seed once a release is loaded: Render's deploy of the API had timed out on 7,673 updates before the port opened | (operations) |
| #38 | A run reports where it is (phase, live counts during the literature pass) and what each source answered; a "nothing found" says so; one log line per run | W4-AC7 widened |
| #39 | The literature screen keeps only papers that name the field as a phrase and are about oil and gas; a re-run hides what an earlier run filed wrongly (the 450 papers of the first run) | W4-AC2 corrected |
| #40 | W4-D1 revised: GEM wiki pages per field with every cited source as a finding; web search through the API's server-side tool, only API-cited sentences filed with URL and verbatim cited text; `RESEARCH_WEB=false` | W4-AC9, AC10, AC11 |

W4-AC8 (every suite green, typecheck clean, public pages byte-identical, no secret in served files) held on every PR; the evidence is `../evidence/w4-research-tab.png` and `../evidence/w4-research-proposals.png`.

## What a run does, in one paragraph

For one project it builds its queries from the project's own names (its name, client and country), from each attached field (short name, Global Energy Monitor name and "name other") and from the operators those records carry; short names are anchored with the country and "oil field"; the register's free text is never a search term. It asks World Monitor for GDELT documents per name, company enrichment, signals and SEC filings per operator and client, and the country's intelligence timeline, then runs the literature miners (OpenAlex, Crossref, Semantic Scholar) with one topic per field and per operator, scoped to the project. Every finding is filed as a public note under the project with its source, URL, date, the query and a verbatim excerpt, deduplicated on (project, source, external id) so a re-run updates rather than duplicates. Fields a finding names open the wave 3 `asset` proposal (dictionary pass only, no model); with a provider, one low-effort read per new finding extracts the operator, licence and production figure it states, each kept only with a verbatim quote and opened as a `research` proposal. The run stops at `RESEARCH_BUDGET_MINUTES` (15) or `RESEARCH_BUDGET_GBP` (3) and records every query it did not reach and why.

## What the first live run taught (1 October 2026)

1. **A deploy must open its port in Render's window.** Re-seeding 7,673 GEM units on every boot took a minute; the API deployed stale for hours. Boot now skips a loaded release (#37).
2. **"Running · 6 min · 0 findings" is not an answer.** The literature pass filed nothing until it finished and a source that answered nothing left no trace; the Hub now shows the phase, the live count and what each source answered (#38).
3. **A title-only paper must still be screened.** Most Crossref answers have no abstract; the screen kept them whatever they were, and "field" matched dairy farms. Research topics are strict and a re-run tidies the project (#39).
4. **The chosen sources did not reach what Google reaches.** W4-D1 revised adds the GEM wiki pages and web search with citations (#40).

## Deviations from the Markup, stated

1. **Cursors.** The Markup said a re-run "starts from the cursors". A run has no per-source cursor: GDELT is asked for the last year each time and the literature miners for the last five, and the deduplication on (project, source, external id) makes a re-run update what changed and leave the rest alone; World Monitor's hourly cache stops a re-run within the hour from counting against the plan twice. A true cursor would hide a correction to an older article, which the dedup update catches.
2. **Which miners.** The run uses the three literature adapters only. The regulator and EIA adapters file country-wide snapshots on their own schedule and take no query, so a per-project run has nothing to ask them; their items are not shown in the Research tab (it lists what the run's queries found).
3. **403 versus 404.** A non-member associate on a client project gets 404 from both research routes, as in wave 3 (deviation 3 there): the project is invisible to them, so the run does not exist.
4. **Field proposals from findings use the dictionary pass only.** The wave 3 model pass (a verbatim quote for a name the dictionary lacks) is not run on findings, to keep the model spend for the fact reads; a field the Vault does not know by name is therefore not proposed from a finding. Attaching it by hand still queues the run that researches it.
5. **Accept body.** Accept of kind `research` ignores `apply`: accepting always records the fact (the operator on the field, a production figure on the register's `current` with its source and the figure in kboe/d where the unit allows) because that is what the proposal says it will do; the Hub still sends `apply: true` so an older Vault that gains an opt-in later keeps working.
7. **Web search files citations, not pages.** The addendum's "each citation becomes a finding" is read per page: several citations of one page become one finding whose quote is the first cited text and whose `facts.excerpts` carry the rest, so a page is one record and a re-run updates it.
8. **GEM wiki reference titles.** Most references on the GEM pages are bare URLs; a finding without a title is named "Source cited by Global Energy Monitor for <field> (<host>)" rather than invented.
6. **Status while queued.** The Markup showed "running · 2 min · 12 findings"; a queued run that has not started shows "queued · waiting to start" first, since the API server runs jobs one at a time and the cron picks up what a restart left.

## Evidence

Final suites on the last head: Vault 417, Playwright 152, root 82 passing; typecheck clean; retrieval evaluation passing; secret scan clean; public pages byte-identical to `main`.

## Follow-ups opened

| # | Item | Plan |
|---|---|---|
| F16 | Standing watch per project (Option B): a scheduled re-run per active project with the budget shared across projects | A weekly cron that queues one run per active project, newest findings first in Today |
| F17 | Findings in the brief: cite research notes (`[doc:<id>]`) in the country brief and the project draft when they are the newest source for a claim | The brief's retrieval already indexes them; add the research tag to its scope |
| F18 | Regulator feeds per field (F13 narrowed): ANH, ANP, Perupetro and Argentina feeds filtered to the project's fields and blocks | A post-filter on the snapshot rows by the project's field names |

## Still only Chris can do

- Render Blueprint sync so the `atc-vault-research` cron exists; it needs `DATABASE_URL`, `WORLD_MONITOR_API_KEY` and the model key as the web service has them.
- Rotate the two provider keys that were pasted into chat earlier.

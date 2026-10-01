# Decision Log

| When | Gate / event | Record |
|---|---|---|
| 2026-09-29 | Gate 1 | D1–D11 decided, all recommended defaults, D11 Zoho Books. Verbatim in `03-choice-sheet.md`. Requirements R1 (complete inventory) and R2 (letter-ready vault) added. |
| 2026-09-29 | Gate 2 | Markup `06-architecture.md` approved: "Approved. Start building. I would like to see mockups of the system". |
| 2026-09-29 | Build start | Mockups of every Hub screen first, then wave 0 (M00, M01), then wave 1 (M02–M06). Evidence of done per module is recorded below as it lands. |

| 2026-09-30 | Wave 2, Gate 1 | W2-D1–D5 decided (`wave2/02-choice-sheet.md`): one table for opportunities and projects; the 3D globe; sidecar-declared toolbar context; record page, catalog defaults and Cmd+K in scope; rank-and-compare deferred. |
| 2026-09-30 | Wave 2, Gate 2 | Markup `wave2/05-markup.md` approved: "Approved, build it as written (Recommended)"; PRs opened and merged when green. |
| 2026-10-01 | Wave 2, deviation | The Opportunity Register tool is not marked deprecated (the markup's last step): its manifest's `aliases.current` must name a version or another tool, and the Hub is neither, and the tool remains the potential-model calculator the toolbar opens. The register *list* moved to the Hub; the tool's changelog says so. |
| 2026-10-01 | Wave 2, deviation | `vault/ADAPTERS.md` named in the markup does not exist; the `version.json` instruction went into `vault/src/adapters/README.md` (the file handed to the APEX developer) and `vault/SETUP.md` §5. |

## Shipped (append as modules land)

| Module | Commit | Tests | Visual proof |
|---|---|---|---|
| M00 Ontology, schemas, master and reference data | wave-0 commit | `vault/npm test`: legal (6, property-based), schemas (10, 42 fixtures + AC15 seed), db (3) green | n/a (no surface) |
| M01 Infrastructure, auth, CI | wave-0 commit | auth (5) green; CI workflow with AC12 and AC13 checks; Access checklist in `vault/README.md` awaiting the Cloudflare and Supabase steps only Chris can do | n/a |
| Mockups (all nine Hub screens) | ea47d2b | n/a | `docs/vault-hub/mockups/*.png`; `hub/mockups/index.html` clickable |
| M03 Tool registry and catalog | 775a37d | catalog (14) green; register pins follow `tool.json` | n/a |
| M04 Vault client library | 5224720 | vault-client (9) green; e2e smoke loads it in Chromium | n/a |
| M08 Staleness rules (engine only; re-run and delta note follow M05/M13) | ab151f5 | staleness (6) green incl. AC4 set and idempotence | n/a |
| M02 Vault API core | see git log | vault api/audit/seed tests (59) green; 83 total | n/a |
| M05 Opportunity Register capture | ceb7096 | e2e (3) green | `docs/vault-hub/evidence/m05-opportunity-register.png` |
| M05 APEX Reservoir 3D capture, browser key removed | see git log | e2e (3) green; AC12 grep clean | `docs/vault-hub/evidence/m05-reservoir-simulator.png` |
| M06 Hub Today page and settings | see git log | e2e (10) green incl. axe WCAG 2 A/AA | `docs/vault-hub/evidence/m06-hub-today.png` |
| M05 ELA Studio, Nodal Analysis, Financial Model, Plan Your Job capture | 6deadc7, ece8f6f, 17ef913, 2d4d07d | e2e 3+2+2+2 green | `docs/vault-hub/evidence/m05-*.png` |
| M08 re-run, delta note, review queue | 7c049e5 | rerun (3) + hash (2) green; AC5 proven headlessly against the Register fixture | n/a (Hub surface in M07) |
| M05 ELA Model Suite capture | b62e35d | e2e (5) green | `docs/vault-hub/evidence/m05-ela-model-suite.png` |
| M05 APEX external-app adapters (D6): push with app tokens, re-run adapters, nightly snapshot | bd0cedc | app-tokens (7) + adapters (7) green; 102 vault tests | n/a; developer contract in `vault/src/adapters/README.md` |
| M07 Project file and tool pages | see git log | e2e (23) green; 33 with Today | `docs/vault-hub/evidence/m07-project.png`, `m07-tool.png` |
| M12 core: scope predicate and hybrid search | ed0cf70 | gateway (4) green; oracle over every chunk/scope/role; 10,000-query property with zero cross-client hits (30 s) | n/a (Find page follows with the search route) |
| M13 core: letter rendering (HTML, DOCX, PDF) and drafting with enforced citations | c2b2f59, 3b6a272 | render (4) + draft (6) green; AC15 context assembled from the Vault alone | `docs/vault-hub/evidence/m13-letter.png`, `.pdf`, `.docx` |
| M09 Document ingest, legal and billing extraction, WorkDrive and Zoho Books sync | 6e2360d | ingest (16) green incl. OCR of a generated scan; 50-page PDF in ~2 s | n/a |
| M11 Research and public-data miners | 226cf28 | miners (50) green on recorded responses; OnePetro refused by code and test | n/a |
| M13 routes: draft, render, scoped LLM proxy | b87fd1b, c3c95d5 | draft.routes (3) green incl. DOCX and PDF downloads | n/a |
| M15 Lessons, weekly dream, firm index, hooks and skills | 40e4d02 | lessons.api (8), dream (9), lessons.index (5), hooks (6) green | n/a (queue surface arrives with M10) |
| Partners-only rule on item reads (gap from M09) | 1f53cff | api.partners-only (1) + items (9) green | n/a |
| M16 Analogue memory | ae040f4, c58069e (Register 2.2.0) | analogues emit/similar/defaults green; e2e (10) green | `docs/vault-hub/evidence/m16-analogues.png` |
| M12 routes and Find page | see git log | search.routes + rerank (18) green; e2e (8) green. **Miss:** p95 851–932 ms at 100k chunks on PGlite vs 800 ms target; follow-up F1 below | `docs/vault-hub/evidence/m12-find.png` |
| M10 Correspondence capture and review queue | 829c01a | mail imap/gmail/classify/capture (41) green; e2e (16) green; classifier precision 0.976 on 63 labelled messages | `docs/vault-hub/evidence/m10-queue.png` |
| M14 Company MCP server, skills, connection notes | 5fa1f8b | mcp (9) green; personal Access tokens documented, service tokens deliberately refused | n/a |
| M17 Retrieval evaluation, scorecards, cost | 77ffbdd | eval runner PASS on 26 gold questions (faithfulness 1.00, context precision 1.00, recall 1.00; regression run fails the gate at 0.53); scorecards + cost (vault) green; e2e (11) green | `docs/vault-hub/evidence/m17-cost.png` |

## Follow-ups (Tier A)

| # | Item | Why | Plan |
|---|---|---|---|
| F1 | Index-only vector scan | The vector query joins `legal_tags` for the classification, so the planner never uses an HNSW index on `chunks.embedding`; p95 misses 800 ms at 100k chunks on the embedded database | Migration 002: denormalise `classification` (and `partners_only`, `expires_at` already present) onto `chunks`; ingest writes them; predicate stops joining; add HNSW index; re-measure on Supabase |
| F2 | Batch API for chunk contexts, paper facts and the dream | All three call the provider sequentially today | One `BatchProvider` behind the same interface |
| F3 | xlsx package advisory | `xlsx@0.18.5` has unpatched advisories on npm | Swap to SheetJS's own distribution |
| F4 | Zoho WorkDrive, Zoho Books, ANP and Perupetro endpoints | Built from documented shapes and recorded fixtures only | Verify against live accounts before enabling the crons |
| F5 | Re-run runner and PDF need Chromium on the server | Render's native Node runtime has none | Docker runtime for `vault-api`, or run re-runs from the Hub in the partner's browser |
| F6 | Two scorecard rule sets | `hub/project.js` (M07) computes the six rules named in the mockup; the server (M17) implements the six rules in the module spec. **Decision: the server rules are canonical.** | Wire the project page and the Today dot to `GET /api/projects/:id/scorecard`; retire the client-side rules |
| F7 | Evaluation numbers are structural until a real reranker runs | The eval reranker promotes gold refs, so precision measures scoping and citation hygiene; faithfulness is 1.00 because the fake model is extractive | Run `eval/runner.ts` once with `VOYAGE_API_KEY` and a recorded provider to establish the real baseline; keep the gate |
| F8 | Settings entry for infrastructure costs and budgets | `hub/settings.html` has no form for `infra_costs` and `budgets` | Add the two forms; until then PUT `/api/settings/<key>` |
| F9 | No route creates a client NDA legal tag | `POST /api/projects` needs an existing `client-nda` tag id for a client project, but tags are only created by `resolveTag` (unions) and the seeds; the Hub's New project form asks for the tag id and shows the API's refusal when it does not exist | Add `POST /api/legal-tags` (partners; classification, client, contract, expiry) and a small form on the organisation file; until then client projects are opened as internal and re-tagged when the NDA record is filed |

## Build complete (29 Sep 2026)

All eighteen modules of `07-build-plan.md` are on `claude/busy-carson-y75611`. Evidence on the final head:

| Suite | Result |
|---|---|
| Root calculators and client (`npm test`) | 67 pass |
| Vault (`cd vault && npm test`) | 344 pass, 1 skipped (Chromium-dependent) |
| Vault typecheck | clean |
| Browser end-to-end (`npx playwright test`) | 89 pass (100 with the cost page spec) |
| Retrieval evaluation (`npx tsx eval/runner.ts`) | PASS, zero cross-scope leaks |
| Secret scan of served files (AC12) | clean |
| Public pages vs main (AC13) | unchanged |

Acceptance criteria AC1–AC16 each have a passing test named in their module's spec, with two honest exceptions recorded above: AC-latency (F1) and the evaluation's structural precision (F7).

Steps only Chris can do before staff use it: create the Supabase project and set `DATABASE_URL`; create the Cloudflare Access application for `/hub/*`, `/api/*` and `/mcp` and set the Access variables; set the provider keys (Anthropic, Voyage) and the Zoho, Gmail and APEX variables listed in `vault/.env.example`; choose the Docker runtime for `vault-api` if server-side re-runs and PDFs are wanted (F5); hand `vault/src/adapters/README.md` to the APEX apps' developer; open the pull request from this branch.

## Wave 2 shipped (1 Oct 2026)

| PR | What | Tests | Visual proof |
|---|---|---|---|
| #24 | Project fields (migration 002), `PATCH /api/projects/:id`, `GET /api/countries`, catalog sidecar and live versions, catalog lifecycle chips, record panel as highlights, related cards and a bottom sheet | projects.wave2 (8), catalog.sidecar (5), hub-record-panel (5), hub-today (+2) | `evidence/w2-record-sheet-ipad.png` |
| #25 | The globe, country drill-down, opportunity register and Add opportunity | geo (3), hub-globe (6) | `evidence/w2-globe-front.png`, `w2-globe-country.png` |
| #26 | Project toolbar carrying `?project=`, stage in place with history on the timeline, opportunity card, Cmd+K | hub-project-toolbar (5), hub-palette (3), vault-client (+3) | `evidence/w2-project-toolbar.png`, `w2-palette.png` |
| #27 | Country brief (`POST /api/countries/:code/brief`, migration 003, cached per legal scope and source set) and its panel | countries.brief (4), hub-globe (+2) | `evidence/w2-country-brief.png` |

Follow-ups opened by wave 2:

| # | Item | Why | Plan |
|---|---|---|---|
| F10 | Rank and compare across the portfolio (P22, W2-D5 deferred) | A partner still opens a tool to answer "which two should we push" | `/api/projects/rank` over latest run outputs and analogue rows; a two-project compare view |
| F11 | Opportunity triage on entry (Option B) | Needs analogue rows to exist in volume | After the first ten evaluations carry analogue rows |
| F12 | The APEX apps' `version.json` | Until published the cards say "Version unverified" | The two-line instruction is in `vault/src/adapters/README.md` |

## Wave 3 shipped (1 Oct 2026)

Design record: `wave3/` (practice scan P23–P29, choice sheet W3-D1–D4, gap statement, options A–D, markup, decision log).

| PR | What | Tests | Visual proof |
|---|---|---|---|
| #29 | Fields on projects: migration 004 (location and its source on assets), gazetteers (Vault and GEM first, then GeoNames and Wikidata, unavailable sources named), `GET /api/assets/locate`, `GET/POST/DELETE /api/projects/:id/assets`, dossiers filed as `lt-public` notes, Fields card, field points on the globe, "Create a project here", GEM import script | gazetteers (3), assets.routes (5), import-gem (2), hub-fields (4), hub-globe (+3) | `evidence/w3-fields-card.png`, `w3-globe-fields.png`, `w3-create-here.png` |
| #30 | Fields named in documents become `asset` review proposals (dictionary pass; model pass kept only with a verbatim quote), accepted or rejected by members and partners in the Fields card or the queue | ingest.entities (3), hub-fields (+3), hub-queue (+1) | `evidence/w3-proposals.png` |
| #31 | World Monitor adapter (server-side key, hourly cache, 429 honoured), risk per country on the globe and in the panel, the brief's LIVE RISK block cited as `[wm:risk:XX]`, `[wm:acled:<id>]`, `[wm:news:<n>]` | worldmonitor (3), countries.brief (+2), hub-globe (+2) | `evidence/w3-live-risk.png` |
| #32 | The GEM tracker imported for real (March 2026, 7,673 units) and the reader for its three-sheet layout; short names; batched, boot-only seeding | import-gem (2), seed (+1), ingest.entities (+1) | — |
| #33 | First-use fixes: World Monitor on its published shapes with a Country intelligence card (`GET /api/countries/:code/intel`, 15 sections), fields outside the project's country flagged and confirmed before attaching, archive a project | worldmonitor (5), intel.routes (2), geo (2), assets.routes (+2), hub-globe (+3), hub-fields (+3) | `evidence/w3-country-intel.png` |

Follow-ups opened by wave 3:

| # | Item | Why | Plan |
|---|---|---|---|
| F13 | Per-field miners | Not chosen in W3-D2; the dossier is the gazetteer record only | A `field` scope on the miner run with the asset's names and operator as queries |
| F14 | Model web search per field | Not chosen in W3-D2 | Only behind a provider that returns the URLs it fetched; every fact quoted from its page |
| F15 | Asset-aware staleness (Option C) | A dossier can outlive the GEM release it came from | The nightly job marks dossiers older than the imported release stale |

## Wave 4 shipped (1 Oct 2026)

Design record: `wave4/` (practice scan P30–P37, choice sheet W4-D1–D4, gap statement, options A–D, markup, decision log).

| PR | What | Tests | Evidence |
|---|---|---|---|
| #34 | Research runs per project: migration 005, four World Monitor research readers, query builder, the run with time and spend budgets, findings filed as cited public notes (deduplicated on re-run), `asset` and `research` proposals with verbatim quotes, `POST`/`GET /api/projects/:id/research`, triggers on project create and field attach, accept of kind `research`, the `atc-vault-research` cron, `RESEARCH_ENABLED` | research (8), research.routes (4), worldmonitor (+1), auth/db/boot migration counts | — |
| #35 | The Hub: "Research this project" with its status line and 10 s polling, the Research tab grouped by source with queries, quotes and open-into-record, research proposals in the Fields card and the queue page | hub-research (6) | `evidence/w4-research-tab.png`, `evidence/w4-research-proposals.png` |
| #37 | Boot skips the GEM re-seed once a release is loaded (Render deploy had timed out) | import-gem (+1) | — |
| #38 | Runs report phase, live counts and per-source outcomes; one log line per run | research (+1), hub-research (+1) | — |
| #39 | Strict literature screen (name as a phrase plus an oil-and-gas word); a re-run hides papers filed wrongly | research (+1) | — |
| #40 | W4-D1 revised: GEM wiki pages and their cited sources; web search with API citations (`web_search_20260209`), `RESEARCH_WEB=false` | research.sources (5), research (+2), hub-research (+1) | `evidence/w4-research-tab.png` |
| #40 | A run locates fields attached by name from the gazetteers: exact match set with dossier, area match proposed (Set location / Not it), unknown named | research (+1), hub-research (+1) | — |

Follow-ups opened by wave 4:

| # | Item | Why | Plan |
|---|---|---|---|
| F16 | Standing watch per project (Option B) | Not chosen at Gate 2; a project's picture goes stale between presses | A weekly cron queuing one run per active project with a shared budget |
| F17 | Research findings cited in briefs and drafts | Findings are indexed but the brief does not yet prefer them | Add the `research` tag to the brief's retrieval scope |
| F14 | Model web search per field | Closed by W4-D1 revised (#40) | — |
| F18 | Regulator feeds filtered per field | The run uses the literature adapters only (the regulator feeds take no query) | A post-filter on snapshot rows by the project's field names |

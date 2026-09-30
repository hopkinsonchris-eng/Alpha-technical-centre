# Decision Log

| When | Gate / event | Record |
|---|---|---|
| 2026-09-29 | Gate 1 | D1–D11 decided, all recommended defaults, D11 Zoho Books. Verbatim in `03-choice-sheet.md`. Requirements R1 (complete inventory) and R2 (letter-ready vault) added. |
| 2026-09-29 | Gate 2 | Markup `06-architecture.md` approved: "Approved. Start building. I would like to see mockups of the system". |
| 2026-09-29 | Build start | Mockups of every Hub screen first, then wave 0 (M00, M01), then wave 1 (M02–M06). Evidence of done per module is recorded below as it lands. |

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

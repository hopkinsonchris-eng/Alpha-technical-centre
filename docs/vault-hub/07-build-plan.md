# Build plan — modules, waves, model tiers, cost

Written against D8 (three tiers, contract first). Every module has a spec in
`modules/` that is self-sufficient: a single model session given the spec, the
schemas and the repo can build it and prove it with the listed smoke tests.

## 1. Model tiers

| Tier | Use for | Models (list price per 1M tokens in/out, Sep 2026) | Rules |
|---|---|---|---|
| **A — architect and reviewer** | Schemas, data model, legal-tag and scope logic, auth, staleness rules, drafting and dream prompts, every module contract, review of every merge | Claude Fable 5.1 (10 / 50) or Claude Opus 5.5 (4 / 20) at high effort | Human-reviewed. Writes the contract and the smoke tests before any Tier B/C work starts. Reviews Tier B/C pull requests as an overnight Batch job (50% off). |
| **B — implementer** | Modules that span several files or need judgement inside a fixed contract: API core, ingest pipeline, email capture, gateway implementation, Hub pages, staleness engine, MCP server, integration tests | Claude Sonnet 5.5 (2 / 10); Opus 5.5 at low effort when a module touches more than three files | Works from the module spec only. Must run the module's smoke tests green before opening a PR. |
| **C — worker** | Single-file work against a fixed interface with a checkable output: feed adapters, changelog parser, DTOs, per-tool run-capture wiring, fixtures, docstrings, UI components from the style guide | Claude Haiku 4.5 (1 / 5); optionally DeepSeek V4.1-Flash or Qwen3 Coder Next behind the same tests | Never touches auth, scope, schemas or anything with an open question. Two failed smoke runs escalate to Tier B. |

Mechanics that keep the split reliable:
- `AGENTS.md` at the repo root (imported by `CLAUDE.md`) with build and test
  commands, conventions, and the rule "read `docs/vault-hub/modules/<M>.md`
  first".
- Each module spec has: purpose, tier, depends-on, inputs to read,
  deliverables, contract, numbered acceptance criteria, smoke tests, out of
  scope. Specs are proportional to the module; no spec exceeds two screens.
- Fixtures under `vault/test/fixtures/` are the shared truth; a schema change
  is a Tier A PR that updates fixtures first.
- Prompt caching: one stable system prompt per tier; do not switch models
  mid-conversation (cache is model-scoped).
- Price on the hardest tenth of tasks: anything with an open question goes to
  Tier A to close the question before it is assigned.

## 2. Modules

| Module | Wave | Tier | Depends on | Size | One line |
|---|---|---|---|---|---|
| M00 Ontology, schemas, master and reference data | 0 | A | — | S | Freeze the six schemas, Postgres DDL, legal-tag inheritance rules, LatAm master data seed |
| M01 Infrastructure, auth, CI | 0 | A (auth) / B | M00 | M | Render service + cron, Supabase, Cloudflare Access on `/hub/*` `/api/*` `/mcp`, JWT verification, CI with schema validation, secrets, `AGENTS.md` |
| M02 Vault API core | 1 | B | M00, M01 | L | Runs, items, versions, immutability, legal-tag union, project timeline, audit log |
| M03 Tool registry and catalog | 1 | C (parser) + B (integration) | M00 | S | `tool.json` per tool, CHANGELOG parser, catalog build, `resolve`, deprecation redirects |
| M04 Vault client library | 1 | B | M02, M03 | M | `js/vault-client.js`: saveRun, loadRun, resolve, hashing, offline queue, in-tool Find widget |
| M05 Tool run capture | 1 | C per in-repo tool; B for APEX adapters | M04 | M | Register, Simulator, ELA Studio, Model Suite, Financial Model, Nodal, Plan Your Job write and reload Runs; APEX Asset Intelligence and APEX 3D push Runs |
| M06 Hub shell and Today page | 1 | B | M02, M03 | M | Layout from `style.css`, catalog, what's new, my projects, stale alerts, queues |
| M07 Project and tool pages | 2 | C (components) + B | M02, M06 | M | Timeline, vintage table, lineage graph, basis notes, tool page with versions and runs |
| M08 Staleness engine and re-run | 2 | A (rules) / B | M02, M05 | M | Nightly stale computation and propagation, headless re-run, delta note via LLM |
| M09 Document ingest and indexing | 3 | B | M02 | L | Upload + WorkDrive sync, text extraction, contextual chunking, embeddings, FTS |
| M10 Correspondence capture | 3 | B | M09 | M | IMAP (Zoho) + Gmail cursors, dedupe, project classifier, filing queue |
| M11 Research and public-data miners | 3 | C per adapter / B extraction | M09 | M | Semantic Scholar, Crossref, OpenAlex; ANH, ANP, Argentina, Perupetro, SEC, EIA; paper-facts extraction; radar ledger import |
| M12 Retrieval gateway | 4 | A (scope) / B | M09 | M | Mandatory scope, hybrid search, RRF, rerank, expiry, audit; property test for leakage |
| M13 Drafting assistant | 4 | A (prompts) / B | M12 | M | Email, report section, calc note with citations; Gmail/Zoho drafts; server-side `/api/llm` for tools |
| M14 Company MCP server, skills and hooks | 4 | B | M12, M13 | S | `/mcp` tools and resources; `.claude/skills/` for drafting and run capture; `SessionStart` hook |
| M15 Lessons and the weekly dream | 4 | A (prompt) / B | M09, M13 | M | Lesson table, Batch consolidation, review queue, `firm/LESSONS.md` generation, decay |
| M16 Analogue memory | 4 | B | M05, M11 | M | AnalogueRow emission, paper-facts mapping, find-similar, proposed defaults for `js/analogues.js` |
| M17 Evaluation, scorecards and cost | 4 | B / C | M12–M15 | S | RAGAS gold set in CI, per-project scorecards, token and cost page |

Size: S ≈ one session, M ≈ two to four, L ≈ five to eight, for the tier named.

## 3. Waves (each wave ships to staff before the next starts)

| Wave | Ships | Closes which criteria (`06` §9) |
|---|---|---|
| 0 Foundations | M00, M01 | AC12 (keys), AC13 (public site unchanged), Access verified |
| 1 Vault + latest versions | M02–M06 | AC1, AC2, AC3 |
| 2 Staleness | M07, M08 | AC4, AC5 |
| 3 Everything in | M09–M11 | AC7, AC8 |
| 4 Intelligence | M12–M17 | AC6, AC9, AC10, AC11, AC14 |

Waves 1 and 2 deliver O1 (recommended option). Wave 3 makes the vault
complete. Wave 4 delivers O2–O4. `admin.html` is retired at the end of wave 2.

## 4. Definition of done, per module

1. The module's smoke tests (written in the spec, before code) are green in CI.
2. The full repo suite (`npm test` today, plus `vault/test`) is green.
3. Visual proof for anything with a surface: a Playwright screenshot on
   seeded data, attached to the PR.
4. A Tier A review (batch) with no blocking finding.
5. The module's `CHANGELOG.md` entry and, where it changes a tool, a version
   bump in `tool.json`.

## 5. Build cost model (order of magnitude)

Assumptions: Tier A tokens are dominated by contracts and reviews (roughly a
fifth of total tokens), Tier B by implementation (three fifths), Tier C the
rest; prompt caching on stable prefixes; reviews on Batch. Using the Sep 2026
list prices above, a module of size M costs in the low tens of dollars in
tokens at Tier B and single dollars at Tier C; the whole plan (18 modules,
roughly 45 sessions) lands in the low hundreds of dollars of tokens, against
low thousands if a single frontier model built everything. The dominant cost
is partner time at the two gates and at each wave's review, which is the
point: the model spend is deliberately kept small so the reviews can be
thorough.

## 6. What a module session looks like (for whichever model runs it)

1. Read `AGENTS.md`, `docs/vault-hub/06-architecture.md` §2 and §6, the
   module spec, and the schemas the spec names.
2. Write or extend the smoke tests named in the spec so they fail.
3. Implement until they pass; run the full suite.
4. Open a PR titled `M<nn>: <one line>` with the screenshot if there is a
   surface. Do not touch files outside the spec's deliverables.
5. If any acceptance criterion cannot be met as written, stop and say so in
   the PR; do not narrow it.

# Wave 4 — Gate 2 Markup: research runs per project

Cites W4-D1…D4 and Option A. Built only on explicit approval.

## 1. BEFORE → AFTER

### 1.1 The project file (P33, P35, P37)

BEFORE: toolbar, file card, KPIs, Opportunity, Fields, Add documents, tabs Timeline / Headline numbers / Lineage / Basis notes / Lessons / Scorecard. Nothing the Vault found by itself.

AFTER:
```
TOOLS  Opportunity Register · Nodal Analysis · …   [ Research this project ]  last run 1 Oct 12:40 · 42 findings · 3 proposals · stopped at 15 min
…
Timeline · Headline numbers · Research (42) · Lineage · Basis notes · Lessons · Scorecard

RESEARCH                                                  run of 1 Oct 12:40, 15 min, £1.80 · World Monitor 31 · literature 7 · regulators 4
  World Monitor · GDELT                                                                                     31 findings
    30 Sept  "PDVSA restarts Apure production after pipeline repair" — Reuters · query "Guafita"      [open]
    "…the Guafita and La Victoria fields in Apure state resumed…"
  Literature                                                                                                 7 findings
    2024  Waterflood performance of the Guafita field — SPE 215xxx · query "Guafita field Venezuela"  [open]
  Regulators (Venezuela: none configured) · EIA · SEC EDGAR (PDVSA: 0)
  Not reached: GDELT page 3 for "La Victoria"; SEC filings for "Petróleos de Venezuela" (budget)
```
- "Research this project" is in the toolbar for members and partners; while a run is going the button shows progress ("running · 2 min · 12 findings") and the Research tab fills as findings land (polling every 10 s).
- The Research tab lists findings grouped by source and newest first, each with date, title, source, the query that found it, the verbatim excerpt and an [open] that shows the record in the panel. Findings are ordinary items: Find indexes them, briefs and drafts cite them.
- The run summary line says what it did and what it did not reach.

### 1.2 Proposals (P34)

The Fields card's "Proposed from documents" block gains findings as a source: "…the Guafita and La Victoria fields…" (GDELT, Reuters, 30 Sept) with the same Attach / Not a field actions. A new review kind `research` carries operator, licence and production-figure proposals: "Operator: PDVSA (4 sources)" with [Set as operator] on the field, "Production 12,400 bopd (2024)" with [File as fact] which writes the figure onto the research note's facts and the register's `current` only when the person accepts. Queue page rows for both kinds.

### 1.3 Triggers (P35)

- `POST /api/projects` from the Hub queues a run when the project has a country or a name beyond a placeholder.
- Attaching a field (`POST /api/projects/:id/assets`, review-queue accept) queues a run; one open run per project (a trigger on a project with a queued run adds the new field's names to it).
- The button: `POST /api/projects/:id/research` (writable project).
- `RESEARCH_ENABLED=false` on the Vault service switches the triggers and the button off (rollback).

### 1.4 The run (P30, P31, P32)

`vault/src/research/run.ts`:
1. Names: project name; client name; country; for each attached field its short name, GEM name and `name_other`; operators from the fields' records and the register; the project's own `register.source` is not a search term.
2. World Monitor (W4-D1): `search-gdelt-documents` per field and project name (`timespan` 1 year, `max_records` 25, sorted by date); `get-company-enrichment` and `list-company-signals` per operator and client; `search-sec-filings` per operator (`forms` 10-K, 20-F, 6-K, 8-K; 2 years); `get-intel-timeline` for the country (Pro; skipped with a note when gated). Each answer's items become findings; the adapter's hourly cache applies.
3. Miners (W4-D1): `runMiners` with `only` the literature feeds and a `TopicSpec` per field (`query` "<name> field <country>", `keywords` [name, operator], `negative` the firm's list) and per operator; the regulator adapter for the country when one exists; EIA and SEC EDGAR for operators present in `sec_issuers` or resolved by enrichment. Records go through the miners' own dedup and screening and are filed with `project_id` set.
4. Filing (W4-D3): a finding is an item `type: 'note'`, `title` the headline, `legal_tag: 'lt-public'`, `project_id`, `asset_ids` the field(s) whose name found it, `origin: {source: 'research', adapter, external_id, url, fetched_at, query}`, `external_id` (adapter-scoped, so a re-run updates rather than duplicates), `extracted: {kind: 'research', source, query, quote, published_at, authors?}`. Miner records keep their own types (paper, snapshot) and gain `project_id` and `origin.query`.
5. Proposals: `extractAssets` (wave 3) over each finding's text for fields not yet attached → `asset` proposals; with a provider, one low-effort call per finding for operator, licence and production figure with a verbatim quote → `research` proposals (dropped when the quote is not in the text); without a provider only the field pass runs.
6. Budget (W4-D4): stop at 15 minutes wall clock or when the model spend reaches £3 (tokens priced from the provider's own usage; World Monitor and miners cost nothing marginal); the run writes `jobs.summary` with counts per source, proposals, spend, duration and `not_reached` (source, query, cursor); a re-run starts each source from its cursor.
7. Audit: `research.run` with refs `project:<id>` and every `doc:` filed.

### 1.4.8 Addendum, W4-D1 revised (1 October 2026): two more sources

BEFORE: a run asks World Monitor and the literature indexes only. For small, mature fields those answered nothing in the first live run, while Google finds the GEM wiki page, PDVSA and Wikipedia pages, old reports and trade press.

AFTER, in this order inside the same time and spend budget: GEM wiki → World Monitor → web search → literature.

1. **GEM wiki pages (`vault/src/research/gemwiki.ts`, source `gem-wiki`).** For each attached field whose record carries `props.gem.wiki_url`, fetch the page server-side (10 s timeout, one fetch per page per run). File one note "Global Energy Monitor: <field>" with the page's lead sentence and tables flattened as the excerpt (≤ 600 characters), `facts.references` the page's References list, the CC BY 4.0 attribution, `external_id` the page URL. Then file every reference the page cites as its own finding (source `gem-wiki-ref`): title from the citation text or the URL's host, the URL, no quote, `external_id` the URL, deduplicated across fields. No model call. A field without a GEM record is skipped and counted.
2. **Web search (`vault/src/research/web.ts`, source `web`).** One model call per field name (anchored with the country as the GDELT queries are) and one for the project name, through the Messages API server tool `web_search_20260209` with `max_uses: 3`, on the provider's model at low effort. The system prompt asks for the field's operator, licence or block, production, reserves, recent news and technical reports, written as short cited sentences. Every `web_search_result_location` citation the API returns becomes a finding: `url`, `title`, the model's cited sentence as the text, `quote` the API's `cited_text` (verbatim by construction, ≤ 150 characters), `external_id` the URL, deduplicated. Search results the model did not cite are not filed. `stop_reason: pause_turn` is resumed once. Spend: the provider's token usage plus $0.01 per search from `usage.server_tool_use.web_search_requests`, converted at the run's rate. A 400 saying web search is not enabled for the organisation, or any other failure, is recorded as the source's error and the run continues. `RESEARCH_WEB=false` switches the source off. Facts from these findings go through the existing verbatim-quote read for proposals.
3. **Provider.** `LlmProvider` gains an optional `search(req)` (system, prompt, maxUses) → `{text, usage, searches, citations[], results[]}`; `AnthropicProvider` implements it with the raw Messages API as the rest of the provider does; `FakeProvider` takes a search reply for tests. Keys stay on the server.
4. **Hub.** Two more groups in the Research tab and the sources list: "Global Energy Monitor wiki" and "Web search"; a web finding shows its page title and host as the others do.

| # | criterion |
|---|---|
| W4-AC9 | With a stubbed fetch, a run on a project with one GEM field and one plain field files one `gem-wiki` note for the GEM field with the excerpt and the attribution, and one `gem-wiki-ref` finding per reference URL with the URL; nothing for the plain field; no provider call is made for this source; a re-run leaves them unchanged. |
| W4-AC10 | With a fake provider answering a search reply, a run files one `web` finding per citation with URL, title and the cited text as the quote, none for uncited results, counts the searches into spend at $0.01 each, resumes one `pause_turn`, records a "not enabled" 400 as the source's error without failing the run, and skips the source when `RESEARCH_WEB=false`. |
| W4-AC11 | Hub: the Research tab shows "Global Energy Monitor wiki" and "Web search" groups and their rows in the sources list; the end-to-end spec covers both. |

Smoke plan: `research.test.ts` (AC9, AC10 with injected fetch and provider), `hub-research.spec.mjs` (AC11). Risks: web search is an organisation-level switch in the Claude Console (a 400 if an administrator turned it off: reported, not fatal); a search costs money, so `max_uses` is 3 per call and the run's £ cap still applies; the GEM wiki's HTML layout may change (the reader keeps the lead sentence and any `<a href>` under References, nothing more specific). Rollback: `RESEARCH_WEB=false`; the GEM wiki source has no key and no cost. Delivery: one pull request (wave 4 PR 4) after PR 3 (#38) merges.

### 1.5 Routes (new file `vault/src/api/research.routes.ts`; `projects.routes.ts` and `assets.routes.ts` gain one call each; `rerun.routes.ts` accepts kind `research`)

| route | who | does |
|---|---|---|
| `POST /api/projects/:id/research` | writable project | queues (or extends) a run; 202 with the job id; 409 when one is running |
| `GET /api/projects/:id/research` | project visible | the latest runs (status, summary, started, finished) and findings grouped by source |
| `POST /api/queue/review/:id/accept` kind `research` `{apply?: true}` | writable project | records the accepted fact on the finding and, for operator and production, on the field or register; resolves |
| cron `research-sync` (`vault/src/jobs/research.ts`) | — | runs queued jobs the API server did not finish (restart safety); the API server runs a queued job in-process immediately |

### 1.6 Data

Migration `005_research.sql` (additive): `review_queue` kind constraint gains `research`; an index on `items ((extracted->>'kind'), project_id)`. Runs are `jobs` rows (`name = 'research'`, `summary.project_id`). No schema in `docs/vault-hub/schemas/` changes (the item schema already allows free `origin.source` and `extracted` objects).

## 2. Files

| area | files |
|---|---|
| Vault | `vault/db/005_research.sql`, `vault/src/research/run.ts` (new), `vault/src/research/queries.ts` (new: names → queries and TopicSpecs), `vault/src/research/findings.ts` (new: filing and proposals), `vault/src/api/research.routes.ts` (new), `vault/src/jobs/research.ts` (new), `vault/src/intel/worldmonitor.ts` (+ `gdeltDocuments`, `companyEnrichment`, `companySignals`, `secFilings`), `vault/src/api/projects.routes.ts` and `assets.routes.ts` (one enqueue call each), `vault/src/api/rerun.routes.ts` (kind research), `vault/.env.example`, `vault/SETUP.md`, `render.yaml` (cron) |
| Hub | `hub/project.html`, `hub/project.js` (button, status, Research tab, proposals), `hub/queue.js` (research rows), `hub/hub.css` |
| tests | `vault/test/research.test.ts`, `vault/test/research.routes.test.ts`, `vault/test/worldmonitor.test.ts` (+4 readers), `test/e2e/hub-research.spec.mjs` |
| docs | `docs/vault-hub/wave4/06-decision-log.md`, `08-decision-log.md`, `HANDOVER.md` |

Not touched: `docs/vault-hub/schemas/*`, any public page.

## 3. Acceptance criteria

| # | criterion |
|---|---|
| W4-AC1 | For a project with two attached fields and an operator, the query builder yields the GDELT, enrichment, SEC and literature queries listed in §1.4.1–3, and no query from the register's free text. |
| W4-AC2 | With fake World Monitor and fake miner adapters, a run files each finding once with `origin.source = 'research'`, URL, date, query and a verbatim excerpt, `project_id` and `asset_ids` set; a second run updates rather than duplicates and starts from the cursors. |
| W4-AC3 | A run stops at the wall-clock cap (injected clock) and at the spend cap (fake provider usage), writes `not_reached`, and reports counts per source. |
| W4-AC4 | A finding naming an unattached field opens an `asset` proposal; a finding with an operator and a production figure opens `research` proposals carrying verbatim quotes; an invented quote is dropped; accepting the operator proposal sets the field's operator; rejecting resolves. |
| W4-AC5 | `POST /api/projects/:id/research` needs a writable project (403 for a non-member on a client project, 404 when invisible), answers 202 and 409 while running; creating a project from the Hub and attaching a field each queue one run, and a second trigger extends it. |
| W4-AC6 | `RESEARCH_ENABLED=false` disables triggers and the route answers 501 with the reason. |
| W4-AC7 | Hub: the button shows progress and the result line; the Research tab lists findings by source with quotes and opens the record; the Fields card and the queue page show research proposals with Attach / Set as operator / File as fact / Not a fact; an associate who cannot write sees no button. |
| W4-AC8 | Every suite green, typecheck clean, public pages byte-identical, no secret in served files; evidence `w4-research-tab.png`, `w4-research-proposals.png`. |

## 4. Smoke plan

| AC | test |
|---|---|
| W4-AC1 | `research.test.ts` (`buildQueries`) |
| W4-AC2, AC3, AC4 | `research.test.ts` on embedded Postgres with injected fetch, adapters, clock and provider |
| W4-AC5, AC6 | `research.routes.test.ts` with partner, member, non-member |
| W4-AC7 | `hub-research.spec.mjs` with stubbed routes |
| W4-AC8 | the CI suites and the screenshots |

## 5. Delivery: two pull requests, each green and mergeable

1. **The run and its routes**: migration 005, World Monitor readers, queries, run, filing, proposals, routes, triggers, cron, flag. (AC1–AC6)
2. **The Hub**: button and status, Research tab, proposals in the Fields card and the queue, evidence, decision log. (AC7, AC8)

## 6. Risks and rollback

| risk | mitigation | rollback |
|---|---|---|
| GDELT returns noise for short names | names under six characters are queried with the country and "oil field" appended; the miners' negative list applies; a person dismisses proposals | `RESEARCH_ENABLED=false` |
| World Monitor rate limits during a run | the adapter's 429 handling pauses the source and the run records `not_reached`; next run continues | none needed |
| Spend creeps | the £3 cap is enforced from the provider's reported usage; the cap is an env var (`RESEARCH_BUDGET_GBP`, default 3) | lower the cap |
| A run outlives a restart | the `research-sync` cron finishes queued jobs; a job running longer than 20 minutes is marked failed and re-queued once | none needed |

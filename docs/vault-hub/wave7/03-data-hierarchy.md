# Wave 7 review — 03 Data hierarchy

Review of the Vault data model and the Hub's presentation of it against the way a petroleum engineer screens and matures an upstream opportunity. Written 5 October 2026 from the code on `main` (head `dac0a7a`). Every claim about the current state points at a file and line; every recommendation says whether it touches a Tier A schema (it never should) and which of the three journeys it improves.

The short verdict: the Vault's record-keeping is sound (immutable runs and items, supersession, legal tags, citations, nightly staleness, audit on every request). The hierarchy it stores is shallower than the one the firm thinks in: it has **country → project → field** well, and **basin / block / reservoir / well** only as unused enum values. The Hub shows an engineer the *register* first (where, fact → plan, risk, thesis, next step) and the *record* second (timeline, numbers), which is the right order; but the numbers strip is empty on real data because every tool saves runs as `draft` and only `final` runs reach it, the timeline fills with background notes after one research run, the "next step" has no date or owner, and the one well-level calculator (nodal) never names a well. The three journeys traced in §3 each work end to end in the code and each has a gap at the hand-off: email → project needs a partner to create the project by hand before anything can be filed to it; nodal → letter cites a draft run that names no well; a cold open shows the register but not what changed or what is due.

---

## 0. What was read

- `AGENTS.md`, `HANDOVER.md` §0–2 and §9a, `docs/vault-hub/06-architecture.md` §2–§6, the seven schemas in `docs/vault-hub/schemas/`, migrations `vault/db/001` to `007`, module specs M06, M07, M08, M09, M10, M13, the wave 2, 3, 4 and 6 markups and the wave 3 decision log.
- Routes: `projects`, `projects.wave2`, `runs`, `items`, `countries`, `assets`, `mailbox`, `queue`, `activity`, `draft`, `dispatches`, `organisations`, `rerun`, `research`, `lessons`, `common.ts`, `opportunities.ts`; the MCP server; the staleness job; the mail classifier, capture and relationship modules; the ingest pipeline; the dossier and analogue emitters; the drafter.
- Hub: `hub.js` (Today), `project.js`, `record.js`, `draft.js`, `components/timeline-list.js`, `components/vintage-table.js`, `index.html`, `project.html`; the nodal, register and financial-model tools' save paths; `tools/*/tool.json`.

---

## 1. The hierarchy as it is

### 1.1 Diagram (what the tables actually link)

```
                       ┌──────────────────────────────────────────────────────────────────┐
  COUNTRY              │ not a row. projects.country char(2)  [002:6]                      │
  (code only)          │ assets.country text   [001:81]   assets.kind may be 'country'     │
                       │ [001:78] but nothing creates one.                                │
                       │ country_briefs (code, scope_hash, source_hash, body) [003]        │
                       │ live World Monitor risk/intel, never stored  [countries.routes.ts:95-103]
                       └───────────────┬──────────────────────────────────────────────────┘
                                       │ projects.country
                       ┌───────────────▼──────────────────────────────────────────────────┐
  PROJECT /            │ projects: client_id → organisations, status (prospect|active|     │
  OPPORTUNITY          │ closed|archived) [001:62], default_legal_tag, members[],           │
                       │ asset_ids text[] [001:64], country, lat, lon, stage (text),       │
                       │ stage_history jsonb, register jsonb [002:5-11]                    │
                       │ project_contacts (project_id, contact_id) [001:70-74]             │
                       │ register.holder / government / partners / licence_* are FREE TEXT │
                       │ [opportunities.ts:294-299], not organisation ids                 │
                       └──┬─────────────────────┬──────────────────────┬──────────────────┘
                          │ asset_ids[]         │ project_id (NOT NULL) │ scope_id
          ┌───────────────▼────────┐  ┌─────────▼──────────────┐  ┌────▼──────────────────┐
  ASSET   │ assets: kind ∈ basin|  │  │ RECORDS                │  │ lessons (scope, scope_id)│
  (master │ field|reservoir|well|  │  │ runs [001:105-127]     │  │ scope ∈ firm|discipline| │
  data)   │ block|country [001:78] │  │   asset_ids text[]     │  │ client|project|tool      │
          │ parent_id → assets     │  │   supersedes → runs    │  │ (no country, no asset)   │
          │ [001:80] — NEVER SET   │  │   run_inputs(ref,hash) │  └──────────────────────────┘
          │ by any Hub path        │  │ items [001:140-170]    │
          │ [project.js:432-441,   │  │   asset_ids text[]     │  ┌──────────────────────────┐
          │  assets.routes.ts:223] │  │   parent_id (attach.)  │  │ analogue_rows(asset_id)  │
          │ lat, lon, location_    │  │   supersedes, version  │  │ [001:225-234] — basin and│
          │ source, status, props  │  │   organisation_ids[]   │  │ country derived from a   │
          │ jsonb (gem|wikidata|   │  │   extracted jsonb      │  │ name map, not parent_id  │
          │ geonames) [004]        │  │   (≥10 sub-schemas)    │  │ [emit.ts:139-158]        │
          └────────────────────────┘  │   item_cites(ref)      │  └──────────────────────────┘
                                      │   item_versions        │
                                      │ dispatches(item_id,    │  ┌──────────────────────────┐
                                      │   organisation_id,     │  │ chunks(item_id|run_id,   │
                                      │   contact_ids[])       │  │   project_id, legal_tag) │
                                      │ filing_queue(item_id)  │  └──────────────────────────┘
                                      │ review_queue(payload)  │
                                      └────────────────────────┘
  COUNTERPARTY   organisations (kind client|partner|operator|regulator|vendor|counsel|other) [001:14-25]
                 contacts (organisation_id, emails[], relationship jsonb [007:53])
                 — linked to a project only through project_contacts (people) and dispatches (documents);
                   the organisation itself is linked only when it is the client (projects.client_id).
  PERSON / MAIL  people, mailbox_connections, mail_rules, filing_decisions [007] — per person, not per project.
```

### 1.2 The engineer's hierarchy against the model

| Engineer's level | In the model | Populated by | Verdict |
|---|---|---|---|
| Country | `projects.country` code; `country_briefs`; live intel | project form, globe tap | Present as a *grouping* of projects, not as a thing with its own stored record. Country-level lessons are impossible: `lesson.schema.json` `scope` enum has no `country` (Tier A). |
| Basin | `assets.kind = 'basin'` | nothing (gazetteer candidates are fields) | Enum only. `parent_id` never written (`hub/project.js:432-441` builds `{create:{name, kind, lat, lon, location_source, source_id, source_url, detail, country}}`; `vault/src/api/assets.routes.ts:223` would accept `parent_id` but no caller sends it). |
| Block / licence | `assets.kind = 'block'`; `register.licence_type`, `licence_note` | register text | Two unlinked homes: an asset kind nobody creates, and free text on the register (`vault/src/opportunities.ts:296-299`). |
| Field | `assets.kind = 'field'` + `projects.asset_ids[]` | Fields card, proposals, research | The one level that works: located, sourced, dossier filed (`vault/src/assets/dossier.ts:40-56`), flagged when outside the country (`assets.routes.ts:249-255`), feeds research queries (`research/run.ts:134`). |
| Reservoir | `assets.kind = 'reservoir'` | nothing | Enum only. The simulator saves no `asset_ids` at all (`reservoir-simulator.html:2942`; no `asset_ids` anywhere in the file). |
| Well | `assets.kind = 'well'` | nothing | Enum only. The nodal tool saves `asset_ids: []` (`nodal-analysis-tool.html:1360`) and declares its only input as `{ref:'tool:nodal-analysis', kind:'manual'}` (`:1317-1319`). The financial model likewise `asset_ids:[]` (`financial-modelling.html:2247`). |
| Stage | `projects.stage` text + `stage_history` | stage select, PATCH | Present. Overlaps `status`: a stage of `Closed` and a status of `closed` are two fields with one meaning and nothing reconciles them (`opportunities.ts:287`, `projects.routes.ts:18`, `projects.wave2.routes.ts:248-257` sets `closed_at` on status only). Wave 2 §1.3 said `prospect` is an opportunity and `active` a project; nothing moves status when stage reaches `Won`. |
| Counterparty | `organisations`, `contacts`, `project_contacts`, `dispatches.organisation_id`; `register.holder/government/partners` text | mail capture, queue Assign, register edit | Split. The people we talk to are rows; the organisations we are negotiating with are text. `get_project_context` prints the text (`vault/src/mcp/server.ts:316-317`). |
| Documents, runs, drafts, dispatches | `items`, `runs`, `dispatches` | tools, ingest, mail, drafter | Present, immutable, scoped. |
| Lessons | `lessons` | lessons loop | Present; scopes firm/discipline/client/project/tool. |
| Country intelligence | live only + cached brief | World Monitor, brief | Present but not a record: nothing a draft can cite a month later except through the `[wm:…]` prefix inside a brief body (`hub/record.js:91`). |
| Mail stream | `items.type='email'` with `extracted.{status,category,direction,contacts,history}` | poll | Present; the discriminators live in `extracted` (`vault/src/ingest/mail/capture.ts:237-248`). |

### 1.3 Where the model and the UI disagree

Each of these is a place where the Hub reads a shape the API does not produce, or writes a shape another part of the Hub does not read.

1. **"Where I worked in the last 90 days" is wired to fields the API never returns.** `hub/hub.js:401` requests `/api/projects?mine=1`; `vault/src/api/projects.routes.ts:89-98` reads only `status` and `client`, so every visible project is listed. The cards then look for `last_activity_at`, `run_count`, `item_count`, `stale_count` (`hub.js:417-427`); the project row (`common.ts:127-133`) carries none, so every card shows "—". A partner sees a grid of every project with no activity data.
2. **`register.current` is a number in the Hub and text in the Vault after "File as fact".** The Opportunity card and the register table show "Fact → plan" only when `typeof reg.current === 'number'` (`hub/project.js:283-284`, `hub/hub.js:888`), with the unit `kboe/d` hard-coded in the UI (`project.js:284, 325-326`); nothing stores a unit. Accepting a production proposal writes `current` as the string `"12400 bopd (2024)"` plus `current_kboed` (`vault/src/api/rerun.routes.ts:191-194`). After an accept, the card shows "—" and the number is in a key the Hub never reads.
3. **Headline numbers and the KPI strip only read `final` runs, and nothing saves one.** `GET /api/projects/:id/vintages` filters `record->>'status' = 'final'` (`projects.routes.ts:195-196`); the KPI strip takes its two headline figures from the newest vintage (`project.js:1297-1314`). Every tool saves `status: 'draft'` (`nodal-analysis-tool.html:1365`, `opportunity-register.html:999`, `reservoir-simulator.html:2942`, `financial-modelling.html:2249`, `vault/src/adapters/apex-asset-intelligence.ts:70`). Runs are immutable and there is no route to change a status (`runs.routes.ts:134-138`); the only path to `final` is `POST /api/runs/:id/supersede` with a new record, which the dedupe `UNIQUE (job, tool_version, input_hash)` (`001:125`, `runs.routes.ts:44-45, 88-89`) refuses when nothing but the status changed. So on real data the project page says "no final run yet" forever, the scorecard's rule 1 and 4 are "n/a", and the analogue table never receives own-evaluation rows (`runs.routes.ts:82` emits only reviewed/final).
4. **Everything the Vault finds on its own is a `note`, and the timeline treats notes as "Other".** Dossiers (`dossier.ts:50`), research findings (wave 4 §1.4.4), drafts (`draft.routes.ts:41-42`) and country-brief exclusions are all `type='note'` distinguished by `extracted.kind`. The timeline route returns them all without the kind (`projects.routes.ts:136`); the component buckets `note` under "Other" (`components/timeline-list.js:53-56`). One research run can file dozens of notes with `authored_at` of the finding (`activity.routes.ts:36-37` has to exclude `draft|research|country-brief` by hand to keep "What came in" readable; the timeline has no such filter).
5. **Two "risks".** The country list and panel show World Monitor's composite score as "risk 71" (`hub.js:526, 562`); the register row shows the firm's own execution risk as "Amber 54" (`hub.js:891`). Same word, different meaning, side by side on Today.
6. **Expiry "not available from the API".** `legal_tags.expires_at` exists (`001:50`) and is loaded into `Access` (`common.ts:137-138`), but `GET /api/projects/:id` returns only the tag id (`projectView`, `projects.routes.ts:20-23`); the header derives expiry from the client file's contracts and otherwise prints "expiry not available from the API" (`project.js:128-135`). Scorecard rule 5 is "n/a" for the same reason (`project.js:889-890`).
7. **Assets shown twice.** The file card lists `asset_ids` as chips (`project.js:138-142`) immediately above the Fields card that lists the same ids with sources (`project.js:468-499`).
8. **The MCP summary has no stage, country, register or next step.** `projectSummary` prints client, status, tag, members, counts, last activity and contacts (`vault/src/mcp/server.ts:129-148`); `get_project_context` adds the register's counterparty text and open-proposal count (`server.ts:316-319`) but not the stage, the thesis, the next step, the latest figure or the fields. A Claude session asked to "write to the client about where we are" starts without the stage.
9. **"What came in" is per person and per day, never per project.** `since` is the person's `last_seen_activity_at` or 24 hours (`activity.routes.ts:21-28`); the project page has no "since you last opened this" at all.
10. **`extracted` is an unregistered schema.** At least these sub-shapes live under `items.extracted`: `ingest`, `kind: draft` (paragraphs, review, sent), `kind: dossier`, `kind: research` (query, quote, accepted_facts), email (`status`, `category`, `direction`, `contacts`, `folder`, `attachments`, `history`, `privacy`, `classification`), legal-finance facts, `partners_only`. The index `items_extracted_kind_project_idx` (`005:8`) exists, but no code path, test fixture or document enumerates the keys, and `vault-item.schema.json` says only `additionalProperties: true`.

---

## 2. What an engineer expects first, and what the Hub shows first

"First" means the first screenful before scrolling or clicking, in DOM order.

### 2.1 Country

| Engineer expects first | Hub shows first (file:line) | Gap |
|---|---|---|
| Which basins and plays; our opportunities there with stage and the latest figure each; the fiscal regime; the regulator; who we know there; the firm's view (brief) and its date; live risk with its date | Globe, then a list of countries with project count, World Monitor score and attention flags (`hub.js:523-531`). On tap: name, project count, live risk line, "Create a project here" (partners), project rows with stage pill, client, "last run <date>" and attached fields with coordinates (`hub.js:555-585`), then the Brief and Country-intelligence cards on demand (`hub.js:589, 598`) | No basin, no fiscal terms (`vault/reference/` fiscal sets are never surfaced here), no contacts in the country, no figure per project (only the date of the last run, `hub.js:568`). The brief is cached by source set with no age shown or age limit (`countries.routes.ts:146-151`). |

### 2.2 Project (opportunity)

| Engineer expects first | Hub shows first | Gap |
|---|---|---|
| Name, country, stage and how long it has been there; counterparty and who at the firm owns it; the latest headline figures with units, dates and whether they are reviewed; the next action with a date; open questions and deadlines; what changed since I last looked | Title; sub-line with client, opened date, status pill, country, stage select, archive (`project.js:87-114`); toolbar; file card with legal tag, expiry, asset chips, client contacts, ATC team (`project.js:118-169`); Opportunity card: where, source, fact → plan, execution risk, current owner, government, licence, JV partners, lead, thesis, next step (`project.js:276-299`); Fields card; Add documents; KPI strip: latest two final-run outputs, active runs, stale records, scorecard (`project.js:1293-1330`); tabs | Stage has no "since" (it is in `stage_history`, shown only as timeline rows, `project.js:1391`). Next step is text with no date, owner or source (`register.next`). KPIs are empty on real data (§1.3 item 3). No "changed since", no open proposals count (only the MCP has it, `server.ts:318`), no unacknowledged dispatches (only inside scorecard rule 6, `project.js:896-909`), no "who we last spoke to" (only in the Write to… picker, `draft.js:82-86`). The legal tag and the upload box take the space an engineer would give to numbers. |

### 2.3 Asset (field, reservoir, well)

| Engineer expects first | Hub shows first | Gap |
|---|---|---|
| The field's facts (operator, status, discovery, production, reserves) with source and date; the runs we have done on it; the documents about it; analogues; which wells | A row in the Fields card: name, kind, source, coordinates, operator/status when GEM supplied them (`project.js:471-497`, `fieldFacts` at `:391`); a "Dossier" button opening the first dossier note; Detach | There is no asset page or asset panel. `GET /api/assets/:id` returns the row only (`assets.routes.ts:275-280`). `GET /api/items` and `GET /api/runs` have no `asset=` filter (`items.routes.ts:326-331`, `runs.routes.ts:116-119`), so "every run on Guafita" cannot be asked. Reservoir and well do not exist as rows. `analogues/similar?asset=` exists (`analogues.routes.ts:56`) but is not reachable from the Fields card. |

### 2.4 Record (run or document)

| Engineer expects first | Hub shows first | Gap |
|---|---|---|
| Run: what it computed (value, unit, date), on what (well/field), with which assumptions and their sources, who made it, reviewed or not, superseded by what, cited by which letters. Document: what it is, from whom, when, what it says (the original), what it cites and what cites it | Run panel: tool@version, status pill, first three numeric outputs with units, inputs count, legal tag, stale (`record.js:238-251`); related: project, inputs, supersession, "Quoted by" (`record.js:254-271`). Document panel: type, project, tag, version, ingested date and source, indexed, stale (`record.js:156-186`); the original viewer; versions, cites, used by, original facts (`record.js:198-219`) | Run panel never shows the assumptions, the asset, the author or the date of the run; `headline()` stops at three outputs (`record.js:225-233`). Document panel never shows `authored_at` (the letter's own date) or the counterparty (`organisation_ids`), only `created_at` as "Ingested". Neither shows dispatch history for the record (the "dispatches that quote it" card promised in wave 2 §1.2 was not built). |

---

## 3. Three journeys, traced in the code

### 3.1 A new country opportunity arrives by email and becomes a project

1. **Poll.** `mail-poll` every 5 minutes (`render.yml:134`) reads each connected mailbox (`vault/src/ingest/mail/poll.ts`), honours Protected/Blocked rules, and hands each message to `captureMessage` (`capture.ts`).
2. **Classify.** `classify.ts:4-14`: contact match 0.5, domain 0.35, thread 0.3, tokens 0.2, memory from `filing_decisions`; files directly at ≥ 0.85 (`capture.ts:210-211`). A sender the firm has never dealt with scores zero against every project, so the message lands in project `firm` with tag `unfiled` and, if bulk, is hidden; if human and with a known counterparty it is `ready`, otherwise `review` (`capture.ts:223-225`), and a `filing_queue` row is opened (`capture.ts:260-261`). A new organisation is proposed into `review_queue` kind `organisation` (`capture.ts:264-267`; partner-only accept, `rerun.routes.ts:198`).
3. **See it.** Today's "What came in" counts it as `review` (`activity.routes.ts:50-53`) under no project (`activity.routes.ts:56` skips `firm`), so the sentence-per-opportunity cannot mention it. It appears in the queue (`queue.routes.ts:22-45`) and the Filing-queue attention card (`hub.js:1147-1155`).
4. **Create the project.** There is no "create a project from this message". A partner opens New project or "Create a project here" (`hub.js:935, 596`) and types name, id, client, country, coordinates, stage and register fields; `POST /api/projects` (`projects.routes.ts:48-87`) inserts the row and, when it has a country or a real name, queues a research run (`:84`). Associates cannot do this (`:49`).
5. **File it.** Back in the queue, Assign (`queue.routes.ts:80-95`): the message and its attachments move to the project, the legal tag is raised to the project's (`:53`), the chunks follow (`:60-61`), the sender becomes a contact on the project (`:66-72`), dispatches are synced (`:73`), the thread and domain are remembered (`:76`). The next message from that thread files itself at 1.0.
6. **Research.** The research cron (`render.yml:161`) runs the queued job: gazetteers for field names, GEM wiki, World Monitor, web search, literature (wave 4 §1.4); findings are `note` items with `lt-public`; field names become `asset` proposals; operator/licence/production become `research` proposals.

**Where it breaks.** The hand-off at step 4 is manual and partner-only: the country, the counterparty organisation and the coordinates are retyped even though the email already carries the sender's domain (and so the organisation, `capture.ts:213-221`) and often the field name in the subject. The `organisation` proposal and the project creation are two unrelated queues. `register.holder` must be typed as text even when the organisation row now exists. The stage opens at `Initial screen` with no record of *why* (no link from the project to the originating email: `projects` has no `origin` or `source_ref`; `register.source` is free text).

### 3.2 An engineer runs a nodal analysis and the result must be citable in a letter

1. **Save.** `captureRun` (`nodal-analysis-tool.html:1369-1380`) builds the record: `project_id` from `?project=`, `asset_ids: []`, `inputs: [{ref:'tool:nodal-analysis', kind:'manual'}]`, assumptions all `provenance: 'assumed'` with units (`:1328-1337`), params, outputs `operating_point_rate {value, unit}` and `operating_point_bhp {value, unit}` (`:1306-1307`), `status: 'draft'` (`:1365`). `vault.saveRun` fills job, version, commit and `input_hash`, posts to `POST /api/runs` (`runs.routes.ts:24-86`); the legal tag is resolved to the project's; `run_inputs` gets the one manual row.
2. **Find it.** The run is on the timeline with a `draft` pill (`timeline-list.js:173-176`); the record panel shows "operating point rate 1,240 bopd · operating point bhp 1,850 psi" (`record.js:225-233`). It never reaches Headline numbers (draft, §1.3 item 3) and never becomes an analogue row (not an evaluation tool, `vault/src/analogues/emit.ts:89-92`).
3. **Draft.** Write to… posts `POST /api/draft {kind:'letter', project_id, organisation_id, brief, run_id}` (`draft.routes.ts:26-53`). The drafter loads the project's non-superseded runs newest first with the named run first, **regardless of status** (`vault/src/llm/draft.ts:95-97`), puts each run's outputs JSON into the prompt (`:165`), and requires every sentence with a figure to end in `[run:<id>]` from the allowed set (`:142`, `checkCitations` `:50-68`); an uncited figure becomes `[QUESTION FOR YOU: …]` (`:63`). The fallback path (no provider) writes "Our calculation … gives operating_point_rate = 1240 bopd [run:…]" (`:198-200`), so the unit travels; on the LLM path the unit travels only if the model copies it from the JSON.
4. **Save the draft.** The result is a `note` item with `extracted.kind='draft'` and an `item_cites` row per citation (`draft.routes.ts:41-46`), so the nightly job marks the letter stale when the run is superseded or stale (`jobs/staleness.ts:103-127`).
5. **Render and send.** `POST /api/render` reserves `ATC-YYYY-NNNN` (`draft.routes.ts:71-76`), lists previous correspondence from `dispatches` (`:68, :80`), renders DOCX/PDF; Send (`draft.send.routes.ts`) writes the dispatch and freezes the draft.

**Where it breaks.** (i) The letter cites a *draft* run and nothing warns: `draft.ts:165` marks `STALE` but not `draft`, and `draft.routes.ts:52` returns `runs[].status` without a warning. (ii) The run names no well and no field, so the letter cannot say "for well X on field Y" from the record, and `asset_ids` on the project cannot be searched for it. (iii) Staleness for this run can only ever fire R1 (tool version), because its inputs are manual (`staleness.ts:83-96`); a corrected PVT or a new test rate never makes the letter stale. (iv) The record panel shows three of the outputs and none of the assumptions, so a reviewer opening the cited run from the letter cannot see what was assumed without the "Full record" JSON (`record.js:294-299`).

### 3.3 A partner opens a project cold after a month away

1. `project.js:1334-1355` loads the project, timeline, vintages, lineage, notes, lessons, runs, the client organisation and file, the catalog, geo and research in one burst.
2. Renders, top to bottom: header (name, client, opened, status, country, stage, archive) → toolbar → Opportunity card → Fields card → Add documents → KPI strip → tabs (Timeline first) (`project.js:1375-1393`, DOM order `project.html:103-133`).
3. The partner reads the register (where, source, fact → plan, risk, holder, government, licence, partners, lead, thesis, next step) and then scrolls the timeline, where stage changes are interleaved with records (`project.js:1391`).

**What is missing for the question "where does it stand".** (i) When the stage last changed: only derivable by finding the stage row in the timeline. (ii) What changed in the month: no per-project `since`; Today's card is per person and resets at 24 h or "Mark all as seen" (`activity.routes.ts:21-28, 93-98`). (iii) Open decisions: `review_queue` rows for this project (asset, research, organisation, NDA expiry, rerun-delta) are not counted on the page; the Fields card shows asset/research proposals (`project.js:516-520`) but nothing shows an NDA-expiry or re-run delta. (iv) Deadlines: the only due dates in the Vault are invoice due dates (`vault/src/ingest/legal-finance.ts`, `organisations.routes.ts:215-216`); no project, dispatch or register field has a date. (v) Who we are talking to: `project_contacts` people are in the file card (`project.js:146-162`) with email and language, not with last contact; the counterparty organisations are text; the dispatch register for the client is loaded (`project.js:1351`) but only used by scorecard rule 6. (vi) The latest figure: empty unless a final run exists (§1.3 item 3). (vii) Through Claude: `get_project_context` gives counts, contacts and register text, no stage (`server.ts:129-148, 312-319`).

---

## 4. Classification of record kinds: foreground, background, archive

The rule column says what *decides* the class. Where the Vault already stores the deciding fact the reference is given; where it does not, the rule is the one §5 recommends.

### 4.1 Foreground (what the page should lead with)

| Record | Deciding rule | Stored today |
|---|---|---|
| Current stage and when it was entered | `projects.stage`; last element of `stage_history` | `002:9-10`; the date is not shown |
| Latest run per tool that is not superseded, preferring `final` > `reviewed` > `draft`, with its date | `runs.status <> 'superseded'`, `DISTINCT ON (job)` newest | `runs.status` (`001:120`); the vintages route takes only `final` (`projects.routes.ts:196`) |
| Key figures with unit and as-of date: the above runs' `outputs`, the register `current`/`plan` with source | `outputs[*].{value,unit}`; `register.current_source` when present | units on outputs (schema); none on register; `current_source` only after a research accept (`rerun.routes.ts:194`) |
| Next action, owner, due date | `register.next`, `register.owner`; **no date exists** | `opportunities.ts:294` |
| Open decisions | `review_queue.status='open'` with `payload.project_id`; `filing_queue.status='open'` whose top suggestion is the project; `[QUESTION FOR YOU]` paragraphs in unsent drafts | `001:258-276`; `countries.routes.ts:69-75` counts filing per project; questions in `extracted.questions` (`draft.routes.ts:45`) |
| Who we are talking to | `project_contacts` + `contacts.relationship.last_contact_at/by`; counterparty organisations | `007:53`, `relationship.ts:10`; organisations only as text |
| Deadlines | NDA/legal-tag expiry (`legal_tags.expires_at`, contracts' `extracted.expiry`); unacknowledged outbound dispatches; invoice due dates | `001:50`; `organisations.routes.ts:194-199, 201-202, 210-217` |
| Latest version of a delivered document (letter, report, proposal) | `items.supersedes` chain head; `dispatches.direction='out'` | `001:158, 188-205` |
| Current confirmed lessons in scope | `lessons.status='confirmed'` and not decayed | `lessons.routes.ts:3, 44` |
| Attached fields with located source and operator | `projects.asset_ids`, `assets.location_source` | `004` |

### 4.2 Background (available one click down, never at the top)

| Record | Deciding rule | Stored today |
|---|---|---|
| Superseded runs | `runs.status='superseded'` or another run's `supersedes` points at it | `runs.routes.ts:79` |
| Prior item versions | `item_versions` rows below `items.version`; items another item supersedes | `001:172-179` |
| Draft runs older than a newer run on the same tool | `status='draft'` and not the newest per job | derivable |
| Research findings, dossiers, GEM wiki notes, web findings | `extracted.kind IN ('research','dossier')`, `origin.source IN ('research','gem','wikidata','geonames')`, `legal_tag='lt-public'` | `dossier.ts:46-52`; wave 4 §1.4.4 |
| History mail (the 180-day backfill) | `extracted.history = true` / tag `history` | `activity.routes.ts:36` excludes it |
| Human mail that is filed and answered | `type='email'`, `extracted.status='filed'`, thread has a later message | `capture.ts:244-248` |
| Drafts that were reviewed and sent (the sent copy is foreground as a dispatch; the draft is background) | `extracted.kind='draft'` with `extracted.sent` | `record.js:133-135` |
| Stage changes older than the current stage | `stage_history[0..n-2]` | `002:10` |
| Lessons `proposed` | `status='proposed'` | review material |
| Raw ingest facts (chunks, text.md, ingest status) | derived data | `chunks`, `derived/<id>/text.md` |
| Analogue rows for the project's fields | `analogue_rows.asset_id ∈ asset_ids` | `001:225-234` |
| Cached country brief and intel | `country_briefs` by source hash; live intel | §5.3 for ageing |

### 4.3 Archive (kept, hidden by default, reachable by id or Find)

| Record | Deciding rule | Stored today |
|---|---|---|
| Hidden runs and items | `hidden = true` | `001:124, 165` |
| Archived projects and everything under them | `projects.status='archived'` | `countries.routes.ts:48`, `hub.js:870` |
| Bulk mail | `extracted.category='bulk'` (hidden) | wave 6 AC6; `activity.routes.ts:46` |
| Records whose legal tag has expired | `legal_tags.expires_at < today` (R4 hides them) | `staleness.ts:77, 135` |
| Dismissed filing rows, rejected proposals | `filing_queue.status='dismissed'`, `review_queue.status='rejected'` | `queue.routes.ts:118-136`, `rerun.routes.ts:199` |
| Invalidated lessons | `status='invalidated'`, `valid_to` set | `lesson.schema.json` |
| Revoked mailbox connections and their purged originals | `mailbox_connections.status='revoked'` | `007:17, 27` |
| Purged originals of uncited papers (wave 4) | `storage_key` present, object gone, `ingest.status='no_original'` | `record.js:194-195` |

The three classes map onto three existing mechanisms: **supersession** (runs/items), **status** (run status, queue status, stage, project status, hidden, archived, bulk, history) and **staleness** (`stale` + `stale_reasons`). What is missing is a fourth, **age** (§5.2), and a single place that applies all four to produce "what to show first" (recommendation A1).

---

## 5. Recommendations

Effort: S = a day or less, M = two to five days, L = more than a week. Journey: (a) email → project, (b) nodal → letter, (c) cold open. None of these changes a file in `docs/vault-hub/schemas/`; where a Tier A schema is the reason something cannot be done the better way, §6 says so.

### 5.1 Additive schema changes (new tables, columns, views; no Tier A file touched)

| # | Change | Why | Effort | Journey |
|---|---|---|---|---|
| S1 | **`project_figures`** table: `(id, project_id, asset_id NULL, name, value numeric, unit text NOT NULL, as_of date NOT NULL, source_ref text NOT NULL, provenance text, run_status text, superseded bool, stale bool, computed_at)`; nightly job fills it from the newest non-superseded run per `job` (`runs.record->'outputs'`) and from `register.current/plan` (with `current_source` when present, else `provenance='register'`); view `project_figures_current`. | Gives one queryable, unit-bearing, dated figure per project and per field without touching the run record. Replaces the "final-only" vintage dependency on the page and in the brief. | M | b, c |
| S2 | **`project_milestones`** table: `(id, project_id, kind ∈ next_action\|deadline\|reply_due\|expiry\|data_room_closes, title, due_at date, owner person id, ref text NULL (dispatch:/doc:/run:/tag:), done_at, created_by, created_at)`; `register.next` stays as the display text until migrated. | The Vault has no date on any project-level obligation. The dispatch record cannot carry `expected_reply_by` (Tier A, §6), so the date lives beside it with `ref='dispatch:<id>'`. | M | c |
| S3 | **`project_organisations`** join: `(project_id, organisation_id, role ∈ holder\|government\|partner\|operator\|regulator\|counsel\|vendor, since, note)`. Keep `register.holder/government/partners` as text, but have the Opportunity card's edit offer the organisation picker and write both. | Links the counterparties the register names to the rows mail capture already creates, so "who we are talking to" is one list and the organisation proposal from an email can land on the project. | M | a, c |
| S4 | **`projects.origin_ref text`** and **`projects.stage_changed_at`** (generated or maintained by the PATCH route from `stage_history`). | A project should know which email or document started it (a); the page should say how long the stage has been open (c). | S | a, c |
| S5 | **`items.kind text GENERATED ALWAYS AS (extracted->>'kind') STORED`** plus a documented registry of `extracted` sub-shapes in `docs/vault-hub/modules/M00` (not the schema): `ingest`, `draft`, `dossier`, `research`, `email`, `legal-finance`, `sent`, `accepted_facts`. | The discriminator exists only inside jsonb and only sometimes; the timeline, activity and future "background" bucket all need it in a column. | S | c |
| S6 | **Populate `assets.parent_id`** and allow creating `basin`, `block`, `reservoir`, `well` from the Fields card; recursive view `asset_lineage(asset_id, ancestor_id, depth)`; GEM import sets `parent_id` to a basin asset when the tracker names one. | The enum has had these values since 001 and nothing uses them; analogue emission walks `parent_id` (`emit.ts:154-158`) and finds nothing. | M | b |
| S7 | **`runs.reviewed_by`, `runs.reviewed_at`** columns, with the row's `status` promoted by a route (A5). | The row's `status` is already "the one mutable field" (`runs.routes.ts:19-22, 79`); the record JSON stays immutable. | S | b, c |
| S8 | **`country_briefs.max_age_days`** default 90 and **`country_notes`** table `(id, country, title, body, source_ref, authored_by, authored_at, superseded_by)` for the firm's own country intelligence as citable, dated records. | The brief is served from cache as long as its sources are unchanged (`countries.routes.ts:146-151`); the firm's own view of a country lives nowhere. | S / M | c |
| S9 | **`runs.age_flags jsonb`** and **`items.age_flags jsonb`** written by the nightly job (§5.4): `older_than_latest_document`, `older_than_90d`, `draft_older_than_newer_run`. | Age is advisory, distinct from `stale` (which means "an input changed"); keep them apart so AC4's exactness holds. | S | b, c |

### 5.2 API shape changes

| # | Change | Why | Effort | Journey |
|---|---|---|---|---|
| A1 | **`GET /api/projects/:id/standing`** (one call): `{stage, stage_since, next_action (S2), figures (S1, per job and per field, with unit, as_of, status), open: {proposals by kind, filing, questions_in_drafts, unacknowledged_dispatches, unanswered_inbound}, counterparties (S3 + last contact from contacts.relationship), deadlines (S2 + tag expiry + invoice due), since: {for the caller: records since last open}, stale_counts, last_activity}`. Scope-checked exactly as the timeline. Also the body of `get_project_context` and `vault://projects/{id}/summary.md`. | Everything in §3.3 in one shape, for the Hub and for Claude. | M | c |
| A2 | **`GET /api/projects` honours `mine=1`** and returns `last_activity_at`, `run_count`, `item_count`, `stale_count` (the Hub already reads them, `hub.js:417-427`). | Fixes §1.3 item 1. | S | c |
| A3 | **`asset=` filter on `GET /api/items` and `GET /api/runs`**, and **`GET /api/assets/:id/file`** (the asset's runs, items, analogue rows, dossier, across the projects in scope, each row scope-checked). | Makes the asset a level you can open. | M | b |
| A4 | **Timeline entries carry `kind` (S5) and a `class ∈ foreground\|background`** computed server-side by §4's rules; `?class=` filter; default both, so the component can collapse background. | §1.3 item 4. | S | c |
| A5 | **`POST /api/runs/:id/status {status: reviewed\|final}`** (members and partners; partner for `final`), updating the row's `status`, `reviewed_by`, `reviewed_at`; `vintages` switches from `record->>'status'` to the row's `status` (`projects.routes.ts:196`); `emitIfEvaluation` is called on promotion. | Without this no run ever reaches Headline numbers, the KPI strip, the analogue table or scorecard rules 1 and 4. The record JSON is untouched, so `run-record.schema.json` is respected; the API already overlays `status` from the row on read (`runs.routes.ts:20-22`). | S | b, c |
| A6 | **Draft warnings for weak citations**: `warnings[]` gains "cites draft run <id>" and "cites run older than document <id>" (S9); `context.runs[]` gains `asset_ids`, `created_at`, `outputs` with units; the post-check also verifies that every number in a cited sentence equals a value in the cited run's `outputs` or `assumptions` (value and unit). | §3.2 (i), (iv); units and provenance travel with the number. | M | b |
| A7 | **`GET /api/projects/:id/activity?since=`** reusing `gather()` from `activity.routes.ts:41-67`; `since` defaults to the caller's last audit event `project.read` on this project. | "What changed since I opened this". | S | c |
| A8 | **`POST /api/queue/filing/:id/create-project`** (partners): creates the project with `country` from the sender organisation's `country`, `origin_ref` = the item, `register.holder` and `project_organisations` from the sender's organisation, then assigns the row. | Collapses §3.1 steps 4–5 into one action from the queue. | M | a |
| A9 | **`GET /api/projects/:id` returns `legal_tag_expiry`** from `Access.tags`. | §1.3 item 6; scorecard rule 5. | S | c |
| A10 | **Nodal and simulator runs carry `asset_ids`**: the tools read `?asset=` beside `?project=` (`js/vault-client.js`), the Hub toolbar passes the first attached field, and a well picker in the tool (S6) creates `well` assets under it. | §3.2 (ii). | M | b |

### 5.3 Hub presentation changes

| # | Change | Why | Effort | Journey |
|---|---|---|---|---|
| H1 | **"Where it stands" strip** above the Opportunity card, from A1: stage · since; next action · due · owner; the figure per tool with unit, date and status pill; open decisions as chips (3 proposals, 1 reply overdue, 2 questions in a draft); last contact per counterparty. Move the legal tag, default tag and ATC team into a collapsible file card below the Fields card. | §2.2 and §3.3. | M | c |
| H2 | **Timeline: Foreground by default, "Background (n)" collapsed** (A4): superseded runs, research, dossiers, history mail, reviewed-and-sent drafts, older stage changes. "Stale only" stays. | §1.3 item 4. | S | c |
| H3 | **Fields card rows show counts and open an asset panel** (A3): runs · documents · analogues · wells; the panel lists them and offers "find similar" (`analogues.routes.ts:56`). | §2.3. | M | b |
| H4 | **Every number carries unit · date · source chip**: register `current`/`plan` (S1 gives both), KPI tiles (already unit, add date and status), run panel (all outputs, then assumptions with provenance and source, then asset and author). Read `register.current_kboed` when `current` is text (`rerun.routes.ts:191-194`). | §1.3 item 2; §5.4. | S | b, c |
| H5 | **Today**: fix or drop "Where I worked" (A2); label the two risks ("World Monitor 71 · our execution risk Amber 54"); show the brief's `generated_at` and a "regenerate" when older than `max_age_days` (S8); the country panel's project rows show the latest figure (S1) instead of only "last run <date>". | §2.1, §1.3 items 1 and 5. | S | c |
| H6 | **Run panel**: a "Mark reviewed / final" action (A5) for members and partners, and a "Cited by" card built from `item_cites` on the server rather than from the lineage edges in the browser (`record.js:76-79` only sees edges inside the loaded project). | §3.2 (iv); b. | S | b |
| H7 | **Queue row → "Create a project from this"** (A8) with the organisation, country and subject prefilled. | §3.1. | S | a |
| H8 | **Stage select shows "since <date>"** and the stage row in the timeline carries the stage age; `Won` offers to set status `active`, `Lost`/`Closed` to set status `closed`. | §1.2 stage/status overlap. | S | c |

---

## 6. What cannot be done without a Tier A change (said plainly)

- **A well, reservoir or as-of date on the run record itself.** `run-record.schema.json` has `additionalProperties: false`; `asset_ids` and `facets` are the only extensible places. Use `asset_ids` for the well (A10) and `facets` for anything else; do not propose new top-level keys.
- **An expected-reply date on a dispatch.** `dispatch.schema.json` has `additionalProperties: false` and the API validates the posted body; a `dispatches.due_at` column would make `dispatchView` return a key the schema forbids. Hence `project_milestones` with `ref='dispatch:<id>'` (S2).
- **Country-level lessons.** `lesson.schema.json` fixes `scope` to `firm|discipline|client|project|tool`. A country lesson can only be a firm lesson whose `detail` names the country. `country_notes` (S8) is the honest substitute for firm knowledge about a country; it is not a lesson.
- **A `research-finding` or `dossier` item type.** `vault-item.schema.json` fixes the `type` enum; they stay `note` with `extracted.kind`, which S5 lifts into a column. The enum also has no `well-test`, `log` or `production-history` type for client data; `data-room-file` and `spreadsheet` are the only homes, so a production history cannot be distinguished from a cost spreadsheet by type.
- **A unit on `register.current` inside the project row.** `register` is Hub-owned jsonb (not Tier A), so a unit *can* be added there; the recommendation is nevertheless to move figures to `project_figures` (S1), where `unit` and `as_of` are NOT NULL.
- **Dedupe-safe promotion of a run to `final` by supersession.** `UNIQUE (job, tool_version, input_hash)` on `runs` (`001:125`) is a table constraint, not a Tier A schema, but relaxing it would break AC3; A5 avoids the question by promoting the row's `status` in place, which `runs.routes.ts:79` already does for `superseded`.

---

## 7. Data quality and staleness

### 7.1 What the Vault already does, and does well

- **Immutability and supersession.** Runs and items refuse PUT/PATCH/DELETE (`runs.routes.ts:134-138`, `items.routes.ts:345-353`); a run supersedes a run of the same project only (`runs.routes.ts:54`); an item gains a version only when its content hash changes (`items.routes.ts:259-262, 285-296`); hide, never delete.
- **Citations as data.** `item_cites` rows for every `[run:…]`/`[doc:…]` a draft or note carries (`draft.routes.ts:46`, `items.routes.ts:297`); the drafter refuses uncited figures and turns them into questions (`draft.ts:50-68`); the activity brief drops uncited claims (wave 6 AC7).
- **Staleness.** Nightly at 03:15 (`render.yml:83`), recomputed from scratch, rules R1–R4 and CITES with stored reasons (`jobs/staleness.ts:38-144`); propagated through chains of runs to a fixed point (`:72-101`) and to items (`:108-127`); shown on the timeline, the KPI strip, the country flags and the record panel; "re-run with current" with a delta note (`rerun.routes.ts`).
- **Provenance on numbers.** Run `assumptions` carry `value, unit, source, provenance` (schema); the nodal tool fills them (`nodal-analysis-tool.html:1328-1337`); outputs carry `unit`; analogue rows carry per-number provenance (`analogue-row.schema.json $defs.num`) and an `evidence[]` quote per property; research facts carry a verbatim `quote` and are accepted by a person (`rerun.routes.ts:183-184`); dossiers carry attribution and the record id (`dossier.ts:26-35`).
- **Decay elsewhere.** Lessons rank by confidence × decay and are queued for reconfirmation after 12 months (`lessons.routes.ts:3`, schema `last_confirmed`); contact relationships halve every 180 days (`relationship.ts:12`); a country brief regenerates when any source, stage or register field changes and when World Monitor's timestamps move (`brief.ts:37, 51, 63`; wave 3 deviation 4).

### 7.2 Where a figure does not age

- **A run with manual inputs is never stale by R2/R3.** Nodal, simulator and financial-model runs declare `tool:` manual inputs only, so only a breaking tool version can mark them (`staleness.ts:78-96`). A 2024 nodal run cited in a 2026 letter is "current" forever.
- **Reference sets are not resolved.** `latestRefByExternalId` is a stub returning `null` (`staleness.ts:146-149`), so a `ref:price_decks/brent-2026-09` input never triggers R3 even though the financial model and ELA declare `consumes: price_deck` (`tools/financial-model/tool.json`, `tools/ela-model-suite/tool.json`). A new price deck changes no NPV's staleness.
- **No age rule at all.** Nothing compares a run's `created_at` with the project's newest document, with the field's newest dossier, or with a calendar. The GEM dossier older than the imported release (F15 in the wave 3 log) is still open.
- **The country brief has no maximum age.** A cached brief is served while `source_hash` matches (`countries.routes.ts:146-151`); a quiet project yields a brief that is months old and labelled only by `generated_at` in the response, which the Hub does not show as an age.
- **Register figures have no date.** `current` and `plan` carry neither unit nor as-of; only a research accept adds `current_source.accepted_at` (`rerun.routes.ts:194`).

### 7.3 How a figure should age (proposed rules, advisory, kept apart from `stale`)

Computed nightly into `age_flags` (S9) and surfaced by A1/H4; none of them sets `stale`, so AC4's exact set is untouched.

| Rule | Condition | Shown as |
|---|---|---|
| G1 | A non-superseded run is older than the newest `foreground` document on the same project (letter, report, spreadsheet, data-room file, human email with an attachment) | "older than <doc title>, <date>: check its inputs" |
| G2 | A run older than 90 days with status `draft` and a newer run on the same `job` | "draft superseded in practice" → background |
| G3 | A country brief older than `max_age_days` (90) | "brief from <date>: regenerate" on the country panel |
| G4 | A dossier whose `extracted.release` is older than the imported GEM release | "GEM release moved: refresh dossier" (closes F15) |
| G5 | A `register.current` without `current_source` or older than the newest research accept of kind `production` | "unsourced" chip on the Opportunity card |
| G6 | A `project_milestones.due_at` in the past with no `done_at` | deadline chip red on the standing strip |
| G7 | A reference-set input whose newest `items` row (by `external_id = ref`) has a different `content_hash` | this one *is* R3 and should set `stale`; implement `latestRefByExternalId` properly |

### 7.4 How units and provenance should travel with every number

1. **At the source.** Every tool's `outputs[*]` must carry `unit` (the schema allows omitting it; the register and nodal set it, the APEX adapter sets it only when `HEADLINES` has one, `apex-asset-intelligence.ts:62`). Add a vault-client check that refuses a numeric output without a unit (`js/vault-client.js:170-172` already checks `value`).
2. **In storage.** `project_figures.unit NOT NULL`, `as_of NOT NULL`, `source_ref NOT NULL` (S1). The register's `current`/`plan` are copied there with `provenance='register'` until a source is accepted.
3. **In retrieval.** The drafter's context already serialises outputs with units (`draft.ts:165`); A6 adds the post-check that a cited number equals the cited run's value and unit, so the model cannot silently convert bopd to kboe/d.
4. **On the page.** H4: no number without `unit · as-of · source chip`; the chip opens the run or document panel; a figure whose source is a draft run shows the `draft` pill beside it.
5. **In the letter.** The render already keeps citations when asked (`draft.routes.ts:80 keep_citations`); the basis note (`calc-note` kind) should be generated and cited from the same run before a letter that quotes it is sent, which scorecard rule 4 already tests for (`project.js:870-886`).

---

## 8. Priority order

If only five things are done: **A5 + S7** (runs can become final; the numbers strip, the analogue table and the scorecard come alive, S), **A1 + H1** (the standing strip, M), **A4 + H2** (foreground/background timeline, S), **A10 + S6** (nodal names a well under a field, M), **A8 + H7** (create a project from the queue, M). Together they close the hand-off gap in each of the three journeys without touching a Tier A file.

---

## Appendix: file and line index used in this review

| Area | Files |
|---|---|
| Schema and migrations | `vault/db/001_init.sql` (projects 58-68, assets 76-86, runs 105-127, items 140-170, dispatches 188-205, lessons 212-223, analogue_rows 225-234, filing/review queues 258-276), `002_opportunities.sql`, `003_country_briefs.sql`, `004_assets_wave3.sql`, `005_research.sql`, `007_mailboxes.sql` |
| Access and shapes | `vault/src/api/common.ts` (ProjectRow 127-133, canSee 169-177, resolveTag 218-247), `vault/src/opportunities.ts` (STAGES 287, REGISTER_FIELDS 294) |
| Projects | `vault/src/api/projects.routes.ts` (create 48-87, list 89-98, timeline 132-148, lineage 150-189, vintages 191-209), `projects.wave2.routes.ts` (PATCH 229-267) |
| Runs and items | `vault/src/api/runs.routes.ts` (createRun 24-86, immutability 134-138), `items.routes.ts` (create 203-301, list 323-343) |
| Country and assets | `vault/src/api/countries.routes.ts` (summary 45-117, brief 126-163), `assets.routes.ts` (attach 240-262, routes 265-316), `vault/src/assets/dossier.ts`, `vault/src/analogues/emit.ts` (89-158) |
| Mail and queue | `vault/src/ingest/mail/classify.ts` (1-61), `capture.ts` (207-267), `relationship.ts` (1-40), `vault/src/api/queue.routes.ts` (assign 48-78), `activity.routes.ts` (21-67) |
| Drafting | `vault/src/llm/draft.ts` (checkCitations 50-68, runs 95-97, prompt 142-165, fallback 197-200), `vault/src/api/draft.routes.ts` (26-92), `vault/src/api/rerun.routes.ts` (stale 125-134, research accept 172-197) |
| Staleness | `vault/src/jobs/staleness.ts` (rules 38-144, stub 146-149), `render.yml` (cron 79-211) |
| MCP | `vault/src/mcp/server.ts` (projectSummary 105-150, get_project_context 307-320, summary resource 403-422) |
| Hub Today | `hub/index.html` (section order 97-338), `hub/hub.js` (projects 400-431, globe and panel 481-605, register 865-919, activity 1073-1118, attention 1120-1176, runs 1178-1221, init 1258-1271) |
| Hub project | `hub/project.html` (102-160), `hub/project.js` (header 85-170, opportunity 267-381, attachBody 432-441, fields 448-520, scorecard 829-911, tabs 1116-1138, basis 1234-1264, KPIs 1293-1330, init 1334-1460), `hub/components/timeline-list.js` (32-56, 125-179), `hub/components/vintage-table.js` |
| Hub record and draft | `hub/record.js` (doc 152-221, run 235-273, details 294-299), `hub/draft.js` (82-86, 150-151, 244) |
| Tools | `nodal-analysis-tool.html` (1306-1307, 1317-1337, 1355-1380), `opportunity-register.html` (916-999), `financial-modelling.html` (2247-2249), `reservoir-simulator.html` (2942), `tools/*/tool.json` |

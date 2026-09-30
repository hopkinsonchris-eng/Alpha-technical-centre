# Phase 5 — The Markup (architecture, acceptance criteria, smoke plan)

**Gate 2 status: APPROVED by Chris Hopkinson, 29 Sep 2026 ("Approved. Start building. I would like to see mockups of the system").** Written against
the decisions recorded in `03-choice-sheet.md` (D1 monorepo, D2 Node +
Supabase, D3 Cloudflare Access, D4 legal tags, D5 vault holds originals,
D6 APEX apps write runs, D7 Anthropic + Voyage server-side, D8 three tiers,
D9 vault core first, D10 structured lessons, D11 Zoho Books).

## 0. Standing requirements

- **R1 Complete inventory.** Every class of record the firm produces, receives
  or relies on is in the Vault: runs, deliverables, correspondence, client
  data, legal, billing and finance, research, public data, reference data,
  firm knowledge, firm assets. The inventory in §2a is the checklist; a class
  missing from it is a defect.
- **R2 Letter-ready vault.** Writing a legal letter to a prospective job
  partner must need nothing outside the Vault or its API: the counterparty's
  file (organisation, contacts, addresses, roles), every document previously
  sent to or received from them with dates, channels and reference numbers,
  the contracts and NDAs in force, the relevant runs and evaluations, the
  firm's letterhead, templates, signature blocks and reference numbering, and
  the house style. The output is a finished document on letterhead, not a
  block of text. AC15 tests this end to end.

## 1. System overview

```
                 staff browser                     Claude Code / claude.ai / Cursor
                      │                                        │
        Cloudflare DNS + Access (OTP to @alpha-technical-centre.com)
                      │  /hub/*  and  /api/*  and  /mcp  require an Access JWT
        ┌─────────────┴──────────────┐            ┌────────────┴─────────────┐
        │ Render static site (today) │            │ Render web service       │
        │  public pages   /hub/*     │  ──fetch──▶│  vault-api (Node 22, TS) │
        │  tools + js/vault-client   │            │  REST /api/*  MCP /mcp   │
        └────────────────────────────┘            │  scope gateway, jobs     │
                                                  └───┬────────┬─────────┬──┘
                                                      │        │         │
                                       Supabase Postgres  Supabase   Anthropic API
                                       + pgvector + FTS   Storage    Voyage (embed, rerank)
                                       (records, chunks,  (immutable
                                        lessons, audit)    originals)
        Sources pulled by scheduled jobs:
          Zoho Mail (IMAP) · Gmail API · Zoho WorkDrive · Semantic Scholar · Crossref · OpenAlex
          ANH Colombia (Socrata) · ANP Brazil · Argentina CKAN · Perupetro · SEC · EIA
        External tools pushing runs: APEX Asset Intelligence (apex-app2) · APEX 3D model
```

Three deployables, all from this repo via `render.yml`: the existing static
site (public pages, tools, and the new `/hub/` pages), the `vault-api` web
service (`vault/`), and scheduled jobs (Render cron jobs invoking `vault-api`
commands, or GitHub Actions for the public-data miners). Cloudflare Access
protects `/hub/*`, `/api/*` and `/mcp`; the public site is untouched.

## 2. Ontology (object types and links)

| Object | Key fields | Links |
|---|---|---|
| Person | id (email local part), name, role, disciplines[], signature block | owns Tool, authors Run/Item/Lesson, signs Dispatch |
| Organisation | id, name, kind (client / partner / operator / regulator / vendor / counsel), registered address, jurisdiction, identifiers | has Contacts, Contracts; counterparty of Dispatches |
| Contact | id, organisation_id, name, role, emails[], phones[], postal address, language | recipient of Dispatches, party in Items |
| FirmAsset | id, kind (letterhead / template / signature / logo / style), file, version, language | used by Drafting to render documents |
| Dispatch | `schemas/dispatch` : item_id, direction (out / in), organisation_id, contact_ids[], channel (email / post / courier / portal / hand), sent_at, received_at, reference_no, in_reply_to, acknowledged_at | links Item to Organisation and Contacts; drives "documents previously sent" |
| Client | an Organisation with kind client; contracts[] | has Projects, LegalTags |
| Project | id, client_id, name, status, contacts[], asset_ids[], default legal_tag | contains Runs, Items, Lessons |
| Asset (master data) | id, kind (basin/field/well/block), name, parent_id, country, operator | referenced by Runs, Items, AnalogueRows |
| LegalTag | `schemas/legal-tag` | on every Run, Item, Lesson, AnalogueRow |
| Tool | `schemas/tool-manifest` | has Versions; Runs reference a version |
| Run | `schemas/run-record` | inputs → Run/Item/ReferenceSet; parents → Run; artifacts → Item |
| VaultItem | `schemas/vault-item` (letter, report, email, spreadsheet, paper, feed snapshot, reference set, evaluation) | cites → Run/Item/ReferenceSet |
| ReferenceSet | a VaultItem of type reference-set with a stable path id (`ref:price_decks/brent-2026-09`) | consumed by Runs |
| Lesson | `schemas/lesson` | evidence → Run/Item/Transcript |
| AnalogueRow | `schemas/analogue-row` | source_ref → Run/Item; asset_id → Asset |
| Chunk | item_id, run_id, ordinal, context, text, embedding, tsvector, legal_tag, client_id, project_id | derived from Items and Runs |
| AuditEvent | who, when, action, scope, refs[] | every read through the gateway, every write |

Rules enforced by the API, not by convention:
1. Every Run and Item must carry a legal tag and a project; every Item of a
   client project defaults to that project's tag.
2. A derived record's legal tag is the union of its parents' (most restrictive
   classification, earliest expiry). The API computes it; callers cannot lower it.
3. Records are immutable. A change creates a new version (Items) or a new Run
   with `supersedes`. Deletion is a soft `hidden` flag; purge is an owner-only
   command that refuses when anything cites the record.
4. Nothing is returned by search or retrieval without a scope, and nothing
   outside the scope or past its tag's expiry is ever returned.

## 2a. What goes in the Vault (inventory)

Everything the firm produces, receives or relies on. Nothing is "outside" by
design; if a class of record is missing here it is a gap to raise.

| Class | Examples | How it gets in | Vault type(s) | Default legal tag |
|---|---|---|---|---|
| Tool runs and iterations | every Save in every tool, re-runs, superseded runs | tools write them (M04, M05) | Run | project default |
| Evaluations and deliverables | reports, technical notes, presentations, letters to clients, basis notes | WorkDrive sync, upload, drafting assistant (M09, M13) | report, letter, presentation, evaluation, note | client-nda |
| Correspondence | every email in and out of the firm mailboxes and partners' mailboxes, with attachments; meeting notes and call transcripts | mail capture (M10); upload | email, transcript, note | project default |
| Client data | data-room files, production histories, well files, logs, maps, spreadsheets, photos | WorkDrive sync, upload (M09) | data-room-file, spreadsheet, image | client-nda |
| Legal | NDAs, engagement letters, contracts, subcontracts, licences, insurance, corporate records, regulatory filings | WorkDrive `Legal/` sync, upload; key terms extracted (parties, dates, expiry) and an NDA's expiry proposed as the client's legal-tag expiry | nda, contract, licence, insurance, corporate-record, regulatory-filing | firm (contract itself) with client link |
| Billing and finance | proposals, purchase orders, invoices, timesheets, expenses, bank statements | Zoho Books sync or export (D11); WorkDrive `Finance/`; upload | proposal, invoice, purchase-order, timesheet, expense, bank-statement | firm, partners only |
| Research | scientific and geological papers, abstracts, reading lists, radar dossiers | miners (M11); upload of licensed PDFs | paper | firm-public or third-party licence |
| Public and regulator data | ANH, ANP, Argentina, Perupetro, SEC, EIA snapshots; OPEC secondary sources | miners (M11) | feed-snapshot | public |
| Reference data | price decks, fiscal terms, cost benchmarks, master data | committed in `vault/reference/`, `vault/master/` | reference-set | firm |
| Firm knowledge | lessons, method notes, skills, procedures, templates | lessons loop (M15), repo | Lesson, note | firm |
| Assistant output | drafts, delta notes, calc notes, transcripts of assistant sessions | M13, M08 | note, transcript | inherits scope |
| Firm assets | ATC letterhead (EN/ES), document and letter templates, signature blocks, logos, brand tokens, house style, reference-number scheme | committed in `vault/firm/assets/`, versioned | firm-asset | firm |
| Counterparties and contacts | every organisation the firm deals with (clients, prospective partners, operators, regulators, vendors, counsel) and their people, addresses, roles | master registry `organisations`/`contacts`, auto-proposed from correspondence, confirmed in the Hub | Organisation, Contact | firm |
| Dispatch register | what was sent or received, to whom, when, by which channel, under which reference, acknowledged when; outbound email creates it automatically, post and courier are entered in the Hub | M10 (sent mail), M13 (letters), Hub entry | Dispatch | inherits the item's tag |

Finance and legal records are visible to partners only by default (a
`partners-only` flag on the legal tag); associates see them when a partner
grants it per project.

## 3. Storage

Postgres (Supabase Pro): `people, organisations, contacts, projects, assets, legal_tags, firm_assets, dispatches, tools,
tool_versions, runs, items, item_versions, item_cites, run_inputs, lessons,
analogue_rows, chunks (vector(1024) + tsvector), filing_queue, review_queue,
jobs, audit_events`. Object storage: `originals/<sha256-prefix>/<sha256>` for
immutable bytes, `derived/<item-id>/text.md` for extracted text. Reference sets
(price decks, fiscal terms) and master data are also committed to the repo
under `vault/reference/` and `vault/master/` and loaded into Postgres on
deploy, so they are reviewable in pull requests.

## 4. Key flows

**F1 Save a run (any tool).** Tool calls `vault.saveRun(record)` from
`js/vault-client.js`. The client fills `job`, `tool_version`, `tool_commit`
from the registry, canonicalises and hashes inputs + params + assumptions,
POSTs to `/api/runs`. Offline or unauthenticated, the client queues in
localStorage and syncs later (ELAStore's dual-mode pattern, kept). The API
validates against the schema, resolves the legal tag, stores, and returns the
id. Identical `input_hash` on the same tool version returns the existing run.

**F2 Resolve the current version.** Every link in the Hub, and every inter-tool
import, goes through `vault.resolve('opportunity-register')` → the entry URL
and the pinned module URLs for `aliases.current`. Promoting a version is a PR
that edits `tool.json`; CI validates and the catalog rebuilds. The hand-bumped
`?v=` tokens are replaced by the resolved version.

**F3 Staleness, nightly.** For every Run with status ≠ superseded: stale if
`tool_version < aliases.current` and the newer version is not marked
non-breaking, or any `inputs[]` ref has a newer version or a different hash.
For every Item: stale if anything in `cites[]` is stale or superseded. Results
land in `stale_reasons` per record and a per-project stale set. The Hub offers
"re-run with current": the API replays `params` through the tool's headless
entry (tools expose `window.ATC_TOOL.run(params)` or, for external apps, a
`/rerun` endpoint), writes the new Run with `parents`, and an LLM writes the
delta explanation from the two records.

**F4 Capture correspondence.** Every five minutes, IMAP (Zoho Mail) and the
Gmail API are polled from a stored cursor. Each message becomes an Item with
attachments as child Items, deduplicated on Message-Id and content hash. A
classifier (sender domain, thread, subject tokens, per-project contact list,
then an LLM tie-break) assigns a project with a confidence; ≥ 0.85 files
directly, below that goes to the review queue in the Hub.

**F5 Draft with everything taken into account.** `POST /api/draft` with
`{kind: email|letter|report-section|calc-note, project_id, brief, thread_id?,
organisation_id?}`. For `letter`, the context always includes the
counterparty's Organisation and Contacts, every Dispatch to or from them with
dates and reference numbers, the contracts and NDAs in force with them, and the
firm's letterhead and letter template; the draft is rendered to DOCX and PDF on
letterhead with the next reference number reserved, and saved as an Item with a
pending Dispatch that is completed when the letter is sent. The
gateway fixes the scope (`project ∪ client-firm-wide ∪ firm ∪ public`),
decomposes the brief into up to six sub-queries, runs hybrid search + rerank,
assembles 5–7 cited sources, the run records they quote, the current lessons
in scope and the colleague who last worked the topic, and drafts with inline
citations (`[run:…]`, `[doc:…]`). Output is returned to the Hub, or written as
a Gmail/Zoho draft, never sent. Every retrieval is logged.

**F6 Lessons dream, weekly.** A Batch job reads the week's runs, filed
correspondence, assistant transcripts and re-run deltas, and proposes Lessons
(or updates, with `superseded_by`) into the review queue. A partner confirms
or rejects; confirmed lessons regenerate `vault/firm/LESSONS.md` (≤ 200
lines) which is injected into every drafting context and every Claude Code
session via a `SessionStart` hook, and served as an MCP resource.

## 5. Surfaces — BEFORE → AFTER

| Surface | BEFORE | AFTER |
|---|---|---|
| Staff entry | `admin.html` password page with four tool buttons and day-rate config | `/hub/` behind Cloudflare Access. **Today** page: catalog of every tool with current version and what's new, my projects, stale alerts, review queues (filing, lessons, re-run deltas), recent runs across the firm |
| Tool catalog | none; links hard-coded in `admin.html` and `tools.html` | Generated from `tool.json` files: name, owner, lifecycle, current version, changelog, "open current", runs count; deprecated tools redirect |
| Opportunity Register | shared mode dead on static hosting; per-browser data; `?v=2` pin | Register items are Vault records; each calculation saves a Run; provenance badge extended with tool version; stale badge when `potential.js` moves |
| Reservoir Simulator, ELA Studio, ELA Model Suite, Financial Model, Nodal, Plan Your Job | localStorage only; simulator holds an Anthropic key in the browser | Each Save writes a Run; each tool loads its `params` from any prior Run; AI explanations go through `/api/llm`; no keys in browsers |
| APEX Asset Intelligence, APEX 3D model | separate apps, no shared record | Appear in the catalog with versions; push Runs through the same HTTP contract |
| Project view | none | Timeline of runs, letters, emails, spreadsheets, papers; headline-number vintage table with deltas and reasons; stale set; lineage graph; basis notes |
| Search | none | Scope-aware Find across everything, in the Hub and inside each tool (Petrel "Find" pattern) |
| Drafting | manual; the radar skill for articles | Draft panel (email, report section, calc note) with citations; Gmail/Zoho draft output; MCP server for Claude Code and claude.ai |
| Research | `insight-radar` monthly, ledger in git | Weekly paper miner and monthly regulator feeds into the Vault; radar reads from the Vault; paper facts extracted into the analogue table |
| Lessons | none | Structured lessons, review queue, core index injected everywhere |
| Analogues | static defaults in `js/analogues.js` | Analogue table from every evaluation, paper and feed; find-similar; proposed defaults with provenance |

## 6. API surface (REST, JSON; all under Access)

```
GET  /api/me
GET  /api/catalog                      tools with versions and aliases
GET  /api/tools/:id/resolve            {entry, modules[], version, commit}
POST /api/runs                         RunRecord → {id, deduplicated}
GET  /api/runs/:id  GET /api/runs?project=&job=&status=
POST /api/runs/:id/rerun               → new run id + delta
GET  /api/items/:id  POST /api/items   multipart original + VaultItem metadata
GET  /api/items/:id/versions
GET  /api/projects/:id/timeline  /stale  /vintages  /lineage
GET  /api/search?q=&scope=project:<id>  (scope required; 400 without)
POST /api/draft                        {kind, project_id, brief, thread_id?, organisation_id?}
GET  /api/organisations?q=  /:id  /:id/file   (contacts, contracts in force, dispatches, projects, open items)
POST /api/organisations  POST /api/contacts
GET  /api/dispatches?organisation=&direction=  POST /api/dispatches  POST /api/dispatches/:id/acknowledge
GET  /api/firm-assets  GET /api/firm-assets/:kind/current
POST /api/render                       {item_id | draft, template, language} → DOCX + PDF on letterhead
POST /api/llm                          server-side proxy used by tools (scope-tagged, logged)
GET  /api/lessons?scope=   POST /api/lessons   POST /api/lessons/:id/confirm
GET  /api/queue/filing  POST /api/queue/filing/:id/assign
GET  /api/analogues/similar?asset=|row=
POST /api/ingest/upload  (also used by the WorkDrive sync job)
MCP  /mcp   tools: search_vault, get_run, get_lessons, get_tool_current, record_lesson, draft
            resources: vault://lessons/firm.md, vault://tools/<id>/CHANGELOG.md, vault://projects/<id>/summary.md
```

## 7. Security

- Cloudflare Access issues a signed JWT; `vault-api` verifies it on every
  request and maps the email to a Person. No other login exists.
- Scope is a required parameter of search, draft and MCP tools; the gateway
  builds the SQL predicate (`legal_tag` classification, `client_id`, expiry)
  inside the query. A test proves that a query scoped to client A never
  returns a client-B chunk, whatever the ranking says.
- Provider keys (Anthropic, Voyage, Zoho, Gmail) live only in Render
  environment variables. The simulator's browser key and the portal password
  are removed.
- Every retrieval and every write appends an AuditEvent. Partners can export
  a client's audit trail.
- OnePetro and other licensed PDFs are stored under a third-party tag with the
  subscription as `contract_id`; they are never served outside the firm scope
  and never republished.

## 8. Repo layout AFTER

```
vault/                     API service (Node 22, TypeScript, Hono)
  src/{api,gateway,jobs,ingest,llm,mcp}/
  reference/{price_decks,fiscal_terms}/   committed reference sets
  master/{basins,fields,wells}.json
  firm/LESSONS.md          generated core index (≤200 lines)
  test/                    unit + contract tests (node --test)
hub/                       static dashboard pages, style.css reused
  index.html today.js project.html tool.html search.html draft.html queue.html
js/vault-client.js         shared client for every browser tool
tools/<id>/tool.json       one manifest per tool (in-repo and external)
tools/<id>/CHANGELOG.md
docs/vault-hub/            this design pack
.claude/skills/            existing + drafting, lessons, run-capture skills
.claude/settings.json      SessionStart hook injecting vault/firm/LESSONS.md
render.yml                 static site + vault-api service + cron jobs
```

## 9. Acceptance criteria (numbered, testable) and the smoke plan

| # | Criterion | Smoke test that proves it |
|---|---|---|
| AC1 | Every tool listed in `/hub/` resolves to the version named by `aliases.current` in its `tool.json`; changing the alias in a PR changes every link after deploy with no other edit | `test/catalog.test.mjs`: build catalog from fixtures, assert resolve() matches; CI fails on a manifest that violates the schema |
| AC2 | Saving in the Opportunity Register and the Reservoir Simulator creates a Run that validates against `run-record.schema.json`, carries tool version + commit, and is visible to another partner within 5 s | Playwright: log in as A, save; log in as B, GET `/api/runs?project=`; schema-validate the record |
| AC3 | Two saves with identical inputs on the same version return the same run id | Unit test on `input_hash` canonicalisation + API dedup test |
| AC4 | A run made on version N is marked stale within one nightly job of `aliases.current` moving to N+1 (breaking), and every Item citing it is marked stale too | Job test with fixtures: 3 runs, 2 documents, promote version, assert stale set exactly |
| AC5 | "Re-run with current" produces a new Run with `parents=[old]`, and a delta note naming every changed headline output | Headless rerun test against the Register's `ATC_TOOL.run()`; assert outputs differ and note lists them |
| AC6 | A search scoped to project P returns no chunk whose legal tag is another client's NDA, in 10,000 randomised queries over a seeded corpus | Property test in `test/gateway.test.mjs`; also a test that a request without scope is a 400 |
| AC7 | An expired legal tag hides its records and their derivatives from search, timeline and draft within one job run | Fixture with expiry yesterday; assert absence |
| AC8 | An email sent to a project contact appears as an Item under that project within 10 minutes, once, with attachments as child Items | Integration test against a test mailbox; assert single Item per Message-Id after two polls |
| AC9 | `POST /api/draft` returns a draft whose every factual sentence carries at least one citation that resolves to a record in scope; a 40-question gold set scores faithfulness ≥ 0.85 and context precision ≥ 0.7 in RAGAS | `test/draft.test.mjs` citation resolver; `eval/ragas.yml` in CI on index changes |
| AC10 | The weekly lessons job proposes at least one lesson with evidence for a seeded week, and a confirmed lesson appears in `vault/firm/LESSONS.md` and in the next Claude Code session's context | Job test with fixture transcripts; hook test reading the injected context |
| AC11 | Every evaluation-type Run emits an AnalogueRow that validates; `similar` returns the seeded nearest field first | Unit test on extraction + similarity |
| AC12 | No provider key or password is present in any file served to the browser | CI grep over the static output for known key patterns; the simulator's key store removed |
| AC13 | Public site untouched: every public URL in `sitemap.xml` returns 200 with identical HTML before and after wave 1 | CI diff of the 19 public pages |
| AC14 | Monthly running cost of infrastructure ≤ USD 60 excluding LLM tokens; token spend visible per feature on the Hub | Cost page reads Render/Supabase invoices and the audit log's token counts |
| AC15 | A `letter` draft to a seeded prospective partner cites every document previously sent to or received from them with the correct dates and reference numbers, names the NDA in force, is rendered to DOCX and PDF on the current letterhead with a reserved reference number, and needs no input outside the API (R2) | `test/draft.letter.test.mjs` with a seeded organisation, 6 dispatches, 1 NDA; assert the "previous correspondence" list equals the fixture; assert the DOCX uses the letterhead asset id; a Playwright run from the Hub with the network restricted to the API origin |
| AC16 | Every outbound email from a firm mailbox produces a Dispatch within one poll; a letter marked sent by post produces one with the entered date | `mail.dispatch.test.mjs` on the sent-folder fixture; Playwright on the Hub dispatch form |

## 10. Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Cloudflare Access path rules on a Render static site | Render is already proxied through Cloudflare DNS; Access applications are path-scoped. Verify in M01 before anything else is built | Keep `admin.html` until AC1–AC2 pass; delete it only in wave 2 |
| Tools' `params` shapes drift and old runs cannot reload | Each tool versions its params schema; loaders migrate forward; `breaking: true` on the version stops comparison, not loading | Runs are immutable; nothing is lost, only comparability |
| Email classifier files mail into the wrong project | Threshold at 0.85 plus review queue; "already filed" set; re-file action moves the Item and records who did it | Items keep `origin`; re-filing is a metadata change |
| Cross-client leakage through retrieval | Scope inside the query, property test AC6, per-request audit log | Disable `/api/draft` and `/api/search` with one flag; Vault storage unaffected |
| External APEX apps cannot be modified quickly | D6 adapters are thin HTTP pushes; catalog entries work without them | Catalog-only mode |
| Supabase free-tier pausing or size limits | Pro plan from the start | Postgres dump nightly to storage; restore is a documented command |
| Cheap models build the wrong thing | Contract-first specs, fixtures and smoke tests before code; Tier A review of every merge; escalation rule | Revert the module's PR; contracts unchanged |
| Cost creep on LLM tokens | Prompt caching, Batch for jobs, per-feature token accounting on the Hub (AC14) | Feature flags per LLM feature |

## 11. Running cost (infrastructure, list prices Sep 2026)

| Item | USD / month |
|---|---|
| Render static site | 0 |
| Render web service (vault-api, starter) | 7 |
| Render cron jobs | ≈ 1–3 |
| Supabase Pro (Postgres, pgvector, storage, backups) | 25 |
| Cloudflare Access (≤ 50 users) | 0 |
| Voyage embeddings + rerank at our volume | < 5 |
| Anthropic tokens (drafting, extraction, weekly dream with Batch) | 20–80, visible per feature |
| Total | ≈ 60–120 |

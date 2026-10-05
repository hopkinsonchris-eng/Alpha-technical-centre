# Wave 7 — Step changes: what would make the Hub indispensable

Review note from the "next big thing" seat, 5 October 2026. Written against what is actually built on `main` (decision logs `08-decision-log.md` and `wave2/` to `wave6/06-decision-log.md`, `06-architecture.md`, the code under `vault/src/` and `hub/`), not against the design pack's ambitions. Every external claim cites the page read on 5 October 2026 (the numbered list at the end); where a page could not be reached from the server, that is said.

## 0. What is built, in one paragraph, and the gap this note is about

The Hub already does the *inward* half well: the globe and register, the project file with its toolbar, every tool's Save as an immutable Run, documents with durable originals and a viewer, mail captured per person and filed by a classifier that learns, WorkDrive and Books sync, a country brief and an intelligence card fed by World Monitor, fields from the gazetteers and the Global Energy Monitor tracker, budgeted research runs that file cited findings, Write to… with enforced citations, Send, lessons, analogue memory, and the Vault as a Claude connector. What it does not yet do is the *outward* half that a senior engineer still does by hand on the first morning of a new job: find the law, the round, the terms, the players, the regulator and the data room, and then keep watching them. The seven proposals below are ranked by impact per effort; the country opening pack (P1) is worked out in the most detail because it is the owner's own example and because four of the others reuse its plumbing.

### The AI-leverage checklist used on every candidate

(a) an LLM reasoning over the firm's own records; (b) pattern recognition the eye would miss; (c) optimisation of parameters set by habit; (d) first drafts a human then edits. A proposal that scores none of these is a feature, not a step change, and is in the "not this" list.

### Ranking

| # | Proposal | Monday-morning hours saved | Build | Run (per month, active firm) | AI leverage |
|---|---|---|---|---|---|
| P1 | The country opening pack | 6–10 per new country, then 1 a week keeping it current | L | £10–25 | a, d |
| P2 | Licence-round and regulator watch with a bid calendar | 1–2 a week across the portfolio, plus the deadline nobody missed | M | £3–8 | b, d |
| P3 | "Have we seen this before" on entry | 1–3 per new approach, plus the deal not re-screened | S/M | < £1 | a, b |
| P4 | Data-room inventory, gap list and first questions | a day per data room | M | £2–10 per data room | a, b, d |
| P5 | Fiscal terms that compute | half a day per country, every time | M | £1–3 | c, d |
| P6 | Before you meet | 20 minutes per external meeting | S | £2–5 | a, d |
| P7 | Monday portfolio review (rank, compare, what moved) | the Monday meeting's first half hour | M | £3–6 | a, b, c |

Build sizes: S is one pull request of a day or two, M is two or three pull requests over a week, L is a wave (three to four pull requests with a Gate 1 and Gate 2). Run costs assume the Vault's current prices in `vault/src/prices.ts` (Sonnet 5.5 at USD 2 per million input tokens and 10 per million output), prompt caching (cache reads at 0.1 of input [S35]), the Batch API at half price for anything scheduled [S35], web search at USD 10 per 1,000 searches [S34] and web fetch at token cost only [S33].

---

## P1 — The country opening pack

### The Monday-morning moment

Today: a partner creates "Namibia — PEL 0xx farm-in" in the Hub. The research run finds the field's wiki page and some news. The engineer then spends the morning in Safari on the iPad: the Petroleum Act, whether licensing is open or closed, the model PSA, royalty and tax, who operates what, which service companies are in Walvis Bay, who the regulator is and how you get into the data room. The answers end up in a Notes page and a few PDFs in WorkDrive, uncited, and go stale by the time the second meeting happens.

After: creating a project with a new country queues a `country-pack` job, exactly as it queues a research run today. Within the hour the project file has a "Country pack" card: ten sections, each a few cited sentences, each with a freshness dot and a "what changed" line, each chip opening the stored original (the Act, the model contract, the regulator's round page as fetched that day). The globe's country panel shows "Pack assembled 5 Oct · 9 of 10 sections · service industry: no public register". The pack is also a resource in the Claude connector, so the same engineer can ask the Claude app "what is the cost-recovery ceiling in the Guyana model PSA" and get the clause with the citation.

### The sections, the source per section, and what was checked

The pack is public scope (`lt-public`), built from public sources only. What the firm itself knows about the country is the existing country brief (scope-cached, `POST /api/countries/:code/brief`); the two sit side by side and the pack never reads client records, so it can never widen a scope.

| § | Section | Primary sources (verified 5 Oct 2026) | Access | Notes and doubts |
|---|---|---|---|---|
| 1 | Legal framework: the hydrocarbon law, the main regulations, the last amendment, ownership of resources | Chambers Global Practice Guides, *Oil & Gas 2026*, one Law and Practice chapter per jurisdiction, readable without login, dated and signed (Namibia: SNC Inc., updated 6 Aug 2026; headings "General Structure of Hydrocarbon Ownership and Regulation", "Private Investment in Hydrocarbons: Upstream", "Foreign Investment", "EHS") [S1]. Legal 500 Country Comparative Guides, *Energy: Oil & Gas*, 20 fixed questions per country, free (Guyana: Stanbrook Prudhoe, current to Jan 2026) [S3]. The law itself from the regulator's site (Guyana: Petroleum Activities Act No. 17 of 2023, PDF, petroleum.gov.gy) [S24]. EITI country page, "Extractive sector management" block (tax framework, licences and contracts, beneficial ownership) [S4]. | HTML and PDF, fetchable; no API | The 2025 Chambers index URL answered "no longer available" when fetched; editions roll over yearly, so the source registry must store the *series* and resolve the current edition at build time [S2]. Law-firm chapters are orientation, not advice; the pack says so on the card. |
| 2 | Licensing: how acreage is awarded (round, permanent offer, open door, direct negotiation), the current round, its stages and dates | The regulator's own round page, one adapter per country: ANP *Oferta Permanente* (OPC and OPP cycles, each with a published schedule; CNPE 17/2017 and 27/2021) [S15]; ANH *Proceso Permanente de Asignación de Áreas* (five stages; the schedule arrives as an addendum PDF) [S16]; Perupetro convocation processes (Lote 207: letters of interest to 27 Aug 2026, proposals 30 Sep 2026) [S17]; NUPRC 2025 round portal and guidelines PDF (five stages; pre-qualified firms notified 16 Mar 2026, bids closed 12 Jun 2026) [S18]; Staatsolie Open Door (launched 24 Nov 2025; a nomination opens a 90-day window for competing bids; PSC, JSA or TEA) [S19]; Namibia MME open licensing since 1999 (application in duplicate, inter-ministerial negotiating team) [S20]. Trade press as a second signal: energy-pedia offers free RSS feeds per region and per country ISO code [S37]. | HTML, PDF, RSS | This is the section that goes stale fastest and the one P2 keeps alive. The Namibia search summary reports a 1 March 2025 notice closing the application window "until further notice"; the pack must quote the notice from mme.gov.na itself before it says so [S20]. |
| 3 | Fiscal terms: royalty, cost recovery, profit split, income tax, bonuses, ring-fencing, stability | ResourceContracts.org: a repository of published oil, gas and mining contracts in 150+ countries, CC BY-SA 4.0, run by NRGI with CCSI and the World Bank [S6]; its GET-only API at `api.resourcecontracts.org` (`/contracts/search?country_code=…`, `/contract/{id}/text?page=`, `/contract/{id}/annotations`) [S7]. The model contract on the regulator's site (Guyana deepwater model PSA, Dec 2023: 10 % royalty, 65 % cost-recovery ceiling, 50/50 profit split, 10 % corporate tax; the Stabroek contract excepted) [S24]. Legal 500 Q9 "how the government derives value" and Chambers §2 [S3][S1]. PwC Worldwide Tax Summaries (free, 150+ territories, oil and gas special regimes) [S25]. EITI "tax framework" [S4]. | API (RC), PDF, HTML | EY's *Global oil and gas tax guide* was last found as a 2018 PDF; too old to cite as current [S25]. Terms are simplified for screening and the pack says which contract they came from (regime versus a specific contract). P5 turns this section into a reference set the tools load. |
| 4 | Who works there: operators, licence holders, partners, the national oil company | Global Energy Monitor's Global Oil and Gas Extraction Tracker (March 2026 release, 6,481 active extraction areas in 95 countries, with ownership and operator) [S8], CC BY 4.0 [S9], already imported (`vault/master/gem-fields.json`). EITI "top paying companies" and company lists on the country page [S4]. ResourceContracts `company_name` on the country's contracts [S7]. World Monitor company enrichment, signals and SEC full-text search, already adapted in `vault/src/research/` [S29]. Companies House for UK-registered vehicles (free, including commercial use; 600 requests per five minutes) [S26]. Plus the Vault's own `organisations` of that country and "who last spoke". | XLS, API, HTML | OpenCorporates is not free for commercial use (Essentials £2,250 a year for 500 calls a month; free only for open-data projects under ODbL share-alike) [S27]: not used. |
| 5 | The service industry: who can drill, log, test and build there; local-content rules | Public local-content registers where they exist: Guyana's Local Content Register (over 350 certificates issued; a public site) [S23]; Angola's ANPG supplier registration and published lists of goods and services under local-content rules [S23]; Mozambique's Local Content Law 9/2026 obliges the new authority to publish certified suppliers on a portal [S23]; Namibia's policy was approved by Cabinet on 4 Aug 2026 but is not gazetted [S23]. Otherwise the Vault's own vendor organisations in the country, and an honest "no public register". | HTML (uneven) | The weakest section and the one to be most sceptical about: there is no free, structured, global source for service-company presence. The pack must say "no public register; the firm's contacts here are …" rather than guess from company marketing pages. Never from LinkedIn (terms of use). |
| 6 | The regulator and the data room: who regulates, who holds the data, how you get in, what it costs | UK NDR (terabytes of seismic and well data; licensees report to it under the data regulations; API resources in OGC WMS, GeoService and GeoJSON; an NDR API through Microsoft Graph for project and file metadata) [S21]. Australia NOPIMS (rebuilt 2024; OData links and web services) [S22]. Brazil: BDEP through ANP (named on the Permanent Offer pages) [S15]. Suriname: Staatsolie GeoPortal, datasets leased at discounted rates, a free GeoAtlas [S19]. Nigeria: data lease opened to pre-qualified applicants [S18]. Regulator identity from the legal guides [S1][S3]. | HTML, some APIs | Costs are rarely published; the pack says "not published; ask". |
| 7 | Production, reserves and the market: country totals and trend | EIA International (API v2, free key, data in the public domain with a dated attribution; throttled per second and hour) [S10]. JODI-Oil monthly CSV for all countries from 2002, updated around the 20th, no public API [S12]. Energy Institute Statistical Review Excel (free, attribution required; extensive reproduction of tables needs permission) [S13]. OPEC Annual Statistical Bulletin for the twelve member countries (PDF and interactive) [S14]. World Monitor's energy profile (JODI) already in the intel card. | API, CSV, XLS | IEA: reports and standalone figures are CC BY 4.0 but "standalone datasets, data explorers and databases are not made available under a CC BY 4.0 licence" [S11]; the terms page answered 403 to the server. The pack cites IEA text, never scrapes IEA data. |
| 8 | Risk and context | The existing World Monitor sections (`GET /api/countries/:code/intel`): instability index, sanctions, advisories, events, headlines | already built | The pack links the card; it does not duplicate it. |
| 9 | Technical literature on the basins | The existing miners (OpenAlex: 100,000 credits a day, key required, CC0 [S31]; Crossref; Semantic Scholar with the free key the setup guide already asks for [S30]) with the country's basin names from `vault/master/basins.json` as topics | already built | OnePetro stays metadata-only: its licence prohibits crawlers, scripts and systematic retrieval [S32]. |
| 10 | What no source answered, and who to ask | derived | — | The pack ends with its gaps, like a draft ends with its questions. |

### How a pack is built

1. **A source registry, in the repo.** `vault/master/country-sources.json`: per country, per section, the URLs or adapters to use, the TTL, and the domain allow-list. Reviewed in pull requests like the reference sets. A country with no entry gets the generic sources (Chambers, Legal 500, EITI, ResourceContracts, GEM, EIA, JODI) and a note saying its regulator is not yet registered.
2. **Fetch and file, before any model call.** Each source is fetched by the server (the miners' `Http` with its rate limit, or the Anthropic web fetch tool for pages that need the model to read a PDF). The bytes are stored as an immutable original under project `firm`, type `feed-snapshot` or `regulatory-filing`, with `origin {source, external_id: url, fetched_at}` and the sha256 in `extracted.manifest`, exactly as the miners do today; an unchanged payload writes nothing, a changed one becomes a new version (`vault/src/miners/run.ts`). The text is extracted and chunked by the existing ingest, so Find reaches the law itself.
3. **Draft each section from the stored originals only.** The section prompt gets the extracted text of its originals (prompt-cached) and must write short sentences each ending in `[doc:<item id>]`; `checkCitations` in `vault/src/llm/draft.ts` runs unchanged, so a figure without a citation becomes a question, not a fact. Where the model fetches a PDF itself (web fetch with `citations: {enabled: true}`, which returns `cited_text` with character offsets [S33]), the citation is mapped back to the stored snapshot; the pack never cites a bare URL. The model never supplies a fact from memory: a section whose sources were all unreachable says "no source reached" (the research runs' rule).
4. **Cache and refresh.** A `country_packs` table (migration 008): `country, section, version, body jsonb {sentences[], citations[], changed_since[]}, source_items[], built_at, model, spend_gbp, status`. Each section carries a TTL from the registry: law 180 days, licensing 7 days (P2 feeds it), fiscal 90 days, companies the GEM release plus 30 days, service 180 days, regulator and data room 180 days, production monthly on JODI's cycle, risk hourly through the existing adapter. The nightly staleness job marks a section stale when its TTL has passed or a source's sha256 changed; the weekly `country-pack` cron rebuilds stale sections of countries with active projects, under a budget (`PACK_BUDGET_GBP`, default 2 per build), and writes a "what changed" line from the old and new text (the re-run delta pattern). "Assemble the pack" on the card forces a rebuild.
5. **Freshness is visible.** Every sentence's chip shows the source and the date it was fetched; every section shows "as of" and a dot (fresh, due, stale, unreachable); the globe panel shows the pack's worst section.

### Where it appears

- **Project page**: a "Country pack" card between the opportunity card and Fields, ten rows with a headline sentence and a dot; tap opens the bottom sheet (the wave 2 record-sheet pattern) with the section, its chips, "what changed", and "Open the original". Bilingual (`data-en`/`data-es`), the Spanish drafted in the same call.
- **Globe, country panel**: "Pack: assembled 5 Oct · 9 of 10 · 1 stale" and the button; "Create a project here" queues the pack with the research run.
- **Today**: one line when a pack lands or a section changes ("Brazil: Permanent Offer schedule changed; bids 7 Oct 2026"), joining What came in.
- **Connector**: `vault://countries/<cc>/pack.md` as an MCP resource, and `get_project_context` gains the pack's headlines; the Claude app then answers from the pack with its citations.
- **Write to…**: the pack's originals are sources the drafter may cite, so a letter can quote the Act with a chip.

### Fit with the stack

Hono routes `POST /api/countries/:code/pack` (queue), `GET /api/countries/:code/pack` (public scope, audited), `GET …/pack/:section`; a `country-pack` job in the `jobs` table run by the API's one-at-a-time runner and picked up by a cron like `atc-vault-research`; the miners' `Http`, manifests and versioning; the ingest pipeline for text and chunks; the Anthropic provider's `complete` for drafting and `search`/fetch for PDFs behind `allowed_domains` from the registry; pgvector untouched except for the new chunks. Hub: one new card module in `hub/project.js`, one panel block in `hub/globe.js`, one Today line in `hub/hub.js`. Build: L, three pull requests (registry, fetchers and snapshots; the job, table and routes; the Hub, Today and the MCP resource). Run: a first build is roughly 25 fetches (a 10 kB page is about 2,500 tokens, a 500 kB PDF about 125,000 [S33]) and ten drafting calls; with caching, about £1–2 per country, a refresh of stale sections about £0.30; storage a few megabytes of PDFs per country.

### Risks and guards

- *Stale or wrong*: every sentence cited to a dated snapshot; TTLs and dots; a changed source re-drafts and shows the diff; legal and fiscal sections carry "orientation for screening; verify against the instrument in force". Deadlines in §2 are shown with the page and the date it was read.
- *Confidentiality*: the pack is public scope, built from public sources, never given a client record as context; the search and fetch prompts carry only the country and the section's public source list (the Anthropic documentation warns that web fetch alongside sensitive data is an exfiltration risk and recommends `allowed_domains` and `max_uses` [S33]; both are set from the registry).
- *Licences*: ResourceContracts is CC BY-SA (attribution kept on the chip and in the stored item) [S6]; GEM CC BY 4.0 [S9]; EIA public domain with the dated attribution [S10]; EI Statistical Review quoted with attribution, tables stored as originals rather than reproduced [S13]; IEA datasets not fetched [S11]; OnePetro excluded by code [S32].
- *Cost*: a per-build and per-month budget, spend on the cost page by feature as today; a country with no active project is never refreshed.
- *The service-industry section will disappoint*: say so on the card rather than fill it with marketing copy.

---

## P2 — Licence-round and regulator watch, with a bid calendar

**Monday moment.** Today the engineer re-reads six regulator sites and two newsletters each week to know whether a round opened, a stage moved or a deadline shifted, and the one deadline that mattered was in a PDF addendum. After: Today shows "Deadlines in the next 90 days" for the countries of interest, each with the stage, the date, the source page and the day it was read, confirmed by a person; the globe draws a ring on countries with an open round; a change on a watched page lands as a What came in line.

**Sources (same registry as P1 §2).** ANP cycle schedules [S15], ANH addenda [S16], Perupetro convocations [S17], NUPRC portal and guidelines [S18], Staatsolie Open Door announcements [S19], Namibia MME [S20], energy-pedia RSS per country [S37], World Monitor GDELT documents already adapted. No single API exists; a per-regulator adapter under the M11 `FeedAdapter` contract (weekly, sha256 change detection) is the honest shape.

**AI leverage.** (b) a page's diff is read once by the model at low effort to extract dated stages with a verbatim quote (the wave 4 research-proposal pattern); (d) the Today line. Nothing is a calendar entry until a member confirms the proposal in the queue (kind `round`).

**Fit and cost.** New table `round_events (country, round, stage, date, source_item, quote, status)`; review-queue kind `round`; a Today card; a globe flag; P1 §2 reads from it. Build M. Run: fetches are free, one low-effort read per changed page, under £5 a month.

**Risk and guard.** Wrong dates from extraction: verbatim quote, confirm before it counts, source and read-date on every row. Invented rounds: only from fetched pages. Sites that change shape or block: the adapter reports "unreachable since", never silence.

---

## P3 — "Have we seen this before", on entry

**Monday moment.** A new approach arrives about Block 12, Company Y and a field. Nobody recalls that the firm screened the same block for another client two years ago and dropped it, that Ana last spoke to Company Y in March, and that a lesson records why the production figure was wrong. After: Add opportunity, the organisation proposal in the queue and the filed email all show a "Seen before" panel: the prior evaluation (named only to those whose scope includes it), the correspondence with who last spoke, the lesson, the analogue rows for the field, and a one-paragraph cited "what we concluded last time".

**Sources.** The Vault only: `assets` and the gazetteers (wave 3) for field identity, `organisations` and the relationship memory (wave 6), `analogues/similar.ts`, the hybrid search gateway with the caller's scope, lessons.

**AI leverage.** (b) fuzzy and gazetteer matching plus an embedding of the register text against prior registers; (a) the cited paragraph from the records found.

**Fit and cost.** `GET /api/opportunities/related?name=&country=&orgs=&field=` through `isVisible`; a panel in the Add opportunity form, the opportunity card and the queue; an MCP tool. Build S/M. Run negligible.

**Risk and guard.** Leakage of a client-scoped evaluation's existence: the route returns nothing outside scope (AC6's property test extends to it). False matches on common names: country-constrained, reasons shown ("same field id", "same domain"), never auto-linked.

---

## P4 — Data-room inventory, gap list and first questions

**Monday moment.** A counterparty opens a data room or sends a zip; an engineer spends a day listing what is there and what is missing before anyone screens anything. After: the WorkDrive folder is mapped to the project (the existing sync), each document is classed against a screening checklist (`vault/reference/checklists/screening-data-room.json`: licence or PSC, competent person's report, production history by well, well files, logs, seismic, facilities, costs, HSE, legal), and the project file shows coverage bars, a gap list, figures that disagree between two documents, and a cited first set of questions pre-loaded into Write to….

**Sources.** The project's own documents (client-NDA scope); nothing external.

**AI leverage.** (a) and (b): one low-effort read per document for class and the headline figures with evidence quotes (the entity pass in `vault/src/ingest/entities.ts` already does the verbatim-quote discipline); (d) the questions.

**Fit and cost.** A `class` proposal on `items.extracted`, `GET /api/projects/:id/data-room`, a "Data room" card, a Write to… brief kind. Build M. Run about £0.01 per document; a 500-file room about £5.

**Risk and guard.** Everything stays under the project's legal tag; classes are proposals with confidence, re-filable; a disagreement between documents is shown as two quotes, never resolved by the model.

---

## P5 — Fiscal terms that compute

**Monday moment.** The engineer reads the model PSA and keys royalty, cost-recovery ceiling and profit split into the financial model from memory or an old spreadsheet; the run records no source for them. After: P1 §3 proposes a `ref:fiscal_terms/<cc>/<regime>` JSON with an evidence quote per parameter from the contract text (ResourceContracts' per-page text API [S7] or the regulator's model contract PDF [S24]); a partner confirms; a pull request commits it to `vault/reference/fiscal_terms/` (already the design: committed, loaded on deploy); the financial model, which declares `consumes: ["fiscal_terms"]` in `tools/financial-model/tool.json`, and the ELA bridge (`FISCAL_TERMS_REF` in `js/ela-model-suite-bridge.js`) load it by reference; runs cite it; the existing staleness engine flags runs when the reference changes.

**AI leverage.** (d) extraction with evidence; (c) a headless sensitivity of NPV10 to each fiscal parameter, so the "habit" value a run carries is compared with the contract's.

**Fit and cost.** A schema for the fiscal JSON (today `vault/reference/fiscal_terms/README.md` names only "source" and "as_of"), a review-queue kind `fiscal`, a project-toolbar context so the financial model opens with `?ref=`; the model's custom fiscal editing is currently behind its own "full access" password (`financial-modelling.html`), which must become the toolbar context. Build M, mostly on the tool side.

**Risk and guard.** A regime file used as if it were the contract in force: the file names its applicability and the exceptions (Guyana's Stabroek contract keeps its old terms [S24]) and says "simplified for screening"; every parameter carries its quote and `as_of`.

---

## P6 — Before you meet

**Monday moment.** A call with a counterparty at 10:00; the partner scrolls mail on the iPad for twenty minutes for the last thread, the NDA's expiry and the figures already sent. After: Today shows "Today's meetings" from the person's Zoho Calendar, matched to counterparties by attendee domain, each with a one-page cited brief: the last three exchanges and who last spoke, documents sent with reference numbers, NDAs in force and expiry, open questions from the last draft, the latest run's headline outputs, lessons, the live risk line; and a Write to… follow-up ready afterwards.

**Sources.** Zoho Calendar API `GET /api/v1/calendars/<uid>/events` with scope `ZohoCalendar.event.READ`, a `range` of at most 31 days, attendees with their status, description under a `large` accept header [S36]; the Vault's dispatch register, mailbox capture and the letter-context assembly that already builds "previous correspondence" (F5, AC15).

**AI leverage.** (a) and (d). **Fit and cost.** One more scope at the existing Zoho consent (wave 6), a calendar poll beside the mail poll, a Today card, the draft context reused. Build S. Run a few pence per meeting.

**Risk and guard.** Calendar privacy: only events with an external attendee matching a known counterparty are read into a brief; titles and attendees of other events are never stored; the Protected and Blocked rules apply. A wrong match shows the attendees it matched on.

---

## P7 — Monday portfolio review: rank, compare, what moved

**Monday moment.** Partners meet to decide which two opportunities to push; someone builds a slide from memory. After: a ranked table of active opportunities from the latest run outputs (NPV10, IRR, breakeven, risk score, stage age), the attention flags, and "what moved since last Monday and why" with citations: new runs and re-run deltas, research findings, mail, round deadlines from P2; two projects side by side; inputs that sit outside the analogue P10–P90 flagged as "set by habit".

**Sources.** The Vault only: runs, scorecards (M17), staleness (M08), analogue defaults (M16), the activity brief (wave 6), P2's calendar.

**AI leverage.** (a) the cited "why"; (b) the stale assumption shared by several projects; (c) the habit flag. **Fit and cost.** `GET /api/projects/rank` (follow-up F10, deferred since wave 2), a compare view, a Today card. Build M. Run under £6 a month.

**Risk and guard.** Rank is only as good as its inputs: each cell shows its run, version and vintage; an associate sees only their projects; nothing decides, it orders.

---

## Recommendation: build P1 and P2 first

Build the country opening pack and the licence-round watch together, as one wave. The pack is the owner's own definition of indispensable and it is the piece the current Hub visibly lacks: every other proposal here either reuses its plumbing (the source registry, server-side fetch with snapshots, section drafting with enforced citations, the TTL refresh) or reads from it (P5 is its fiscal section made computable, P7 reads its deadlines). The watch is what keeps the pack honest: without it the licensing section is a photograph that ages in a week, and a stale deadline is worse than none. P3 ("seen before") is the cheapest real win and should go in the same wave if there is a spare pull request, because it needs no external source and its leakage test already exists. P4 to P7 follow once the pack has run on five real countries and shown which sections the team actually opens.

## Not this

- **A chat box in the Hub ("Ask the Vault").** The Claude connector already gives the Claude app the whole Vault under the person's own scope (wave 5); a second chat surface splits attention and duplicates the scope work. Wave 5 Option B was not chosen for the same reason.
- **Rystad, Wood Mackenzie or S&P data by scraping or shared logins.** Lens Direct needs an "additional subscription" [S39] and UCube is sold through the client portal; the only lawful path is a paid API licence, which the firm does not hold. Nothing here depends on them.
- **Model-written country summaries from memory.** Rejected in wave 4 (Option D) and still wrong: no fact without a record.
- **Service-company mapping from LinkedIn or company marketing pages.** Terms of use on the first, unverifiable claims on the second; use public registers where they exist [S23] and the firm's own contacts.
- **OnePetro full-text mining.** Prohibited by its terms and licence (no crawlers, scripts or systematic retrieval) [S32]; the metadata-only rule stays.
- **OpenCorporates as a company source.** Paid for commercial use [S27]; GEM, EITI, SEC, World Monitor and Companies House cover what the pack needs.
- **IEA database scraping.** Standalone datasets are outside the CC BY 4.0 terms [S11]; cite IEA text, fetch EIA and JODI.
- **Automatic calendar entries or automatic sends.** A deadline or a letter becomes real only when a person confirms it (the wave 6 Send confirm sheet is the pattern).
- **Model translations of laws as the authoritative text.** Store the original; translate for orientation with the original cited.
- **A native iPad app.** The Hub pages already work on the iPad (wave 5 fixed the PDF viewer for Safari); the effort belongs in the pack.
- **Voice capture of field notes.** Apple dictation into a filed note already works; not a step change.

---

## Sources read on 5 October 2026

- [S1] Chambers Global Practice Guides, Oil & Gas 2026, Namibia (Law and Practice), SNC Inc., updated 6 Aug 2026, readable without login: https://practiceguides.chambers.com/practice-guides/oil-gas-2026/namibia
- [S2] The 2025 edition index answered "The practice guide you are looking for is no longer available" when fetched: https://practiceguides.chambers.com/practice-guides/oil-gas-and-the-transition-to-renewables-2025
- [S3] Legal 500 Country Comparative Guides, Guyana: Energy – Oil & Gas (20 questions; Stanbrook Prudhoe; current to Jan 2026; free): https://www.legal500.com/guides/chapter/guyana-energy-oil-gas/
- [S4] EITI, Colombia country page (sections "Extractive sector data", "Extractive sector management"; country data download as CSV; 2022 EITI Report dated 29 Jul 2025): https://eiti.org/countries/colombia
- [S5] EITI open data and summary-data API (`https://eiti.org/api/v1.0/summary_data`; summary data as Excel, bulk or API): https://eiti.org/open-data and https://eiti.org/how-we-collect-and-publish-eiti-summary-data (the `/api-docs` path answered 404 and `/api` returned only the site shell)
- [S6] ResourceContracts.org, About (150+ countries; CC BY-SA 4.0; NRGI with CCSI and the World Bank): https://www.resourcecontracts.org/about
- [S7] ResourceContracts API wiki (base `https://api.resourcecontracts.org/`; `/contracts/search` with `country_code`, `year`, `resource`, `company_name`, `contract_type`; `/contract/{id}/text?page=`; `/contract/{id}/annotations`; GET-only, published contracts): https://github.com/NRGI/resourcecontracts.org/wiki/API
- [S8] Global Energy Monitor, Global Oil and Gas Extraction Tracker (March 2026 release; 6,481 active areas in 95 countries; .xls download): https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/
- [S9] Global Energy Monitor download page: "All Global Energy Monitor tracker data are freely available under a Creative Commons Attribution 4.0 International Public License unless otherwise noted": https://globalenergymonitor.org/projects/global-energy-ownership-tracker/download-data/
- [S10] EIA API technical documentation (free key; throttles per second and per hour): https://www.eia.gov/opendata/documentation.php ; EIA copyright and reuse ("U.S. government publications are in the public domain"; attribution "Source: U.S. Energy Information Administration (Oct 2008)"): https://www.eia.gov/about/copyrights_reuse.php ; international crude production and reserves by country in API v2: https://www.eia.gov/opendata/
- [S11] IEA terms (page answered 403 to the server; the search summary quotes: text and reports CC BY 4.0, while "standalone datasets, data explorers and databases are not made available under a CC BY 4.0 license"): https://www.iea.org/terms
- [S12] JODI-Oil World Database downloads (free; complete series from Jan 2002 as CSV; updated around the 20th of each month; no public API, ICE resells a feed): https://www.jodidata.org/oil/database/data-downloads.aspx
- [S13] Energy Institute Statistical Review, data downloads (Excel free; quote with attribution; extensive reproduction of tables needs permission); the terms page answered 403: https://www.energyinst.org/statistical-review/resources-and-data-downloads
- [S14] OPEC Annual Statistical Bulletin (PDF and interactive; twelve member countries): https://www.opec.org/annual-statistical-bulletin.html
- [S15] ANP, Oferta Permanente (OPC and OPP; CNPE 17/2017 and 27/2021; schedules per cycle): https://www.gov.br/anp/pt-br/rodadas-anp/oferta-permanente ; OPC6 and OPP4 set for 7 Oct 2026, expressions of interest by 31 Aug 2026: https://cenarioenergia.com.br/2026/08/07/anp-oferta-permanente-leilao-outubro-2026-concessao-partilha/ ; PPSA, Brazil upstream opportunities in 2026: https://www.presalpetroleo.gov.br/brazil-upstream-opportunities-in-2026/
- [S16] ANH, Proceso Permanente de Asignación de Áreas (five stages; schedule by addendum): https://www.anh.gov.co/es/hidrocarburos/oportunidades-disponibles/ppaa-proceso-permanente-de-asignaci%C3%B3n-de-%C3%A1reas/ and https://www.anh.gov.co/documents/3074/Adenda-No.-14.-Cronograma-PPAA.pdf
- [S17] Perupetro, Lote 207 convocation (letters of interest to 27 Aug 2026; proposals 30 Sep 2026): https://energiminas.com/2026/07/16/lote-207-perupetro-inicia-proceso-de-convocatoria-para-seleccionar-nuevo-operador/ ; the upstreamopportunities.pe portal answered 503 to the server
- [S18] NUPRC, Nigeria 2025 Licensing Round portal and guidelines: https://br2025.nuprc.gov.ng/faq/ and https://br2025.nuprc.gov.ng/media/1wzl2i4m/nigeria-2025-licensing-round-guidelines.pdf ; pre-qualified applicants notified 16 Mar 2026, bids closed 12 Jun 2026, data lease after pre-qualification: https://www.thisdaylive.com/2026/03/18/2025-oil-licensing-round-nuprc-shortlists-pre-qualified-firms-for-50-oil-blocks/
- [S19] Staatsolie Open Door (launched 24 Nov 2025; 90-day window after a nomination; PSC, JSA or TEA; GeoPortal with datasets leased at discounted rates; free GeoAtlas): https://www.riotimesonline.com/suriname-staatsolie-open-door-first-bid-offshore-licensing-2026/ and https://www.offshore-mag.com/geosciences/news/55386893/staatsolie-first-offer-made-for-offshore-suriname-open-acreage
- [S20] Namibia Ministry of Industries, Mines and Energy, Petroleum Upstream (open licensing since 1999; applications in duplicate; inter-ministerial negotiating team; the search summary reports a 1 Mar 2025 notice closing the window, to be verified on the page): https://www.mme.gov.na/petroleum/upstream/
- [S21] NSTA, UK National Data Repository: https://www.nstauthority.co.uk/data-and-insights/data/uk-national-data-repository/ ; NSTA data FAQs (API resources in OGC WMS, GeoService, GeoJSON): https://www.nstauthority.co.uk/data-and-insights/about-nsta-data/faqs/ ; UKCS data portals (NDR API via Microsoft Graph): https://www.nstauthority.co.uk/data-and-insights/ukcs-data-portals/
- [S22] NOPTA, NOPIMS release (OData links and web services): https://www.nopta.gov.au/media/news/2024/20241011-nopims-release.html and https://www.ga.gov.au/nopims
- [S23] Guyana Local Content Register: https://lcregister.petroleum.gov.gy/ and https://dpi.gov.gy/over-350-local-content-certificates-issued-by-secretariat-to-date/ ; Angola ANPG supplier registration: https://chambers.com/articles/angola-online-registration-form-for-suppliers-of-the-oil-sector and https://www.pwc.com/ao/en/services/tax/corporate-regulatory-services/regulatory-flashes/angola-national-agency-of-petroleum.html ; Mozambique Local Content Law 9/2026: https://lexafrica.com/2026/07/local-content-law-in-mozambique/ ; Namibia policy approved 4 Aug 2026, not gazetted: https://www.riotimesonline.com/namibia-local-content-policy-oil-gazette-2026/
- [S24] Guyana Petroleum Activities Act No. 17 of 2023: https://petroleum.gov.gy/documents/petroleum-activities-act-no-17-2023 ; model deepwater PSA (Dec 2023): https://petroleum.gov.gy/wp-content/uploads/2024/10/Guyana-Deepwater-PSA_-30-12-2023_Public-update.pdf ; the 10 % royalty, 65 % cost-recovery ceiling, 50/50 split and 10 % corporate tax, Stabroek excepted: https://oilnow.gy/featured/four-out-of-six-bidders-accept-new-guyana-psa-terms-ministry/
- [S25] PwC Worldwide Tax Summaries (free; 150+ territories; oil and gas special regimes): https://taxsummaries.pwc.com/ ; EY Global oil and gas tax guide, latest edition found 2018: https://www.ey.com/content/dam/ey-unified-site/ey-com/en-gl/technical/tax/documents/ey-oil-and-gas-tax-guide-2018.pdf
- [S26] Companies House API (free, including commercial use; 600 requests per five minutes): https://www.api.gov.uk/ch/companies-house/ and https://leadistry.co.uk/blog/companies-house-api-guide
- [S27] OpenCorporates pricing (Essentials £2,250 a year, 500 calls a month; free only for open-data projects under ODbL share-alike): https://opencorporates.com/pricing/
- [S28] SEC EDGAR full-text search (`efts.sec.gov/LATEST/search-index`; 10 requests a second; User-Agent with contact; 10,000-result cap): https://tldrfiling.com/blog/sec-edgar-full-text-search-api
- [S29] World Monitor API, company enrichment, company signals and SEC full-text search; OpenAPI at `https://www.worldmonitor.app/openapi.json`: https://www.worldmonitor.app/docs/api-reference/intelligenceservice/getcompanyenrichment
- [S30] Semantic Scholar API (shared unauthenticated pool; a free key gives 1 request a second under an API licence agreement): https://libguides.ucalgary.ca/c.php?g=732144&p=5260798
- [S31] OpenAlex API (100,000 credits a day; key now required; CC0): https://github.com/ourresearch/openalex-docs/blob/main/how-to-use-the-api/rate-limits-and-authentication.md and https://help.openalex.org/api/authentication/
- [S32] OnePetro Terms and License Agreement (no crawlers, spiders, bots or scripts; no systematic retrieval): https://onepetro.org/pages/terms and https://onepetro.org/pages/license
- [S33] Anthropic, Web fetch tool (no charge beyond tokens; `citations: {enabled: true}` returns `cited_text` with character offsets; `allowed_domains`, `max_uses`, `max_content_tokens`; only URLs already in the conversation can be fetched; no JavaScript-rendered pages; PDFs supported; exfiltration warning; 10 kB page about 2,500 tokens, 500 kB PDF about 125,000): https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool
- [S34] Anthropic, Web search tool (USD 10 per 1,000 searches; citations always on; `allowed_domains`; `user_location`; usable in batches): https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- [S35] Anthropic, Message Batches API (50 % discount, processed within 24 hours): https://claude.com/blog/message-batches-api ; prompt caching (cache reads 0.1 of input, five-minute writes 1.25): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- [S36] Zoho Calendar API, Get events list (`/api/v1/calendars/<uid>/events`; scope `ZohoCalendar.event.READ`; `range` at most 31 days; attendees with status; description with the large accept header): https://www.zoho.com/calendar/help/api/get-events-list.html
- [S37] energy-pedia news feeds (free RSS per region and per country ISO code): https://www.energy-pedia.com/newsfeeds.aspx
- [S38] Wikidata Query Service limits (60 seconds of query time a minute per client; 60-second deadline): https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual
- [S39] Wood Mackenzie Lens Direct ("additional subscription required"): https://www.woodmac.com/lens/direct/ ; Rystad Energy client portal: https://www.rystadenergy.com/client-portal
- [S40] NRGI ResourceProjects (project-level payments; data to 2020, collection paused in 2021; of limited use for a current pack): https://resourceprojects.org/about

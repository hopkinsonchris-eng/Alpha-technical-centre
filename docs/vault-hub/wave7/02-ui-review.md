# Wave 7 — UI review of the Hub

Reviewer: UI (one of four). Date: 5 October 2026. Scope: every surface of `hub/` as built through wave 6, judged for a firm of senior petroleum engineers who use it on iPad and desktop and want the state of a project in one glance and the next action one tap away.

## 0. How this was done

- The Vault was run locally from `vault/src` (PGlite, filesystem storage, `DEV_USER_EMAIL`) behind a small Node proxy on port 8021 that served the repo root and forwarded `/api`, `/mcp`, `/oauth`, `/.well-known`. A colleague's instance on 8787/8020 was left alone.
- Seeded through the public API and the test harness: six opportunities in four countries (CO, PE, VE, KZ) with register fields and stages; seven runs across three tools (two chained, one superseded, statuses draft/reviewed/final); six uploaded documents (letter, CSV, two PDFs, report, contract); two lessons (one confirmed, one proposed); seven captured emails (five filed, one needing a decision, one bulk-hidden, one sent); one dispatch.
- Screenshots with Playwright Chromium at 1440×900, iPad landscape 1024×768, iPad portrait 820×1180 and phone 390×844, in EN and ES, plus the record panel, command palette, globe tap, Write to…, tabs, loading, Vault-down, 404 and empty states. Files are in `docs/vault-hub/wave7/evidence/ui-*.png` (71 files). A DOM audit per page counted tap targets under 36 px and 24 px, text under 12 px, nodes without `data-en`, and horizontal overflow.
- Dark mode: neither `style.css` nor `hub/hub.css` has a `prefers-color-scheme` rule, so there is one emulated shot (`ui-today-darkmode-emulated-desk.png`) proving the page renders identically.
- Not exercised: LLM-backed flows (Research findings, draft generation, country brief, activity brief) and the Zoho mailbox connect (no provider keys in the sandbox). The Google Fonts `@import` was blocked by the sandbox TLS proxy on the first pass; the final shots were taken with certificate checks relaxed so Playfair, Barlow and Barlow Condensed render.

Severity: **Critical** (blocks the stated job for a new user), **High** (costs every user time on every visit), **Medium** (noticeable, fixable in isolation), **Low** (polish).

---

## 1. Verdict

The Hub is honest, consistent in colour and accessible in the basics (AA contrast on every token measured, gold focus ring, skip link, `aria-current`, reduced-motion, full EN/ES coverage of static strings), and three screens are already good: the queue, the search results, and the tool page. But it does not yet do the one thing the brief asks for. Nowhere does a page state, in one line, what stage a project is at, what happens next and when something last happened: on the project file that information is spread over a meta line, a five-tile KPI strip and the bottom of an "Opportunity" card ~1,000 px down, below a two-row launcher of nine tool chips; the file itself (the timeline) starts at ~1,700 px on desktop and ~2,900 px on a phone. Today is a 4,274 px scroll on desktop (8,464 px on a phone) whose first screen is the globe and a four-row country list with nothing to act on, while "What came in" sits at the fourth screen. The sidebar is not a stable map (Queues, Cost, Analogues and Tool page appear only while you are on them), the global Find box lands first-time users on a red error, the record panel shows a document's hash and storage key but not its text, and the command palette ranks Cuba and the Central African Republic above the Vault's own records for "cub". Visually it reads as a tidy marketing-site-in-a-shell rather than an instrument: Playfair numerals as headlines, three levels of boxed cards, eleven type sizes on one page, and 50+ tap targets under 36 px on Today. None of this needs new backend work. The fixes are a project "stateline", a reordered Today with a status strip, a stable nav, a record panel that shows the record, a scoped Find, and a typographic pass that treats numbers as data. Done together, they would turn a correct system into one that feels built for this firm.

---

## 2. Findings per page

### 2.1 Today (`hub/index.html`)

Evidence: `ui-today-fold-desk.png`, `ui-today-desk.png`, `ui-today-register-desk.png`, `ui-today-myprojects-desk.png`, `ui-today-attention-desk.png`, `ui-today-ipadl.png`, `ui-today-ipadp.png`, `ui-today-phone.png`, `ui-today-fold-phone.png`, `ui-today-es-desk.png`, `ui-today-loading-desk.png`, `ui-today-vault-down-desk.png`, `ui-globe-country-desk.png`, `ui-globe-tap-desk.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| T1 | The first screen has nothing to act on. At 1440×900 it is the globe and four country rows ("Colombia · 3 projects"); "What came in", stale, filing and lesson cards are at y≈2,050. On iPad landscape the globe alone fills the fold; on a phone the first 350 px are the navy sidebar block (user card, nav, "Vault reachable") and the title and globe fill the rest. The subtitle, the first sentence of the day, is "11 tools in the catalog, 10 in production." | High | today-fold-desk, today-fold-ipadl, today-fold-phone |
| T2 | Seven stacked sections make the page 4,274 px (desktop), 6,062 px (iPad landscape), 8,464 px (phone). The Catalog, eleven tool cards with version numbers and changelog buttons, is the largest block and the least daily-relevant. | High | today-desk, today-phone |
| T3 | "Where I worked in the last 90 days" shows "—" for last activity and "— · —" for runs · items on every one of seven cards; `/api/projects?mine=1` carries no `last_activity_at`, so `hub.js:417` always renders a dash. The card also lists projects the person has never touched. A dead section in the middle of the page. | High | today-myprojects-desk |
| T4 | Section headings are long and abstract: "Every opportunity and project in your scope", "Waiting on a partner" (which contains "What came in", which is not waiting on a partner), "Latest runs in your scope", "Recent runs across the firm" as eyebrow. The hero carries developer status ("CATALOG FROM THE VAULT · Built 5 Oct 2026"). | Medium | today-desk |
| T5 | Right column under the country list is empty (~300 px of cream at 1440) until a country is tapped; after a tap, "CREATE A PROJECT HERE" in gold primary sits above the three existing projects, so the primary action for a country with three live projects is creating a fourth. | Medium | today-fold-desk, globe-country-desk |
| T6 | Register table: on iPad landscape Holder/Lead/Updated are clipped; on the phone nine columns are squeezed into 390 px with every cell wrapping. No sticky first column, no card fallback. Risk cell wraps to two lines ("● / Elevated 54"). | Medium | today-ipadl, today-phone, today-register-desk |
| T7 | "What came in" is the best idea on the page and the least visible: a prose counts line ("5 messages filed · 1 need a decision · 6 files · 1 new organisations proposed · 1 bulk hidden", plural bug), record chips styled as tags with no link affordance, a "12" badge with no label, and two outline buttons. | Medium | today-attention-desk |
| T8 | Loading state: the globe is a black box and the right column says "Loading…"; no skeleton for the register or cards; the page then grows by 3,500 px. Vault-down state is good (one amber notice, honest copy, catalog fallback). | Low | today-loading-desk, today-vault-down-desk |
| T9 | World Monitor card (shown after a country tap) leaks an environment variable to users: "not connected (set WORLD_MONITOR_API_KEY on the Vault service)", and the line is half-untranslated in ES. | Low | today-es-desk |
| T10 | The globe itself is excellent: navy sphere, gold held countries, pulsing project dots, tooltip on hover, tap recentres and zooms, hint line, keyboard list beside it. It is the strongest brand asset in the Hub and currently decorates rather than navigates (see Signature idea A). | Good | today-fold-desk, globe-tap-desk |

### 2.2 Project file (`hub/project.html`)

Evidence: `ui-project-fold-desk.png`, `ui-project-desk.png`, `ui-project-timeline-desk.png`, `ui-project-ipadl.png`, `ui-project-ipadp.png`, `ui-project-phone.png`, `ui-project-fold-phone.png`, `ui-project-empty-desk.png`, `ui-project-tab-*.png`, `ui-project-es-desk.png`, `ui-project-loading-desk.png`, `ui-project-404-desk.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| P1 | No single statement of state. Reading order at 1440: H1 → "Client · opened 5 Oct 2026 · status ACTIVE · Colombia · stage [select] [ARCHIVE PROJECT]" → TOOLS row of nine chips (two rows; three on iPad; five on phone) → "RESEARCH THIS PROJECT · no research yet · WRITE TO…" → legal-tag/contacts/team card → five KPI tiles → "Opportunity" card whose last two rows are THESIS and NEXT STEP → Fields → Add documents → tabs. The next step is at y≈1,000 (desk), ≈1,650 (iPad), ≈2,500 (phone). Last activity is nowhere; you infer it from the top timeline row at y≈1,750. | Critical | project-fold-desk, project-desk, project-phone |
| P2 | The tool launcher takes the prime band under the title on every project, with all nine tools regardless of relevance (a fiscal review gets APEX Reservoir 3D), and an orphan caption "open in this project". | High | project-fold-desk, project-fold-ipadl |
| P3 | "Archive project", the one destructive action, sits inline beside the stage select in the header, in the same outline style as "Add field". No confirmation visible in the markup path. | High | project-fold-desk |
| P4 | Developer copy in the file card: "expiry not available from the API", "DEFAULT TAG inherited by every run and document", and in field rows three empty-state tokens at once ("no location yet · NO LOCATION … no dossier"). | Medium | project-desk |
| P5 | The tabs (Timeline, Headline numbers, Research, Lineage, Basis notes, Lessons, Scorecard) are the file, and they sit at y≈1,700 under a permanently expanded "Add documents" drop zone (~250 px) and the Fields card. Every tab switch requires scrolling past the same 1,700 px. The tab strip overflows with no affordance on iPad ("LESSO…") and in ES at 1440 ("FICHA DE EVALUACIÓN 3 FALLA" cut). | High | project-timeline-desk, project-ipadl, project-es-desk |
| P6 | KPI tiles use Playfair numerals (33, 3,100, 4, 0, 3/6) that read as headings; they wrap 4+1 on iPad and 2+2+1 on phone, leaving an orphan tile. "LATEST NPV10 MUSD / 33 MUSD" repeats the unit. | Medium | project-desk, project-ipadl |
| P7 | Headline numbers table: headers "NPV10 MUSD MUSD" and "TECHNICAL POTENTIAL BOPD BOPD"; deltas in raw keys ("npv10 musd −19.5% · technical potential bopd −20.5%"); ES "Añada 2" for Vintage 2 reads as a wine vintage. | Medium | project-tab-vintages-desk, project-es-desk |
| P8 | Timeline rows: date in two lines in a 112 px column, a type pill under every title, and the only tap target is the 17 px-tall title button (audit: 335×17). On iPad a finger must hit the text. Status pills only for runs. | Medium | project-timeline-desk |
| P9 | Lineage tab draws two columns of boxes with one curved link for ten nodes; it is a list, not lineage. Scorecard tab is clear and good (six rules, pass/fail/not-measurable, summary). | Low | project-tab-lineage-desk, project-tab-scorecard-desk |
| P10 | Loading is an H1 "Loading the project…" and nothing else; the whole page then appears. 404 is a clean notice but offers no way back (and the sidebar reads "Vault not checked"). | Low | project-loading-desk, project-404-desk |
| P11 | Empty project (Western Kazakhstan) is still 1,721 px tall: nine tool chips, "None recorded" ×2, empty Fields, drop zone, seven tabs with zeros, one stage-change row. | Low | project-empty-desk |
| P12 | "opened 5 Oct 2026" is the row's `created_at`, not the project's start; for anything imported it is wrong. | Low | project-fold-desk |

### 2.3 Record panel (`hub/record.js`, `hub/viewer.js`)

Evidence: `ui-project-record-desk.png`, `ui-project-pdf-desk.png`, `ui-project-run-desk.png`, `ui-project-record-ipadl.png`, `ui-project-record-ipadp.png`, `ui-project-record-phone.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| R1 | For a letter, email or text file the panel shows metadata about the record but not the record: "VIEW · Opens in its own app. [DOWNLOAD]", then version, hash and "STORED AT originals/13/13f23c8ff…". The extracted text the Vault indexed (and that search shows as a snippet) is not shown. The PDF path is good: inline viewer with page count, zoom and download. | High | project-record-desk, project-pdf-desk |
| R2 | The title gets the browser's default black focus rectangle on open: `#rp-title` is `tabindex="-1"` and focused, and `hub.css` only styles `:focus-visible` for `a, button, input`. | Medium | project-record-desk, project-record-ipadl |
| R3 | Developer fields above the fold of the panel: INGESTED, INDEXED "1 chunk · 292 characters", HASH, STORED AT; "FULL RECORD" expands raw JSON. | Medium | project-record-desk |
| R4 | Run panel: outputs as "irr pct 24 % · npv10 musd 36 MUSD" (raw keys, unit twice), inputs as one link, no assumptions table, no "open in tool / re-run / compare with previous" actions. | Medium | project-run-desk |
| R5 | Below 1200 px the panel is an 85vh bottom sheet with a drag handle and scrim; good. There is no swipe-to-dismiss, so Close or the scrim are the only exits. | Low | project-record-ipadp, project-record-phone |

### 2.4 Command palette (`hub/palette.js`)

Evidence: `ui-palette-desk.png`, `ui-palette-project-desk.png`, `ui-palette-ipadl.png`, `ui-palette-phone.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| C1 | Subsequence fuzzy matching over all ~250 country names (added as "quiet" items) means "cub" returns Cuba, Central African Republic, Czech Republic, DR Congo, Dominican Republic and nothing from the Vault; "Cubiro" is in a project asset, a run title and three documents, none reachable. The palette indexes projects, countries, tools and six pages; no runs, documents, contacts or organisations. | Medium | palette-desk |
| C2 | With a real project word ("llanos") it is excellent: project first, with country · client · stage. Empty query lists Projects first. Keyboard hints, ES labels. | Good | palette-project-desk, palette-phone |
| C3 | The trigger reads "Jump ⌘K" on a desktop, "⌘K" alone on a phone (meaningless on touch; the label span is hidden under 640 px). | Low | palette-phone, today-fold-phone |

### 2.5 Find (`hub/search.html`)

Evidence: `ui-search-desk.png`, `ui-search-none-desk.png`, `ui-search-results-desk.png`, `ui-search-firm-desk.png`, `ui-search-ipadl.png`, `ui-search-phone.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| S1 | The header "Find across the Vault" box on every page submits `search.html?q=…` with no scope. First use on any browser lands on a red "Scope required" banner, a pink invalid select, a dashed notice ("Choose a scope: search never runs without one") and an empty-state card ("Choose a scope") — three messages for one condition, in error colour, for a state the person did not cause. A chosen scope is remembered in `localStorage`, so this recurs on every new device. | Critical | search-desk, search-phone |
| S2 | Results are the second-best screen in the Hub: highlighted terms, type chips with counts, legal-tag pill, project · type · date meta, date filter. Two leaks: the predicate line reads as SQL ("scope = project:llanos-waterflood AND legal_tag.expires_at > now()"), and the PDF snippet shows the chunker's "## Page 1". A data-room file is typed "Other". | Medium | search-results-desk |
| S3 | A result opens the project, not the record; there is no record panel from search, so finding a letter is four taps (result → project → scroll → row). | Medium | search-results-desk |

### 2.6 Queues (`hub/queue.html`)

Evidence: `ui-queue-desk.png`, `ui-queue-ipadl.png`, `ui-queue-phone.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| Q1 | The clearest page in the Hub: one decision per card, suggestion visible, Accept/Reject or Assign/Not a project email, counts per section, works at every width. | Good | queue-desk, queue-phone |
| Q2 | "FILE TO WESTERN KAZAKHSTAN BROWNFIELD · 17 %" is styled as the suggested action at 17% confidence; a suggestion below the ready threshold should look like a hint, not a button. | Medium | queue-desk |
| Q3 | Third heading is a list ("NDA expiries, organisation proposals and fields named in documents"); on iPad its count badge drops to its own line. | Low | queue-ipadl |
| Q4 | Reachable from Today only through the "Open the queue" button inside "What came in" (see N1). | — | — |

### 2.7 Settings (`hub/settings.html`)

Evidence: `ui-settings-desk.png`, `ui-settings-ipadl.png`, `ui-settings-phone.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| SE1 | The H1 is "Engineer day rates" with eyebrow "RATE CONFIGURATION", but the page is Settings and opens with Connected apps and Your mailbox. The mailbox card tells end users "Mailbox connections are not set up on the server yet (SETUP.md §7)" beside a disabled gold button that looks like a faded primary. | High | settings-desk |
| SE2 | Partner assignment table on the phone clips the inputs ("Chri", "Antc") and the Charged-at column. | Medium | settings-phone |
| SE3 | "Save and apply" is outside any card at the very bottom (1,850 px); no sticky bar, no dirty indicator; rates and partner table are one form but look like separate cards. | Low | settings-desk |

### 2.8 Cost & health (`hub/cost.html`)

Evidence: `ui-cost-desk.png`, `ui-cost-ipadl.png`, `ui-cost-ipadp.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| CO1 | The document is wider than the viewport on iPad landscape (1,134 px at 1,024) and portrait (867 at 820): the scorecard table overflows the page rather than its card, so the whole page scrolls sideways. The only page in the set with horizontal overflow. | High | cost-ipadl, cost-ipadp |
| CO2 | Empty-month charts: "PER WEEK" draws two stubs and no axis; RAGAS draws one dot on a dashed target line, twice. For a single run, a sentence beats a chart. "CACHE HIT RATE —". | Medium | cost-desk |
| CO3 | Internal vocabulary on a partner-facing page: "(AC14)", "settings (infra_costs)", "RAGAS on the gold set". | Low | cost-desk |

### 2.9 Analogues (`hub/analogues.html`)

Evidence: `ui-analogues-desk.png`, `ui-analogues-ipadl.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| A1 | Scope select plus an "APPLY SCOPE" button (two steps for one choice), then six provenance chips, three selects and "EXPORT CSV" above "No analogue rows in this scope yet." The empty state should be one sentence and one action; the toolbar should appear with rows. | Medium | analogues-desk |
| A2 | Provenance-dot legend is a good, compact idea; keep it. | Good | analogues-desk |

### 2.10 Tool page (`hub/tool.html`)

Evidence: `ui-tool-desk.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| TP1 | The best-looking page: manifest key/value card, "active runs by version" bars, release-history table with commit, status, alias and breaking flags, changelog, runs by version. Dense, legible, data-first. This is the register the rest of the Hub should imitate. | Good | tool-desk |
| TP2 | "4 runs on older versions" uses the error (red) notice for an advisory; "RE-RUN ALL 4" is a heavy action with no visible confirmation. | Low | tool-desk |

### 2.11 Write to… (`hub/draft.js`)

Evidence: `ui-draft-desk.png`, `ui-draft-ipadl.png`, `ui-draft-phone.png`.

| # | Finding | Severity | Evidence |
|---|---|---|---|
| W1 | The panel opens inline above the file card and is a plain four-field form (Kind, Language, To, Brief); fine. But the "ANH (government): no contact yet. [ADD CONTACT]" line hangs outside the card gutter (x=285 vs 305), and "DRAFT", the primary action of the firm's most important flow, is a `btn-sm` at bottom-left, the smallest button on the page. | Medium | draft-desk |
| W2 | The wave 5 markup says "a bottom sheet on narrow screens"; on the phone it renders inline, pushing the whole file down. | Low | draft-phone |
| W3 | Review loop, render and Send were not exercised (no provider); the saved-draft-reopens-from-timeline path exists in code (`?draft=`). | — | — |

### 2.12 Mailbox prompt and activity cards

| # | Finding | Severity | Evidence |
|---|---|---|---|
| M1 | The "Connect your mailbox" card correctly stays hidden when the server reports connections unconfigured; the Settings copy for the same state is the leak noted in SE1. | Low | settings-desk |
| M2 | The four attention cards ("Stale runs and documents 0 · Nothing waiting.", "Re-run deltas 0 · Nothing waiting.") spend 2×150 px saying nothing; empty cards should collapse to a line. | Medium | today-attention-desk |

### 2.13 Navigation and wayfinding

| # | Finding | Severity | Evidence |
|---|---|---|---|
| N1 | The sidebar is not a stable map. Today: Today / Find / Settings. queue.html adds Queues; cost.html adds Queues and Cost & health; analogues.html adds Analogues; project.html and tool.html add "Project file" / "Tool page" only while you are on them. A new team member cannot find Queues, Cost or Analogues from Today except via one button inside a card or the palette. | High | today-desk vs queue-desk, cost-desk, analogues-desk |
| N2 | Breadcrumb on a project is "HUB / PROJECT FILE / TIMELINE" with no project name; the sidebar's "Project file" item is not a list of projects. | Medium | project-fold-desk |
| N3 | Three taps to a project's file: Today → register row or country card (tap 1) → project page, scroll ~1,700 px → timeline row (tap 2) → panel → Download (tap 3). Three taps, two long scrolls; on a phone the scroll is ~2,900 px. Acceptable count, unacceptable distance. | Medium | project-timeline-desk |
| N4 | Below 900 px the sidebar becomes a 190–350 px navy block at the top of every page (user card, nav groups, EN/ES, "Vault reachable") that scrolls away; no bottom tab bar; the top bar's search collapses to "Find across t". | Medium | today-fold-phone, project-fold-phone |

### 2.14 Visual system, type, colour, bilingual, accessibility (cross-page)

| # | Finding | Severity | Evidence |
|---|---|---|---|
| V1 | Numbers are set as headlines. Playfair (the marketing serif) carries KPI numerals, "3200 → 5400 kboe/d", panel titles, card titles and every H2/H3; Today uses eleven distinct font sizes (9, 11, 12, 13, 14, 15, 16, 17, 23, 24, 32 px). The result is handsome but not instrument-like: nothing is tabular, units float, and headings compete with data. | Medium | project-desk, today-register-desk |
| V2 | Type and targets are small for an iPad at arm's length: 104–107 text nodes under 12 px on Today at every width (11 px uppercase labels, pills, meta); 50–56 interactive targets under 36 px and 19–25 under 24 px on Today (EN/ES 35×23, Find 56×21, filter chips, timeline title buttons ×17). Apple's HIG asks for 44 pt. | Medium | audit table below |
| V3 | At least eight pill treatments coexist (`hub-pill` ok/warn/bad/info/muted/new/gold/ghost, `hub-stale`, `hub-kind`, `hub-count`, tab `.n`, timeline type chips, outlined stage capsules in the country panel). The same stage is a large outlined capsule in the country panel, a small grey pill in the register, and a bordered label in the timeline. | Low | globe-country-desk, today-register-desk |
| V4 | Boxes in boxes: `.card` with shadow, then bordered rows inside (Fields, record panel sub-cards), then pills inside those. Three levels of containment on one screen. | Low | project-desk, project-record-desk |
| V5 | Colour and a11y basics are right: measured contrast muted-on-cream 5.45:1, gold-ink 5.55:1, nav active 7.23:1, pills 5.6–6.0:1; gold focus ring on links/buttons/inputs; skip link; `sr-only` labels on every select; `aria-current`; `role=tablist`; `prefers-reduced-motion` honoured for the globe and transitions. | Good | focus-desk |
| V6 | No dark theme (no `prefers-color-scheme` rule anywhere). For a navy-sidebar + cream workspace it is tolerable; for the globe, panels and night use on an iPad it is a gap, not a bug. | Low | today-darkmode-emulated-desk |
| V7 | Fonts come from Google Fonts via `@import` in `style.css`; when blocked, every label falls back to DejaVu with broken letter-spacing. A confidential internal app should self-host its three families. | Low | (first-pass shots, replaced) |
| B1 | Bilingual: every static node has `data-es`; the ES render of Today, project, queue and settings is complete, including crumbs, tabs, pills and placeholders. Gaps are dynamic strings only (World Monitor line, the search predicate, "Añada" for vintage, tab strip overflow in ES). | Good / Low | today-es-desk, project-es-desk |
| MO | Motion and feedback: the globe is the only place with motion (rotation, tap zoom, tooltip); buttons have hover but no pressed state; actions (Assign, Accept, Mark all as seen) report through an inline `role=status` span, which is correct and quiet. Research shows "queued · waiting to start" with a spinner. No skeletons anywhere. | Low | globe-tap-desk, project-empty-desk |

### 2.15 DOM audit (desktop unless noted)

| Page | Height px | Targets | < 36 px | < 24 px | Text < 12 px | Overflow |
|---|---|---|---|---|---|---|
| Today | 4,274 (iPad 6,062 · phone 8,464) | 73 | 56 | 25 | 107 | no |
| Project | 2,603 (iPad 3,216 · phone 4,828) | 56 | 44 | 25 | 65 | no |
| Project + record panel | 3,434 | 59 | 47 | 26 | 81 | no |
| Queue | 1,176 | 24 | 18 | 5 | 24 | no |
| Find | 900 | 12 | 6 | 3 | 13 | no |
| Settings | 1,846 | 25 | 7 | 4 | 27 | no |
| Cost & health | 2,028 | 18 | 11 | 9 | 39 | **yes on iPad (1,134/1,024; 867/820)** |
| Analogues | 900 | 23 | 18 | 4 | 17 | no |
| Tool page | 2,724 | 22 | 17 | 13 | 66 | no |

---

## 3. Recommendations, ranked

Effort: S = a day or less, M = two to four days, L = a week or more. "Pages" names the files touched; nothing here needs a schema or API change except where stated.

### R1. Give every project a stateline (Critical → fixes P1, P2, P3, N2)
BEFORE: title, a meta line with a stage select and Archive, two rows of tool chips, research/write buttons, a legal-tag card, five KPI tiles, an Opportunity card with Next step at its foot.
AFTER: directly under the H1, one 56 px strip in Barlow Condensed small caps with a gold hairline above and below:
`TECHNICAL REVIEW ● · NEXT  Issue screening letter to Frontera by 10 Oct · Chris · LAST  RE: Cubiro screening letter, 5 Oct 09:06 (Jorge Ruiz) · NDA to 31 Mar 2027 · 4 runs · 6 docs · 3/6 ✓`
Each token is a link: stage opens the stage select as a popover; Next opens the register editor on that field; Last opens the record panel; NDA opens the legal tag; counts jump to the tab. Right-aligned, three actions only: **Write to…** (primary, gold), **Research**, and **Open in tool ▾** (a menu listing the tools that have produced this project's jobs first, then the rest). Archive moves into a "…" overflow menu with a confirm sheet. The legal-tag/contacts/team card collapses into a "File" disclosure below the KPIs. The crumb becomes `Hub / Llanos Basin waterflood screening`.
Pages: `hub/project.html`, `hub/project.js`, `hub/hub.css`. Data already present (`stage`, `register.next`, `register.owner`, timeline[0], tag expiry via `/api/projects/:id`). Effort: M.

### R2. Never land Find on an error (Critical → S1, S3)
BEFORE: header form submits `q` only; first visit shows a red banner, a pink select, a dashed notice and an empty-state card.
AFTER: the header form carries a hidden `scope` set by the page: on a project page `project:<id>`, on a tool page `firm`, elsewhere the remembered scope or `firm`. search.js treats a missing scope as a neutral state: one line under the field, "Searching the firm. Change scope ▾", in muted colour, never in `--bad`. Each result gets a "Open record" link that opens the record panel in place (reuse `record.js`; it already takes a `ref` and `title`). Remove the SQL-style predicate; replace with "Inside Llanos Basin waterflood screening, plus firm and public records".
Pages: `hub/search.js`, `hub/search.html`, every `hub/*.html` header form. Effort: S.

### R3. One stable sidebar on every page (High → N1, Q4, A2, TP3)
BEFORE: Today / Find / Settings, with Queues, Cost & health, Analogues, Project file and Tool page appearing only on their own page.
AFTER: the same list on every page: **Today · Projects · Queues (count) · Find · Analogues · Cost & health · Settings**, grouped Work / Firm as now. "Projects" is a new small page or a disclosure listing projects in scope by stage (reuse the register's rows). The current project or tool shows as a second-level item under Projects, not as a sibling. Queue count comes from `/api/queue/filing` plus lessons proposed (already fetched on Today). Below 900 px the navy block becomes a 56 px sticky bottom bar with five icons (Today, Projects, Find, Queues, More) and the user card moves into More.
Pages: every `hub/*.html`, `hub/hub.css`, `hub/hub.js` (count). Effort: S (M with the bottom bar).

### R4. Reorder Today so the fold is work, not decoration (High → T1, T2, T3, T4, T5, M2)
BEFORE: globe + country list, register, "Where I worked" (dead), attention cards, latest runs, catalog.
AFTER, top to bottom:
1. Status strip (see Signature idea C) replacing the subtitle: `3 need you · 1 to file · 0 stale · 12 came in since Sat 14:05 · Vault synced 14:02`.
2. Globe at 55% width; beside it, instead of the bare country list, **the live register**: one row per project (stateline component from R1 in its compact form: name, stage dot, next step, last activity age) grouped by country, scrolling inside the column. Tapping a globe dot highlights the row; tapping a row recentres the globe. "Create a project here" becomes a secondary outline action at the end of a country group.
3. "What came in" as a full-width band directly under the globe, with record chips rendered as links (underline on hover, chevron) and the counts as a grid of five figures, not prose.
4. Filing / Lessons / Re-run / Stale as one row of four compact counters that expand only when non-zero.
5. Latest runs table (keep).
6. Remove the Catalog from Today; it moves to Tools (tool.html index) reachable from the stateline's "Open in tool ▾" and the palette. Remove "Where I worked" until the API returns `last_activity_at`; if kept, render it from the timeline's first entry.
Pages: `hub/index.html`, `hub/hub.js`, `hub/hub.css`. Effort: M.

### R5. The record panel shows the record (High → R1, R3, R4)
BEFORE: type, project, tag, version, ingested, indexed, stale, then View (download), Versions, Original (format, hash, storage key), Full record.
AFTER: title, one meta line (`Letter · v1 · 5 Oct 2026 · lt-frontera-energy-nda-2026`), then the content: for PDF/images the viewer as now; for email, letter, text, DOCX-extracted and CSV, the extracted text (already stored in `chunks`; expose through `GET /api/items/:id` `extracted.text` or a `?text=1` query, which is a small additive API change) rendered in Barlow 15/1.5 with the search term highlighted when opened from Find. Actions row: **Open original** (inline where possible), **Download**, **Write a reply** (opens Write to… prefilled with `thread_id`), **Cite** (copies `[doc:<id>]`). Versions and a "Technical" disclosure (hash, storage key, chunks, JSON) at the bottom. Run panel: outputs as a two-column table using the tool manifest's labels and units (`produces[]` in `tool.json`), assumptions with provenance dots (reuse the analogues legend), inputs as links, actions **Open in tool**, **Re-run**, **Compare with previous**. Remove the UA focus rectangle by adding `.hub h2:focus-visible, .hub [tabindex="-1"]:focus { outline: none }` with the gold ring on the panel instead.
Pages: `hub/record.js`, `hub/viewer.js`, `hub/hub.css`; optional `vault/src/api/items.routes.ts` (text field). Effort: M.

### R6. Put the file one tap away (High → P5, P8, N3)
BEFORE: tabs at y≈1,700 under Fields and an always-open drop zone.
AFTER: tabs become a sticky strip directly under the stateline (R1), scrollable with edge fades and `scroll-snap`, counts as now. Fields becomes a compact row inside the "File" disclosure ("Cubiro · Castilla · + Add field"). Add documents becomes a button in the tab strip ("＋ Add documents") that opens the drop zone as a sheet; the whole page remains a drop target with a full-page gold outline on dragover. Timeline rows become one tappable block (`<a>`/`<button>` filling the row, min-height 44 px), date on one line (`5 Oct · 13:54`), type as a small mono prefix rather than a pill, status pill right-aligned for all kinds.
Pages: `hub/project.html`, `hub/project.js`, `hub/hub.css`. Effort: M.

### R7. Make the palette search the Vault (Medium → C1)
BEFORE: subsequence match over projects, all countries, tools, pages.
AFTER: countries not held match only on word start (and `quiet` items rank after any Vault hit); add a "Records" group fed by `GET /api/search?q=&scope=firm&limit=5` debounced at 150 ms after the third character (title and type, opening the record panel on the current page or the project page with `?doc=`); add Contacts and Organisations from `/api/organisations?q=`. Replace "Jump ⌘K" with a search icon and "Jump" on touch devices.
Pages: `hub/palette.js`, `hub/hub.css`. Effort: S–M.

### R8. Touch and type pass (Medium → V2, P8, SE2, T6)
BEFORE: 11 px labels, 23 px language buttons, 21 px Find button, 17 px timeline titles, tables that squeeze or clip.
AFTER: minimum 36 px hit area for every control below 1024 px (44 px for primary actions and row taps), via padding not font size; labels 11 → 12 px with `.14em` tracking; pills 11 → 12 px; EN/ES as a 36 px segmented control. A single responsive table pattern (`.hub-table-wrap { overflow-x: auto }` with a sticky first column and a right-edge fade) applied to the register, headline numbers, partner assignment and scorecard tables.
Pages: `hub/hub.css`. Effort: S.

### R9. Settings is Settings (High → SE1, SE3, M1)
BEFORE: H1 "Engineer day rates"; mailbox copy references SETUP.md; Save at the foot.
AFTER: H1 "Settings"; sections **You** (Your mailbox, Connected apps, Language) then **Firm** (Weekly labour rates, Cost components, Partner assignment); a sticky footer bar with "Save and apply" that appears only when a field is dirty; mailbox states in user language: "Mail capture is not switched on for this Vault yet. Ask Chris." with the button hidden, not disabled.
Pages: `hub/settings.html`, `hub/settings` script. Effort: S.

### R10. Fix the Cost & health overflow and empty charts (High → CO1, CO2)
BEFORE: scorecard table widens the document on iPad; empty sparkline and single-point RAGAS charts.
AFTER: wrap the scorecard in `.hub-table-wrap` (R8); render a chart only with two or more points, otherwise a sentence ("First evaluation 29 Sept: faithfulness 1.00, precision 1.00"); hide "Cache hit rate" until there is a value.
Pages: `hub/cost.js`, `hub/hub.css`. Effort: S.

### R11. Vocabulary pass (Medium → P4, R3, S2, CO3, T9, SE1)
BEFORE: "expiry not available from the API", "SETUP.md §7", "WORLD_MONITOR_API_KEY", "AC14", "infra_costs", "## Page 1", "npv10 musd −19.5%", "NO LOCATION / no location yet / no dossier".
AFTER: one empty-state token per fact; units from the tool manifest once; no file names, env vars or acceptance-criterion ids in user copy; strip markdown heading markers from snippets at render.
Pages: `hub/project.js`, `hub/record.js`, `hub/search.js`, `hub/cost.js`, `hub/hub.js`, `hub/settings.html`. Effort: S.

### R12. Loading skeletons and collapsed empties (Medium → T8, P10, M2, A1, P11)
BEFORE: "Loading the project…" H1; "Nothing waiting." cards; toolbar over an empty analogue table.
AFTER: a skeleton of the stateline, tab strip and three rows at `data-ready=0`; empty cards render as one line with a count of zero; empty tables render one sentence and one action with the toolbar hidden; the 404 offers "Back to Today" and "Find a project".
Pages: `hub/hub.css`, `hub/project.js`, `hub/hub.js`, `hub/analogues.js`. Effort: S–M.

### R13. Write to… as the primary flow (Medium → W1, W2)
BEFORE: inline form, small Draft button, orphan contact line.
AFTER: on ≥1200 px a right-hand panel the same width as the record panel (520 px) so the file stays visible while drafting; on narrow screens the bottom sheet the wave 5 markup specified; Draft as a full-width gold button at the sheet's foot; the contact warning inside the form as a hint under "To".
Pages: `hub/draft.js`, `hub/hub.css`. Effort: S.

### R14. Self-host fonts; dark tokens later (Low → V7, V6)
AFTER: ship Playfair Display, Barlow and Barlow Condensed as WOFF2 under `hub/fonts/` with `font-display: swap` for the Hub only (the public site keeps its `@import`, so public pages stay byte-identical). Dark theme is a token-only change once numbers move to the data style in Signature idea D; defer.
Pages: `hub/hub.css`, new `hub/fonts/`. Effort: S (fonts), L (dark).

---

## 4. Signature ideas

Four moves that would make the Hub look and feel unmistakably ATC's and unmistakably an instrument, without adding a feature.

**A. The globe is the door.** Today becomes two things: the globe and the live register beside it, and nothing else above the fold. Every project is a pulsing dot; the dot's colour is its execution risk, its pulse rate its recency (a project touched today breathes, one untouched for a month is still). The register column beside it is a list of statelines (idea B) grouped by country, scroll-linked to the globe: scroll the list and the globe turns to the country in view; tap a dot and the row glides into view and highlights. "What came in" sits as a thin band under both. This is Wood Mackenzie Lens's map-first screen and Palantir's object-list-beside-map, done with the asset the Hub already owns. No new data: `/api/countries`, `/api/projects`, timeline[0].

**B. One stateline, three places.** A single component, `hub-stateline`, in Barlow Condensed small caps on a gold hairline: `STAGE ● · NEXT … · LAST … · NDA … · counts`. It is the project header (R1), the register row on Today and in the country panel, and the result card in Find. One component replaces four current renderings of the same facts (register row, country-panel card, "Where I worked" card, project header), which is where the consistency is won. Tapping any token goes straight to the thing it names.

**C. A live status strip.** A 28 px strip under the top bar on every page, in the sidebar navy with gold figures: `● Vault synced 14:02 · mail polled 13:58 · 3 need you · 1 to file · 0 stale · 1 lesson to confirm`. Each figure is a link; zeros are dimmed, not hidden. It replaces the four "Nothing waiting." cards and the "Vault reachable" footer, and gives the Bloomberg-style reassurance that the system is alive and that nothing is waiting on you, which is the glance the brief asks for. Sources exist: `/api/me/activity`, `/api/queue/filing`, `/api/lessons?status=proposed`, stale endpoint, mailbox status.

**D. Numbers as data.** Reserve Playfair for the page H1 and nothing else. Every figure (KPIs, register, headline numbers, run outputs, scorecard) is set in Barlow Condensed 600 with `font-variant-numeric: tabular-nums`, the unit in 11 px small caps after it, and the delta as a signed figure with a triangle, never a sentence. Card titles drop to Barlow 600 15 px. This is the Petrel/Techlog and Bloomberg discipline, costs one CSS pass, makes every table line up, and is what makes the tool page already feel right. With it in place the dark theme is a token swap, because the type no longer depends on the cream to read as "editorial".

---

## 5. References read for this review

- Linear, "How we redesigned the Linear UI (part II)" — restrained chrome, compact density, ⌘K as the unified surface: https://linear.app/now/how-we-redesigned-the-linear-ui
- Matt Ström-Awn, "UI Density" — density as value per unit of attention, not pixels: https://mattstromawn.com/writing/ui-density/
- Bloomberg UX — speed, dense display and predictable colour semantics over mainstream conventions: https://www.bloomberg.com/company/what-we-do/ux/
- Palantir Blueprint — a toolkit "optimized for building complex, data-dense web interfaces for desktop applications": https://github.com/palantir/blueprint and https://blog.palantir.com/scaling-product-design-with-blueprint-25492827bb4a
- Wood Mackenzie Lens — map-first screening, AG-Grid tables, asset dashboards: https://www.woodmac.com/lens/ and https://www.woodmac.com/press-releases/lens_global_asset_valuation/
- Rystad Energy Cube Browser / dashboards — pivot-style multi-dimensional queries, shareable query scripts: https://www.rystadenergy.com/energy-themes/oil--gas/exploration/e-cube/
- SLB Petrel 2014 "What's new" — the ribbon and pane relayout "reduced users' cursor travel by 30% and clicks by 35%": https://www.rogtecmagazine.com/schlumberger-launches-petrel-techlog-studio-and-ocean-2014-software-platforms/
- Apple Human Interface Guidelines, hit targets of at least 44×44 pt: https://developer.apple.com/design/human-interface-guidelines/accessibility

## 6. Evidence index

All under `docs/vault-hub/wave7/evidence/`. Suffixes: `-desk` 1440×900, `-ipadl` 1024×768, `-ipadp` 820×1180, `-phone` 390×844; `-fold` is the first screen only; others are full page.

Today: `ui-today-{desk,ipadl,ipadp,phone}.png`, `ui-today-fold-{desk,ipadl,phone}.png`, `ui-today-register-desk.png`, `ui-today-myprojects-desk.png`, `ui-today-attention-desk.png`, `ui-today-es-{desk,phone}.png`, `ui-today-loading-desk.png`, `ui-today-vault-down-desk.png`, `ui-today-darkmode-emulated-desk.png`, `ui-globe-country-{desk,ipadl,phone}.png`, `ui-globe-tap-desk.png`, `ui-palette-{desk,ipadl,phone}.png`, `ui-palette-project-desk.png`, `ui-focus-desk.png`.
Project: `ui-project-{desk,ipadl,ipadp,phone}.png`, `ui-project-fold-{desk,ipadl,phone}.png`, `ui-project-timeline-desk.png`, `ui-project-empty-{desk,ipadp}.png`, `ui-project-tab-{research,lineage,basis,lessons,scorecard,vintages}-desk.png`, `ui-project-tab-scorecard-phone.png`, `ui-project-es-desk.png`, `ui-project-loading-desk.png`, `ui-project-404-desk.png`, `ui-project-record-{desk,ipadl,ipadp,phone}.png`, `ui-project-pdf-desk.png`, `ui-project-run-desk.png`, `ui-draft-{desk,ipadl,phone}.png`.
Other pages: `ui-queue-{desk,ipadl,phone}.png`, `ui-search-{desk,ipadl,phone}.png`, `ui-search-none-desk.png`, `ui-search-results-desk.png`, `ui-search-firm-desk.png`, `ui-settings-{desk,ipadl,phone}.png`, `ui-cost-{desk,ipadl,ipadp}.png`, `ui-analogues-{desk,ipadl}.png`, `ui-tool-desk.png`.

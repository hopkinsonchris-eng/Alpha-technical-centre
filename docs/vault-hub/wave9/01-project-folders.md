# Wave 9 — every project filed into one skeleton (Markup and decision log)

Tooler, 13 October 2026. Chris Hopkinson: "Secondly the file structure for a project. Should there be a skeleton made for every new project into which information is stored? Legal, Government, Financial, Subsurface — with sub directories for wells, reservoirs etc, Directories for each of the APEX apps (That the APEX apps will store their runs in), Papers/research. For the second question tooler it." To the Markup: "It is Approved so you can build it."

## 1. Practice scan (Phase 1)

| # | Practice | Who does it | Taken here |
|---|---|---|---|
| P1 | Every new matter starts from the same template | iManage Flexible Folders; data-room index templates | The skeleton: same twelve folders on every project |
| P2 | Fixed top level, freedom below | iManage enforced templates | Top level fixed; the asset and app folders grow from the project |
| P3 | Folders are a view of each record's labels; one record can show in two places | ISO 19650 common data environments; OSDU | Filings are rows beside the record; nothing moves; the WorkDrive tree stays as "Source folders" |
| P4 | Each document type maps to a slot and files itself | TMF Reference Model in Veeva eTMF | Rules by type, source and words |
| P5 | Folders generated from master data (wells, wellbores, reservoirs) | OSDU | Attach a well, get its folder |
| P6 | Each app's work products linked to the master data | OSDU work product components | Runs listed under 08 APEX apps by tool |
| P7 | Copy, never move; keep the original structure | Data-room practice | WorkDrive paths untouched |
| P8 | Folder-level confidentiality | Farm-out data rooms with tiered access | Legal and Financial partners-only |
| P9 | Completeness: each slot says what it expects and flags gaps | TMF completeness checks | The checklists |
| P10 | Top level numbered in review order | Data-room indexes | 00–11 |

## 2. Choice sheet (Gate 1)

| # | Question | Answer (verbatim) |
|---|---|---|
| W9-D1 | Real folders or a labelled view | "Labelled view (Recommended)" |
| W9-D2 | Top folders | "Yours + data-room heads (Recommended)" |
| W9-D3 | How records get filed | "Rules + AI, you confirm doubts (Recommended)" |
| W9-D4 | Extras in the first build | "Asset sub-folders (P5), APEX runs as files (P6), Completeness checklist (P9), Partner-only folders (P8)" |

## 3. Gap statement

Nobody files a project by reading each document against the project's own wells and fields. Data-room templates are empty shells filled by hand; eTMF systems auto-file only from a type someone chose at upload; OSDU links data to wells only through structured ingestion manifests, never from an unstructured PDF. When Parker Creek's ~2,300 WorkDrive files land, every one of these leaves them where they arrived. Reading each once and filing it under the right discipline and well — with the quote that justified it and a list of what is missing — turns a new project into a sorted pack in hours instead of days. Measurable on Parker Creek: the share outside Unsorted after one pass, and the share of AI placements a partner moves.

## 4. Options (Phase 4)

A (chosen): the reader-filer — rules, then the model with a verbatim quote, confident filings file themselves, doubtful ones ask. B (chosen with A): people's moves become the model's examples. C (follow-up F19): a "please send us" letter drafted from the checklist gaps.

## 5. The skeleton

```
00 Unsorted
01 Legal (partners only)              expects: NDA, joint operating agreement
02 Government & regulatory            expects: licence or PSC, work programme
03 Commercial & contracts
04 Financial (partners only)
05 Subsurface
   Basin & regional
   Fields/<each attached field>       each expects: reserves report
   Reservoirs/<each attached reservoir>
   Wells/<each attached well>         each expects: well logs, end of well report
   Seismic & geophysics               expects: seismic survey
06 Facilities & infrastructure        expects: facilities description
07 HSE                                expects: environmental assessment
08 APEX apps/<every APEX app, and any other tool with runs here>
09 Papers & research: Papers · News & web · Company intelligence
10 Correspondence
11 Deliverables
```

## 6. BEFORE → AFTER

| Surface | Before | After |
|---|---|---|
| Files tab | One tree: WorkDrive folders as they are, then Uploaded, Mail, Research, Other | A switch: **Project folders** (default) and **Source folders** (the tree as before). The skeleton with counts; a lock on Legal and Financial; each row's badge (Rule, AI 92%, Filed by…) and kind; **Move to…** on every row; Unsorted rows carry the AI's suggestion and quote with **Accept**; each folder's checklist with ✓ and ✗, "Not applicable" for partners |
| APEX runs | A separate list | Under 08 APEX apps/<app>, current runs only, a tap opens the run |
| Queues | Asset, research, round and other cards | A **Files waiting for a folder** section: the file, project, suggestion with confidence and quote; Accept, Choose folder, Leave unsorted |
| Confidentiality | Partners-only by type (NDA, contract, invoice…) on the record panel and search; the timeline and lineage checked only the tag | Filing into Legal or Financial makes a record partners-only everywhere (`extracted.partners_only` and its chunks). The timeline and lineage now honour partners-only too, so an associate no longer sees an NDA's or an invoice's title there (a leak found while building this) |
| Ingest | Text, chunks, asset proposals | Then the record is filed. The 15-minute `ingest-sync` job also files up to 200 never-filed records a run (research notes, mail, files from before the folders) within what is left of its spend cap |

## 7. Files

Vault: `db/014_project_folders.sql`, `src/folders/skeleton.ts`, `src/folders/classify.ts`, `src/api/folders.routes.ts` (new); `src/ingest/index.ts` (file after indexing), `src/jobs/ingest-sync.ts` (the backlog), `src/api/projects.routes.ts` (partners-only on the timeline and lineage). Hub: `hub/components/folder-tree.js` (new), `hub/project.js`, `hub/project.html`, `hub/queue.js`, `hub/queue.html`, `hub/hub.css`. Tests: `vault/test/folders.test.ts` (new), migration counts in `auth`, `boot`, `db`; `test/e2e/hub-folders.spec.mjs` (new), `hub-health.spec.mjs` (stubs). No Tier A schema changed: filings live in their own table, never on the item.

## 8. Acceptance criteria and smoke tests

| # | Criterion | Test |
|---|---|---|
| W9-AC1 | Every project answers with the twelve numbered folders in order, even with no records | `folders.test.ts` |
| W9-AC2 | Rules by type, source, words and attached assets; marked Rule | `folders.test.ts` |
| W9-AC3 | The model files only into this project's folders, only with a verbatim quote, by itself at ≥ 0.8; below, Unsorted plus one queue card that carries no record text; accepting files it as the person | `folders.test.ts` |
| W9-AC4 | A move supersedes; the history keeps both; the machine never refiles a person's filing | `folders.test.ts` |
| W9-AC5 | Legal and Financial: hidden from associates in the folders, record panel, timeline, lineage and search; only partners file there; moving out does not lift it | `folders.test.ts` |
| W9-AC6 | Attaching a well gives it its folder with its checklist | `folders.test.ts` |
| W9-AC7 | Runs per app; superseded and hidden runs not counted; out-of-scope runs absent | `folders.test.ts` |
| W9-AC8 | Checklists tick, gaps show, partners waive (latest row wins), associates cannot | `folders.test.ts` |
| W9-AC9 | People's moves are the model's examples, only from the same client; another project's asset folder teaches the level only | `folders.test.ts` |
| W9-AC10 | The backlog files never-filed records only, N a run, resumes, never twice | `folders.test.ts` |
| W9-AC11 | The Hub: skeleton, badges, suggestion and Accept, Move to, checklists and waive, associates' view, Source folders, Spanish, the queue section | `hub-folders.spec.mjs` (7), evidence `w9-project-folders.png`, `w9-folder-queue.png` |
| W9-AC12 | Full suites green; public pages byte-identical | CI |

Risks: model cost on large projects (paced by `ingest-sync`, capped by `INGEST_BUDGET_GBP`); a misfiling into Legal or Financial hides a record from associates (fails safe; a partner sees and moves it). Rollback: revert; the filings table is separate, so records and the Source folders are untouched.

## 9. Follow-ups

| # | Item | Plan |
|---|---|---|
| F19 | Gap letter (Option C) | Draft a "please send us" letter from the checklist gaps through `/api/draft` |
| F20 | APEX apps save to the Vault directly | APEX 3D pushes runs to `POST /api/app/runs` and reads originals through the Vault, so its WorkDrive sync is no longer the record |
| F21 | An "oil person" reading pass | Extract formations, pipelines and facilities, link them (field in basin, produces from formation), and keep neighbouring fields as analogues rather than attachments |

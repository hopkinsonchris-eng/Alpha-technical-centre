# Wave 8 — indexing in view, and Ask this project (Markup)

Tooler, 8 October 2026. Chris Hopkinson, with Parker Creek's 2,316 files on the Files tab: "1. I opened a couple of files and it says not indexed yet. How do I see the progress in total for indexing, and for an initial file (like where is it in the queue?) 2. Say I am in a project and I want to find information about how successful re-perforations have been historically. How could I get a summary of that information including a list of referenced files?" To the two proposals: "build them both".

## 1. Practice scan (compressed)

| Who | What they do | Taken here |
|---|---|---|
| Dropbox, Google Drive, iCloud | A sync line with counts and a per-file state mark; the per-file state answers "why is this one different" | The indexing line on the Files tab and a state on every row |
| Print queues, CI queues (GitHub Actions, Buildkite) | Position in the queue and an estimated start, not a spinner | "143rd of 610 waiting · expected about 14:30" from the job's own order and pace |
| Perplexity, NotebookLM, Glean | A question over a bounded corpus; the answer cites numbered sources and the source list is a first-class part of the result | The answer's citations open the record panel; the sources list is the files it drew on, each with how often it was cited |
| The firm's own country pack and Write to… (wave 7) | Every sentence with a figure carries a citation or becomes a question; a spend guard caps the day | The same checker, the same guard, a new surface |

## 2. BEFORE → AFTER

| Surface | Before | After |
|---|---|---|
| `GET /api/projects/:id/files` | one row per file | each row adds `index: {state, chunks, queue_position, expected_at}` with state one of `indexed`, `waiting`, `unsupported`, `needs_ocr`, `empty`, `no_original`; the body adds `index: {indexed, waiting, unsupported, needs_ocr, empty, no_original, queue_total, per_run, next_run_at}` |
| `GET /api/items/:id/index` (new) | none | the same per-file object with `queue_total`, scope-checked like the record, for the record panel |
| Files tab | find box, chips, tree | an indexing line under the head: "1,480 of 2,316 indexed · 610 waiting · 226 unsupported", with the unsupported kinds named when there are any and the next run's time; each waiting row says "waiting · 143rd", each unsupported row "no text", needs-OCR "needs OCR"; indexed rows say nothing more |
| Record panel, a file not yet indexed | "not indexed yet" and Index now | "Waiting to be indexed: 143rd of 610, expected about 14:30" beside Index now; an unsupported format keeps its word |
| Project page | Research this project, Write to… | **Ask this project** beside Research: a sheet with a question field; the answer as paragraphs in which every sentence with a figure cites `[doc:<id>]` as a chip that opens the record panel; "What the files do not answer" for anything uncited; **Sources**, the files the answer drew on with how many sentences cite each, opening the panel; the cost and the number of passages read; Spanish on request |
| `POST /api/projects/:id/ask` (new) | none | `{question, language?}` → `{answer: [paragraph…], questions: [...], sources: [{id, name, type, cited}], passages, usage}`; retrieval through the gateway in the project's scope (the caller's own scope, partners-only rows absent for members), the drafting checker on the reply, the spend guard, one `project.ask` audit row with the refs; 503 `not_configured` without a provider, 400 for an empty question; nothing from outside the project's scope |

Out of scope, named: re-ordering the queue by hand (a partner's Index now already jumps one file); OCR of TIFF images (the reader has no image OCR; a scanned PDF is OCRed); saving an answer as a basis note (the answer can be pasted into Write to…); questions across projects.

## 3. Files

Vault: `src/api/files.routes.ts`, `src/api/ask.routes.ts` (new), `src/llm/ask.ts` (new). Hub: `hub/components/file-tree.js`, `hub/record.js`, `hub/project.js`, `hub/project.html`, `hub/hub.css`, `hub/components/ask.js` (new). Tests: `vault/test/files.routes.test.ts`, `vault/test/ask.routes.test.ts` (new), `test/e2e/hub-files.spec.mjs`, `test/e2e/hub-ask.spec.mjs` (new). Docs: this file, the wave 7 decision log.

## 4. Acceptance criteria

- **W8-AC15** The files route reports each file's indexing state from the record and its current chunks, the waiting ones with their position in the sync job's own order (oldest filed first, across the Vault) and an expected run time at 200 per quarter-hour run; the summary counts every state and names the queue length, the per-run figure and the next run. `GET /api/items/:id/index` answers the same for one record, 404 for a hidden or unknown one, 403 outside the caller's scope.
- **W8-AC16** The Files tab shows the indexing line and the per-row marks; the record panel of a waiting file shows its position and expected time beside Index now. Both languages.
- **W8-AC17** `POST /api/projects/:id/ask` answers from passages in the project's scope only: the answer cites records the caller may see, an uncited figure becomes a question, the sources list names each cited file once with its count, the audit row carries the refs, a member never receives a partners-only passage, and the route is 503 without a provider and 400 for an empty question. The spend guard counts the call.
- **W8-AC18** On the project page, Ask this project opens a sheet; the answer's citations open the record panel; the sources list opens the panel too; the questions section appears only when there are questions; a 503 reads as "the assistant is not configured"; Spanish on request. No request from the browser goes to the model provider.

## 5. Smoke plan

| Criterion | Test |
|---|---|
| W8-AC15 | `files.routes.test.ts`: one indexed file (chunks and the marker), one unsupported, one needs OCR, three waiting with set `created_at`; the summary and the positions; `expected_at` for the first waiting one on the next quarter hour; the item route for a waiting one, 404 hidden, 403 for an associate on a client-NDA record |
| W8-AC16 | `hub-files.spec.mjs`: the stubbed summary and states; the line text in EN and ES; the row marks; the record panel's waiting line from the stubbed item route |
| W8-AC17 | `ask.routes.test.ts` with a `FakeProvider` and seeded chunks: the cited sentence stands, the uncited figure becomes a question, sources and counts, the audit refs, the member's answer without the partners-only passage, 503 and 400 |
| W8-AC18 | `hub-ask.spec.mjs`: the button, the sheet, a stubbed answer with two citations and one question; the chip opens the panel; the sources list; ES; the 503 notice; no request to the provider's host; evidence `w8-ask.png` |

Risks: the expected time is an estimate (the £2 per-run cap can stop a run early), and the line says "expected". Rollback: revert either PR; the index route and the ask route are read-only against the Vault.

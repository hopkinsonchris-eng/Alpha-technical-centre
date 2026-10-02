# Wave 5 — Markup (Gate 2)

The project file you work from: durable originals, a viewer, Write to… with the review loop, and the Vault as a connector for the Claude app. Decisions W5-D1 to W5-D4. Four pull requests, each opened and merged when green.

## 1. BEFORE → AFTER

### 1.1 Durable originals (W5-D1, P40)

BEFORE: `VAULT_STORAGE` defaults to the filesystem; on Render that is the container disk, wiped at each deploy. The Supabase backend is a stub that refuses every call.

AFTER: `supabaseStorage()` in `vault/src/storage.ts` is real: private bucket `vault` (name from `VAULT_STORAGE_BUCKET`), plain `fetch` against the Storage REST API with the service key (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`), `put` with upsert, `get` returning bytes or null on 404, `exists` by a HEAD-style request; keys unchanged (`originals/<hash-prefix>/<sha256>`, `derived/<item-id>/…`). `VAULT_STORAGE=supabase` on the API and every cron in `render.yml` (sync: false for the two secrets). Boot logs which storage is open and refuses `filesystem` in production unless `VAULT_STORAGE_DIR` is set on purpose. A record whose original is missing from the store says so in the panel ("original missing: upload it again") instead of failing.

Setup for Chris (`vault/SETUP.md` §1.5): Supabase → Storage → New bucket `vault`, private; Project settings → API → service_role key → Render `SUPABASE_SERVICE_KEY` on atc-vault-api, atc-vault-research, atc-vault-miners; `SUPABASE_URL` is the project URL. Then upload the three High Tech Electronica files again.

### 1.2 Open the original (W5-D2, P40–P42)

BEFORE: the record panel shows the extracted text, facts, versions and the storage key. Nothing opens the file.

AFTER: `GET /api/items/:id/original` (new file `vault/src/api/originals.routes.ts`): scope-checked with `assertVisible`, streams the stored bytes with the record's `mime`, `Content-Disposition: inline; filename*=UTF-8''<title>` (or `attachment` with `?download=1`), `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Accept-Ranges: none`; 404 when the key is absent from the store; one audit event `item.view` with `{inline|download, version}`. `?version=N` serves an earlier version through `item_versions`.

Record panel (`hub/record.js`): a **View** card above Related for a document with an original:
- PDF: PDF.js (pdfjs-dist from cdnjs, worker from the same CDN) rendering pages lazily on canvas into a scroll container, page counter, zoom −/+, `maxCanvasPixels` clamped for iPad; the file fetched whole with the Access cookie.
- Images (`image/*`): an `<img>` from the same route.
- Spreadsheets (`xlsx`, `xls`, `csv`): SheetJS (`xlsx` from cdnjs) → one `<table>` per sheet behind sheet tabs, first row as header, capped at 2,000 rows with a "first 2,000 of N rows" note, download for the rest.
- Everything else (Word, PowerPoint, email, text): a **Download** button, and for `docx` the extracted text stays as today.
- Bilingual chrome, works in the bottom sheet below 1200 px. The public pages are untouched; `hub/*` stays `noindex`.

### 1.3 Write to… (W5-D3, P44–P47)

BEFORE: `POST /api/draft` and `POST /api/render` exist; the Hub has no door; the drafter reads neither the register counterparties nor the research findings.

AFTER, on the project page toolbar beside Research: **Write to…** opens the drafting panel (`hub/draft.js`, new; a panel under the toolbar, a bottom sheet on narrow screens):

1. **Set-up strip**: kind (Email · Letter · Report section · Calc note), language (EN/ES), **To** picked from the project's contacts (name, role, organisation, last contact date from dispatches) and from the register counterparties (holder, government, partners are offered as organisations to create a contact for when none exists), a scope warning when the recipient's organisation is not the client, the holder, a partner or the government of this project; and the **brief** (what to say).
2. **Draft** calls `POST /api/draft` with `organisation_id` from the recipient. The response renders as:
   - **What this draft does not know** first: each open question with the person to ask (from `who_to_ask`) and a one-tap "ask" that opens a mail to that colleague with the question.
   - **The draft**, paragraph by paragraph. Every citation `[doc:…]`/`[run:…]`/`[lesson:…]`/`[wm:…]` is a chip; tapping it opens the cited record in the record panel with the passage the drafter used (the `sources[].snippet` for that ref) highlighted at the top. A sentence with a figure and no citation is highlighted amber and counts against approval.
   - Per paragraph: **Keep**, **Keep with a note**, **Drop**. Tone buttons: Shorter · Longer · More formal · Plainer, each re-calling `/api/draft` with `tone` and re-running the uncited check.
   - **Sources used**: the records the drafter read, with "prior correspondence" marked.
3. **Save**: the draft is already a note (the API saves it); Save records the review (`paragraph decisions`, `citations_opened`, `review_seconds`) on the note's `extracted.review` through `PATCH /api/items/:id/review` (new, in `originals.routes.ts`'s sibling `draft.review.routes.ts`), and the dropped paragraphs are excluded from render. **Approve** is disabled while an amber sentence remains; a soft warning appears when no citation was opened.
4. **Render**: DOCX (default; PDF when the server has Chromium, otherwise the button says so) through `POST /api/render`; the file downloads and the panel shows the reference number.
5. **Mark as sent**: `POST /api/dispatches` (new route in the same file) records `direction out`, `organisation_id`, `contact_ids`, `channel` (email default), `occurred_at` now, `signed_by` the caller, linking the note; the timeline shows "Sent to <contact>, <org>" and the note is read-only from then on (a later edit is a new draft that supersedes).

Drafter changes (`vault/src/llm/draft.ts`): sub-queries also get the research tag so findings are retrieved (F17 closes); the context's organisation falls back to the register's holder when no `organisation_id` is given; the prompt lists the counterparties (holder, government, licence type, partners) as facts of the project with the register as their source `[doc:project:<id>]`… no: counterparties carry no citation, they are prompt context only and any sentence quoting them must cite the register note; the simplest faithful rule is that counterparties appear in the "About this project" block and are allowed as uncited names (not figures), as the client name already is.

### 1.4 The Vault as a Claude connector (W5-D4, P48–P49)

See §1.4 below, filled from the connector specification check.

## 2. Files

| area | files |
|---|---|
| storage | `vault/src/storage.ts` (supabase backend), `vault/src/db/boot.ts` (storage check), `render.yml`, `vault/.env.example`, `vault/SETUP.md` §1.5 |
| original | `vault/src/api/originals.routes.ts` (new), `hub/record.js`, `hub/hub.css`, `hub/project.js` (panel height for the viewer) |
| drafting | `hub/draft.js` (new), `hub/project.html` (panel host), `hub/project.js` (toolbar button), `hub/hub.css`, `vault/src/api/draft.review.routes.ts` (new: review, dispatches), `vault/src/llm/draft.ts` (research tag, counterparties, tone), `vault/src/api/draft.routes.ts` (accepts `tone`, excludes dropped paragraphs at render) |
| connector | `vault/db/006_oauth.sql`, `vault/src/oauth/*.ts` (new), `vault/src/api/oauth.routes.ts` (new), `vault/src/api/mcp.routes.ts` (bearer tokens), `vault/src/mcp/server.ts` (tool annotations, `get_item`, `get_project_context`, `file_item`), `cloudflare/api-proxy.js` (comment only), `vault/SETUP.md` §6, `render.yml` |
| docs | `docs/vault-hub/wave5/*`, `HANDOVER.md`, `AGENTS.md` (no rule change) |

Not touched: `docs/vault-hub/schemas/*`, any public page.

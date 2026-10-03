# Wave 5 — Decision Log

The Tooler record for the project file you work from, 2 and 3 October 2026.

## Gate 1 (Choice Sheet, `02-choice-sheet.md`)

| # | Decision (verbatim) |
|---|---|
| W5-D1 | "Supabase Storage (Recommended)" — originals in a private bucket of the project that holds the database, shared by the API and the crons |
| W5-D2 | "PDF, images and spreadsheets inline; Word and PowerPoint download (Recommended)" — no server-side conversion |
| W5-D3 | "The full review loop (Recommended)" — open questions first, citation chips, the uncited gate, per-paragraph decisions, save, render, mark as sent |
| W5-D4 | "OAuth in the Vault, Cloudflare Access as the login (Recommended)" — the Vault issues the connector's tokens; Access signs the person in |

## Gate 2 (Markup, `05-markup.md`)

"Approved, build it as written (Recommended)" — four pull requests in order: durable originals, open the original, Write to…, the connector.

## What shipped

| PR | What | Acceptance |
|---|---|---|
| wave 5 PR 1 | Supabase Storage backend over the Storage REST API with the service key and upsert; `openStorage` refuses a container disk on a production server unless a directory is named on purpose; the API opens the store at boot and logs where originals go; the blueprint declares the store on the API and the four crons that write originals; setup §1.5 | W5-AC1: `storage.supabase.test.ts` (put, get, exists, not-found shape, key encoding, the production refusal), `api.items.test.ts` |

| wave 5 PR 2 | `GET /api/items/:id/original` (scope-checked, inline or attachment, `no-store`, `nosniff`, one `item.view` audit event per attempt, earlier versions by number, a named `no_original` 404 for a record whose bytes the store never had); the record panel's View card: PDF.js on canvas with lazy pages and clamped canvas size, images inline, SheetJS tables per sheet with tabs and a 2,000-row cap, Download for the rest, "original missing" or "filed without an original" otherwise; PDF.js and SheetJS vendored under `hub/vendor` with their licences | W5-AC2: `originals.routes.test.ts`; W5-AC3: `hub-record-panel.spec.mjs` with a real one-page PDF, a PNG and a two-sheet workbook as fixtures |

## What the build taught

1. **The live Vault had been losing every original since the first deploy.** `VAULT_STORAGE` defaulted to the filesystem and the Supabase backend was a stub; the extracted text and chunks in Postgres hid it, because Find kept working. A production server now refuses to start without a durable store, so the failure is loud rather than silent.
2. **Supabase answers "not found" as HTTP 400 with `code: NoSuchKey`**, not 404 (its source sends a user status of 400 for every non-500 error). The backend reads the body before deciding a key is absent.
3. **iPad Safari and PDFs.** An embedded PDF shows page one only, so the viewer draws pages on canvas; iOS caps canvas memory, so each page is clamped to four million pixels and drawn only when scrolled into view.

## Deviations from the Markup, stated

1. **A record outside the caller's scope answers 403 from the original route, not 404.** The Markup said "as 404, like the record itself"; the record itself answers 403 (wave 1, `api.items.test.ts`), so the original follows the record. Hidden and unknown records are 404.
2. **PDF.js is the 4.10 legacy build, not the 6.3 build the Vault uses server-side.** The 6.x browser build calls a JavaScript feature (`Map.prototype.getOrInsertComputed`) that the test browser and iPad Safari lack; the legacy build supports Safari 14 and later.

3. **The View card is its own card, not a Related card.** The wave 2 test counts the Related cards; View sits above them with its own `data-view` hook.

## Evidence

- PR 2: `evidence/w5-viewer-pdf.png` (a PDF rendered in the panel with the page counter, zoom and Download), `evidence/w5-viewer-sheet.png` (a workbook as tables with sheet tabs); both captured by the end-to-end spec.

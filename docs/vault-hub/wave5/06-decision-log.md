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

## What the build taught

1. **The live Vault had been losing every original since the first deploy.** `VAULT_STORAGE` defaulted to the filesystem and the Supabase backend was a stub; the extracted text and chunks in Postgres hid it, because Find kept working. A production server now refuses to start without a durable store, so the failure is loud rather than silent.
2. **Supabase answers "not found" as HTTP 400 with `code: NoSuchKey`**, not 404 (its source sends a user status of 400 for every non-500 error). The backend reads the body before deciding a key is absent.

## Deviations from the Markup, stated

(none yet)

## Evidence

(added per PR)

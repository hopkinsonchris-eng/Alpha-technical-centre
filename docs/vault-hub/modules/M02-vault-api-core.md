# M02 — Vault API core

**Wave 1 · Tier B · Depends on: M00, M01 · Size L**

## Purpose
Runs, items, versions, immutability, legal-tag union, project timeline,
audit log. The store of record everything else reads and writes.

## Read first
`../06-architecture.md` §2–4, §6; `../schemas/run-record.schema.json`, `vault-item.schema.json`, `legal-tag.schema.json`; `vault/src/legal.ts` (M00).

## Deliverables
Handlers in `vault/src/api/`:
- `POST /api/runs` validate → resolve legal tag (project default ∪ inputs' tags) → dedupe on `(job, tool_version, input_hash)` → insert → audit. Returns `{id, deduplicated: boolean}`.
- `GET /api/runs/:id`, `GET /api/runs?project=&job=&status=&since=` (scope-filtered through `isVisible`).
- `POST /api/runs/:id/supersede` creates the new run with `supersedes`, marks old `superseded`.
- `POST /api/items` (multipart: original + metadata) → hash bytes → store at `originals/<hash>` if absent → item version 1 or increment when hash differs for the same `origin.external_id`.
- `GET /api/items/:id`, `/versions`, `GET /api/items?project=&type=`.
- `GET /api/projects/:id/timeline` (runs + items merged, newest first, with stale flags), `/lineage` (nodes and edges from `run_inputs` and `item_cites`).
- `POST /api/projects`, `GET /api/projects`, `GET /api/clients`, `GET /api/assets?q=`.
- Soft delete `POST /api/:kind/:id/hide`; `purge` command refuses if cited.
- `vault/src/audit.ts`: `audit(person, action, scope, refs)` on every handler.

## Contract
Request and response bodies are exactly the schemas; errors are `{error: {code, message, path?}}` with 400 (schema), 401, 403 (scope), 404, 409 (immutable).

## Acceptance criteria
1. A RunRecord that fails schema validation is rejected 400 with the JSON path.
2. Two POSTs with the same `input_hash` and version return the same id, second with `deduplicated: true` (AC3).
3. PUT or PATCH on a run or item version returns 409; supersede works and the timeline shows both with the link.
4. An item from a client project without an explicit tag gets the project's default tag; a run whose inputs include a `client-nda` item gets a `client-nda` tag even if posted with `firm`.
5. Every handler writes exactly one audit event.
6. `timeline` for a project with 50 seeded records returns in < 300 ms locally.

## Smoke tests
`vault/test/api.runs.test.mjs`, `api.items.test.mjs`, `api.timeline.test.mjs`, `audit.test.mjs` using the M00 fixtures against a test database.

## Out of scope
Search, embeddings, staleness computation (M08 reads what this writes).

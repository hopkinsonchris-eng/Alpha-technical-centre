# M08 — Staleness engine and re-run

**Wave 2 · Tier A writes the rules and the delta prompt; Tier B implements · Depends on: M02, M05 · Size M**

## Purpose
The core promise (option O1): nothing quietly goes out of date. Compute
staleness nightly, propagate it to documents, replay pinned inputs through
the current version, explain the delta.

## Read first
`../05-innovation-options.md` O1, `../06-architecture.md` §4 F3, `run-record.schema.json` (`inputs[]`, `parents`, `supersedes`), `tool-manifest.schema.json` (`breaking`), `ATC_TOOL.run()` contract (M05).

## Rules (Tier A, frozen here)
A Run is stale when any of:
- R1 `tool_version < aliases.current` and some version in between has `breaking: true`;
- R2 any `inputs[]` of kind `run` refers to a run that is stale or superseded;
- R3 any `inputs[]` of kind `document` or `reference` refers to an item whose latest version's `content_hash` ≠ the recorded `hash`;
- R4 the run's legal tag has expired (hidden, reported separately).
An Item is stale when any ref in `cites[]` is stale or superseded. Staleness is recomputed from scratch each night (no incremental state); each stale record stores `stale_reasons: [{rule, ref, detail}]`. `status: superseded` runs are skipped.

## Deliverables
- `vault/src/jobs/staleness.ts` (idempotent; writes `stale`, `stale_reasons`, and a per-project summary row; audit event with counts).
- `POST /api/runs/:id/rerun`: loads the run, resolves the current tool version, drives the tool headlessly (Playwright against the tool page's `ATC_TOOL.run(params)` for browser tools; the adapter's `/rerun` for external apps), saves the new Run with `parents=[id]`, `inputs` re-resolved to current versions, `status: draft`.
- `vault/src/llm/delta.ts`: prompt (Tier A) that takes both RunRecords and returns `{summary, changes: [{output, before, after, cause_refs[]}]}`; the note is saved as an Item of type `note` citing both runs.
- Anomaly flag: a delta larger than the historical spread of that output for that tool (computed over final runs) sets `facets.review_required: true`.
- `GET /api/projects/:id/stale` for M06/M07.

## Acceptance criteria
1. Fixture: 3 runs, 2 documents; promote the tool to a breaking version; exactly the expected set is stale with the right rule ids (AC4).
2. A non-breaking version change makes nothing stale.
3. Re-run of the Register fixture produces a new Run whose `parents` is the old id and whose outputs differ where expected (AC5).
4. Delta note names every changed headline output and cites both runs.
5. Running the job twice changes nothing the second time.

## Smoke tests
`vault/test/staleness.test.mjs` (rules on fixtures), `rerun.test.mjs` (headless Register), `delta.test.mjs` (prompt output schema-validated; uses a recorded response in CI).

## Out of scope
Search, lessons.

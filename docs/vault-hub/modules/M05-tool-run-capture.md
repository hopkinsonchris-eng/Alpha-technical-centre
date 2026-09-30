# M05 — Tool run capture

**Wave 1 · Tier C per in-repo tool (one session each, against the fixed client contract) · Tier B for the two external APEX adapters · Depends on: M04 · Size M in total**

## Purpose
Every tool writes a Run on Save and can reload any prior Run; the two
external APEX apps push Runs through the same HTTP contract.

## Read first
`js/vault-client.js` (M04), the tool's own page, `tools/<id>/tool.json` (M03), `../schemas/run-record.schema.json`.

## Per-tool deliverable (one PR each)
For each of `opportunity-register.html`, `reservoir-simulator.html`, `ela-studio/`, `ela-model-suite.html`, `financial-modelling.html`, `nodal-analysis-tool.html`, `plan-your-job.html`:
1. Expose `window.ATC_TOOL = { id, getParams(), setParams(p), run(p) → outputs, getInputs() → inputs[], getAssumptions(), ready?() }` so the page can be driven headlessly (needed by M08 re-run). `ready()` is optional: a promise that resolves once late-loading calculator modules are available; without it the runner retries `setParams` while the page reports "not loaded".
2. On the tool's existing Save action, call `vault.saveRun({ job, project_id, legal_tag, asset_ids, inputs, assumptions, params, outputs, status:'draft', title })`. Project is chosen from a small project picker the client library provides (`vault.pickProject()`), remembered per page.
3. A "Runs" drawer listing prior runs for the project (`vault.listRuns`) with "load" and "supersede".
4. Provenance badge (already in the Register) extended to show `tool_version`.
5. The simulator: remove `CLAUDE_KEY_STORE`; route its AI explanation through `POST /api/llm` (stub in M02 that returns 501 until M13; the page degrades gracefully).
6. The Register: replace the localStorage-only `Store` with `vault` in server mode, keep local mode as fallback.

## External adapters (Tier B)
`vault/src/adapters/apex-asset-intelligence.ts` and `apex-3d-model.ts`: document the minimal change in each external app (a POST of a RunRecord to `/api/runs` with an app token issued by M01, plus a `/rerun` endpoint that accepts `params` and returns `outputs`). If the external code cannot be changed in the wave, the adapter polls the app's existing `/api/state` (Asset Intelligence) and materialises Runs from state snapshots, marked `facets.capture: 'snapshot'`.

## Acceptance criteria (per tool)
1. Save produces a Run that validates and includes `tool_version`, `tool_commit`, at least one input or assumption, and every headline output declared in `tool.json` `produces[]`.
2. `ATC_TOOL.run(ATC_TOOL.getParams())` returns outputs equal to the ones just saved.
3. Loading a prior Run reproduces the same outputs (AC2).
4. No provider key in the page (AC12).
5. Existing behaviour and existing tests unchanged when the API is absent.

## Smoke tests
Playwright per tool: open, set a known scenario from `vault/test/fixtures/tools/<id>.json`, save, assert the POST body validates and the drawer lists it; headless `run()` equality test.

## Out of scope
Changing any physics or economics; UI redesign.

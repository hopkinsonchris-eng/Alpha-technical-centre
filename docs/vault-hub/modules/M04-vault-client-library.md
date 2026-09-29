# M04 — Vault client library (`js/vault-client.js`)

**Wave 1 · Tier B · Depends on: M02, M03 · Size M**

## Purpose
The one file every browser tool imports to save and reload runs, resolve the
current version, hash inputs, queue offline, and offer an in-tool Find.

## Read first
`ela-studio/api.js` (the local/server dual-mode pattern to keep), `opportunity-register.html` `Store` object, `../schemas/run-record.schema.json`, `../06-architecture.md` §4 F1–F2.

## Deliverables
`js/vault-client.js` (ES module, no dependencies, works from `file://` in local mode):
```ts
export const vault: {
  mode(): 'server'|'local';                       // /api/me reachable and 200 → server
  me(): Promise<Person|null>;
  resolve(toolId: string): Promise<{entry, modules, version, commit}>;
  canonicalHash(obj: unknown): Promise<string>;   // sha256 of JSON with sorted keys, numbers normalised
  saveRun(partial: Omit<RunRecord,'id'|'created_at'|'author'|'input_hash'|'tool_version'|'tool_commit'>, opts?: {toolId: string}): Promise<{id, deduplicated, queued: boolean}>;
  loadRun(id: string): Promise<RunRecord>;
  listRuns(q: {project?: string; job?: string; status?: string}): Promise<RunRecord[]>;
  supersede(oldId: string, partial: ...): Promise<{id}>;
  find(q: string, scope: string): Promise<SearchHit[]>;   // 501 until M12; local mode returns []
  mountFind(el: HTMLElement, scope: string): void;        // small search box + results list
  flushQueue(): Promise<number>;                          // sends queued runs when back online
};
```
Local mode stores runs under `localStorage['vault_queue_v1']` and lists them with `queued: true`; when `mode()` becomes `server` the queue flushes. `tool_version` and `tool_commit` are filled from `resolve(toolId)`; `author` from `me()`.

## Acceptance criteria
1. `canonicalHash({b:1,a:2}) === canonicalHash({a:2,b:1})`; `1.0` and `1` hash equal; `NaN` throws.
2. In local mode `saveRun` returns `queued: true` and the record is listed by `listRuns`; after a stubbed `/api/me` becomes 200, `flushQueue` posts every queued run once and empties the queue.
3. A run saved with missing required fields is rejected client-side with the JSON path before any network call.
4. `resolve` caches for the page lifetime and refreshes on `visibilitychange`.
5. No dependency on `style.css`; `mountFind` renders with inline minimal styles and the brand tokens.

## Smoke tests
`test/vault-client.test.mjs` (node --test with a fetch stub and a localStorage shim); Playwright test that the Register saves in local mode when the API is down and syncs when it returns.

## Out of scope
Any tool-specific field mapping (M05).

## Usage (as built)
```js
import { vault } from './js/vault-client.js';   // adjust the path; no other dependency

const saved = await vault.saveRun({
  job: 'opportunity-register',                  // tool id from tool.json (also the default toolId)
  project_id: 'firm',
  legal_tag: 'lt-firm-internal',
  inputs: [{ ref: 'ref:price_decks/brent-2026-09', kind: 'reference', version: 3 }],
  params: { discount: 0.1 },                    // the tool's full state, as it would reload it
  outputs: { npv10: { value: 12.5, unit: 'MMUSD' } },
  status: 'draft',
});                                             // -> { id, deduplicated, queued }
```
The client fills `id`, `created_at`, `input_hash` (hash of `{inputs, params, assumptions}`), `author` (from `me()`) and `tool_version`/`tool_commit` (from `resolve(job)`). Missing or malformed fields reject with a message naming the JSON path (for example `Invalid run record: $.project_id is required`, also on `error.path`) before any request is made. Without a reachable `/api/me` the run is queued under `localStorage['vault_queue_v1']` (`queued: true`; `author`, `tool_version` and `tool_commit` are filled at flush) and `listRuns` returns it with `queued: true`. When `/api/me` answers 200 the queue flushes on its own, or call `await vault.flushQueue()`. A queued run the server rejects with a 4xx stays in the queue with an `error` note, and is not resent. From `file://` no request is made.

Also on `vault`: `pickProject(el?)` (project `<select>` from `GET /api/projects`, remembered per page, fires `vault:project` on `el`; without `el` returns the remembered id) and `configure({ apiBase })` (default same-origin `''`; resets mode and caches, keeps the queue). `mountFind(el, scope)` renders a search box with inline styles and brand tokens. `supersede(oldId, partial)` posts to `/api/runs/:id/supersede` and queues offline like `saveRun`.

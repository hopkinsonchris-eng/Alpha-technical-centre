# External app adapters (M05, decision D6)

How the two external APEX apps (Asset Intelligence at `apex-app2.onrender.com`, the 3D model at `apex-3d-model.uk`) get their runs into the vault and back out again. The apps live outside this repo. Everything below was designed against a recorded state fixture (`vault/test/fixtures/apex/state.json`, shaped like `app.html`'s own `/api/state` save), not against the live apps.

There are three routes, best first. Use (a) and (b) where the app can change; (c) is the fallback until it does.

| | What | Direction | Auth |
|---|---|---|---|
| (a) Push | app `POST`s a RunRecord to `<vault>/api/app/runs` on its Save | app to vault | app token, `Authorization: Bearer` |
| (b) Re-run | vault `POST`s `{params}` to `<app>/rerun` and gets `{outputs, inputs?, assumptions?}` | vault to app | bearer token the vault holds (`APEX_AI_TOKEN`, `APEX_3D_TOKEN`) |
| (c) Snapshot | vault polls `GET <app>/api/state` and files one run per saved asset, `facets.capture = 'snapshot'` | vault to app | same bearer token |

## Vault environment

```
APP_TOKENS=apex-asset-intelligence:<secret>,apex-3d-model:<secret>   # what the apps present when they push. Secrets 16+ characters.
APEX_AI_BASE_URL=https://apex-app2.onrender.com                     # enables re-run and snapshot for Asset Intelligence
APEX_AI_TOKEN=<secret>                                              # the vault sends this to the app
APEX_3D_BASE_URL=https://apex-3d-model.uk                           # enables re-run for the 3D model
APEX_3D_TOKEN=<secret>
APEX_AI_PROJECT=firm                                                # snapshot job target project (default firm)
APEX_AI_SINCE=<ISO date>                                            # optional: snapshot only assets saved since then
```

Use a different secret for each variable; generate with `openssl rand -hex 24`. With `APEX_*_BASE_URL` unset, re-running one of that app's runs answers 501 naming the variables to set.

## (a) Push: `POST <vault>/api/app/runs`

Send a RunRecord (`docs/vault-hub/schemas/run-record.schema.json`) with `Authorization: Bearer <the app's APP_TOKENS secret>`.

The vault, not the app, decides identity:

- `job` is forced to the token's tool, so a token for one app cannot write another app's runs. Whatever the body says is overwritten.
- `author` is forced to `app:<tool>` (a `service` person, created on first sight).
- `facets.capture` is set to `'push'` (other facets you send are kept).
- `id` (uuid), `created_at`, `status` (`draft`) and `input_hash` are filled in when omitted. If you send `input_hash`, it must follow the canonical hash in `js/vault-client.js` (sorted keys, hash of `{inputs, params, assumptions}`); simplest is to omit it.
- Validation, legal-tag resolution and dedupe are exactly those of `POST /api/runs`: identical `job` + `tool_version` + `input_hash` answers `200 {deduplicated: true}` and creates nothing. Errors use the same `{error:{code,message,path}}` body (`400` schema, `401` token, `409` conflict).

Required from the app: `tool_version` (x.y.z), `tool_commit` (7 to 40 hex), `project_id` (`firm` for internal work), `legal_tag` (`lt-firm` for internal work; a client project's tag is raised to at least the project default, never lowered), `inputs` (array, may be `[]`), `params` (the app's full input state, as it would reload it), `outputs` (`{name: {value, unit?, low?, high?}}`). Optional: `title`, `asset_ids`, `assumptions`, `client_id`, `tags`.

An app token can do nothing else: it is checked only on this route.

### Minimal change in each app (about ten lines)

Add two env vars to the app: `VAULT_URL` (the vault's public base URL) and `VAULT_APP_TOKEN` (its secret from `APP_TOKENS`). Call this from the app's existing Save handler, after the save has succeeded, and never let it block or break the save:

```js
// Push a run to the ATC Vault. Fire and forget: a vault outage must not affect the app.
async function pushRunToVault({ title, params, outputs, inputs = [], assumptions = {} }) {
  if (!process.env.VAULT_URL || !process.env.VAULT_APP_TOKEN) return;
  try {
    const r = await fetch(`${process.env.VAULT_URL}/api/app/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.VAULT_APP_TOKEN}` },
      body: JSON.stringify({ tool_version: APP_VERSION, tool_commit: APP_COMMIT, project_id: 'firm', legal_tag: 'lt-firm',
                             title, inputs, assumptions, params, outputs }),
    });
    if (!r.ok) console.warn('vault push', r.status, await r.text());
  } catch (e) { console.warn('vault push failed', e.message); }
}
```

(In browser code the same call works, but the token must never reach a browser: call it from the app's server, in the `PUT /api/state` handler or a new `POST /api/save-run`.) `APP_VERSION` and `APP_COMMIT` are the app's own version (Asset Intelligence labels itself v4; the catalog holds `4.0.0` / `7bf455e`) and git commit.

## (b) Re-run: `POST <app>/rerun`

Lets the vault replay a stored run's `params` through the app's current version (the M08 re-run and staleness flow).

Request: `POST <app>/rerun`, `Authorization: Bearer <APEX_AI_TOKEN or APEX_3D_TOKEN>`, body `{ "params": { ... } }`, the `params` object exactly as the app pushed it.
Response `200`: `{ "outputs": { "<name>": {"value": 1, "unit": "m3"} }, "inputs": [...]?, "assumptions": {...}? }`. `outputs` is required and must be an object; `inputs` and `assumptions` are optional and, when omitted, the vault keeps the original run's. Any non-2xx, non-JSON or missing `outputs` is reported to the caller as `502 adapter_failed`.

Minimal change: an endpoint that checks the bearer, loads `params` the way the app loads a saved state, runs the app's existing calculation without any UI, and returns its headline numbers.

```js
app.post('/rerun', express.json({ limit: '5mb' }), (req, res) => {
  if (req.get('authorization') !== `Bearer ${process.env.VAULT_RERUN_TOKEN}`) return res.status(401).json({ error: 'unauthorised' });
  const outputs = calculateHeadlineNumbers(req.body.params);   // the app's own function, no DOM
  res.json({ outputs });                                       // e.g. { stoiip: { value: 48200000, unit: 'm3' } }
});
```

Note: `VAULT_RERUN_TOKEN` in the app is the vault's `APEX_AI_TOKEN` / `APEX_3D_TOKEN` (the app reads what the vault sends). If the calculation only exists in browser code (as in Asset Intelligence's `app.html` today), this needs that code moved out of the page, which is why (c) exists.

A re-run with parameters identical to an existing run of the same tool version dedupes onto that run (the same rule as every tool), so the vault only files a child run when the version or the inputs changed.

## (c) Snapshot fallback (no app change beyond one header check)

For an app that cannot yet push, `src/jobs/apex-snapshot.ts` polls `GET <APEX_AI_BASE_URL>/api/state` and materialises runs from the saved state:

```
cd vault && APEX_AI_BASE_URL=... APEX_AI_TOKEN=... npx tsx src/jobs/apex-snapshot.ts
```

Run it on a Render cron (nightly is enough). It prints a summary (`created`, `deduplicated`, `failed`, and counts of skipped entries) and writes a `jobs` row plus one audit event.

What is mapped (Asset Intelligence): the state is `{state: {arr: {fields, formations, wells, ...}, obj, num}}`. One run per entry of `arr.formations` (a saved asset), with the run's `params = {field, formation}`, `title = "<field> / <formation>"`, `outputs` limited to numbers already in the state and above zero (the app stores 0 for "not computed"): `geometry.STOIIP` as `stoiip`, `geometry.GIIP` as `giip`, `geometry.RF` as `recovery_factor`, `geometry.reserves` as `reserves`, `mbCalc._N_m3` as `mbal_n` (m3). `author = app:apex-asset-intelligence`, `facets.capture = 'snapshot'`, `input_hash` from the canonical hash. Nothing is invented: an entry that is not an object or has no id/name is skipped (`skipped_unknown_shape`), an asset with no headline number yet is skipped (`skipped_no_outputs`), one saved before `APEX_AI_SINCE` is skipped (`skipped_before_since`), and a state that has no `arr.formations` at all fails the job.

Identical snapshots collapse: the run key is job + tool version + input hash, so re-polling an unchanged workspace creates nothing. Because `params` carries the saved-at timestamps the app stores (`mbCalc._when`, `savedForecast.when`), re-saving a formation in the app files a new run even if no number moved; that is the honest record of a save.

The one thing the app must allow: `GET /api/state` today answers to a browser login session (`/login` redirect on 401). The snapshot job cannot log in, so the app has to accept `Authorization: Bearer <APEX_AI_TOKEN>` on that one read-only route (about three lines in its auth middleware), and return the same JSON the browser gets. Also confirm whether `/api/state` is one shared workspace or one per user; the job only sees the one the token maps to.

Snapshot runs go to project `firm` under `lt-firm` by default (`APEX_AI_PROJECT` to change it; the project's default legal tag is used).

## Bypass in `src/app.ts` (needs a maintainer)

`src/app.ts` runs the Cloudflare Access check on every `/api/*` route before any route handler, and the brief for this module did not allow editing it. `POST /api/app/runs` authenticates the app token itself, but until the middleware lets that one path through, a real deployment answers `401 no Access token` before the route runs (tests pass because they use the DEV auth config). Two changes make it live:

1. In `src/app.ts`, inside the `/api/*` middleware, next to the `/api/health` exception:
   ```ts
   if (c.req.path === '/api/app/runs' && /^Bearer\s/i.test(c.req.header('authorization') ?? '')) { c.set('db', db); return next(); }
   ```
   (The route replaces the person itself and rejects a bad token with 401.)
2. In Cloudflare Access, add a Bypass policy (or a Service Auth policy) for `POST /api/app/runs`, so the request reaches the vault at all. The bearer token is then the only credential, so keep the secrets long and rotate by changing `APP_TOKENS`.

## Files

- `src/app-tokens.ts`: `parseAppTokens`, `verifyAppToken(headers, env)` (constant-time), `ensureAppPerson`.
- `src/api/app-runs.routes.ts`: `POST /api/app/runs`.
- `src/adapters/common.ts`, `apex-asset-intelligence.ts`, `apex-3d-model.ts`, `index.ts` (`adapterFor(toolId)`, `adapterEnvVars`).
- `src/jobs/apex-snapshot.ts`: the snapshot job.
- `src/api/rerun.routes.ts`: calls the adapter for external-app tools.

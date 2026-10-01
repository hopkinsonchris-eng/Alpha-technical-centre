# The Hub sidecar: `tools/<id>/hub.json`

The tool manifest (`tools/<id>/tool.json`, schema `docs/vault-hub/schemas/tool-manifest.schema.json`)
is a Tier A contract with `additionalProperties: false`, so what only the Hub needs
lives in a sidecar beside it, owned by the same person who owns the tool. The
Vault validates it when it builds the catalog (`vault/src/catalog.ts`,
`readSidecar`) and refuses the catalog on a bad one, naming the file and the
JSON path; `scripts/build-catalog.mjs` copies it into `hub/catalog.json`.
Both merge it on the catalog entry as `hub`; a tool without a sidecar has
`hub: null`.

```json
{
  "context": ["project"],
  "param": "project",
  "toolbar": 10,
  "version_url": "https://apex-app2.onrender.com/version.json"
}
```

| field | type | meaning |
|---|---|---|
| `context` | array of `project`, `opportunity`, `country` | The contexts the tool accepts. A tool listing `project` appears in the project file's toolbar and opens inside the current project. |
| `param` | query parameter name (`[a-z][a-z0-9_]*`) | The parameter that carries the context id, e.g. `?project=kaz-brownfield`. Browser tools read it through `js/vault-client.js`; external apps receive the same query string. |
| `toolbar` | non-negative integer | Order in the toolbar, lowest first. |
| `version_url` | https URL | For external apps: where the app publishes `version.json`. The Vault reads it at boot and every hour (3 s timeout, in the background) and writes the result into `hub.live_version` as `{version, released_at, checked_at}` or `null`. The Hub shows "published by the app" with that version, or "Version unverified" while the app publishes nothing. |

`live_version` is never read from the file; the Vault owns it.

## What the external app publishes

Serve `GET /version.json` from the app's origin, no authentication, cached
for at most an hour:

```json
{ "version": "4.2.0", "released_at": "2026-09-12" }
```

`version` is required (a non-empty string, ideally semver). `released_at`
is optional, `YYYY-MM-DD`. Anything else is ignored. No CORS header is
needed: the Vault, not the browser, fetches it.

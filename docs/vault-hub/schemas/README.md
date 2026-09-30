# Schema contracts

These seven JSON Schemas are the contracts every module builds against. They are
versioned with the repo; a change to a schema is a Tier A decision (see
`../07-build-plan.md`) and must ship with a migration and updated fixtures.

| Schema | Used by | Notes |
|---|---|---|
| `legal-tag.schema.json` | everything | Classification, data type, contract, expiry. Union-inheritance rule lives in M02. |
| `tool-manifest.schema.json` | M03 registry, M04 client, Hub catalog | `aliases.current` is the only thing links resolve. |
| `run-record.schema.json` | M04 client, M05 tool adapters, M08 staleness, M16 analogues | `inputs[]` with versions is what the staleness engine walks. |
| `vault-item.schema.json` | M09 ingest, M10 email, M11 miners, M13 drafting | `cites[]` propagates staleness to documents. |
| `lesson.schema.json` | M15 lessons | Invalidate, never delete. |
| `analogue-row.schema.json` | M16 analogue memory, M11 extraction | Extend by adding optional properties only. |
| `dispatch.schema.json` | M02 API, M10 sent mail, M13 letters, Hub dispatch form | The record behind "documents previously sent". |

Validate with any Draft 2020-12 validator; the API (M02) validates on write and
CI (M01) validates every fixture in `modules/fixtures/` on every push.

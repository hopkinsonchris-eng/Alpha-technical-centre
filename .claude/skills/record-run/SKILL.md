---
name: record-run
description: Record a calculation, screening or evaluation that a Claude Code session produced as a run in the Alpha Technical Centre Vault, so it is versioned, cited and staleness-tracked like a run saved from a browser tool. Use when the user says "save this as a run", "record this calculation", "put this in the Vault", or when a session has produced numbers that a letter or report will rely on. Posts a RunRecord to POST /api/runs following the vault client library's field rules; never edits or deletes an existing run.
---

# Record a run

A run is one execution of a tool or calculation: what went in, the assumptions and where each came from, what came out. Runs are **immutable**. To correct one you supersede it; you never overwrite it. Browser tools save runs through `js/vault-client.js`; this skill does the same from a Claude Code session, with the same rules.

## When to record one

Record when the session produced numbers someone will rely on (a screening result, an NPV, a decline fit) and you can state the tool, the inputs and the assumptions. Do not record scratch work, or anything you cannot describe fully enough for a colleague to reproduce it.

## Gather the fields

Read the tool's manifest first: `get_tool_current` (MCP) or `GET $VAULT_URL/api/tools/<id>/resolve` gives the current `version` and `commit`, and `tools/<id>/tool.json` names the outputs (`produces`) the tool declares.

| Field | Rule |
|---|---|
| `id` | a new lower-case UUID (`crypto.randomUUID()`); the server refuses a reused one (409, runs are immutable) |
| `job` | the tool id from `tool.json` (for example `opportunity-register`); a session-only calculation still needs an id that exists in the catalog |
| `tool_version`, `tool_commit` | from the resolve call: `x.y.z` and 7 to 40 hex characters. Never invent them; a run cites the exact code that produced it |
| `author` | your own Person id (`GET /api/me`). An associate can only save under their own name |
| `created_at` | now, ISO 8601 |
| `project_id` | the engagement id, or `firm` for internal work. The project's client is applied by the server; an associate must be a member |
| `legal_tag` | the tag you believe applies (`lt-...`); the server raises it to the union of the project default and every input's tag and never lowers it |
| `title` | short and specific, for the timeline |
| `inputs` | every record the run depended on, each `{ref, kind, version?, hash?, role?}`. `ref` is `run:<uuid>`, `doc:<uuid>`, `ref:<set>/<id>` or `tool:<id>`; `kind` is one of `run`, `document`, `reference`, `asset`, `manual`. Staleness is computed from this list, so leave nothing out. Use `manual` for figures typed in by a person |
| `assumptions` | optional object; each entry `{value, source, unit?, provenance?}`. **`source` is required** (a Vault ref, a URL, `analogue` or `client-stated`); `provenance` is `measured`, `client-stated`, `analogue` or `assumed` |
| `params` | the tool's whole input state as an object, enough to reload the tool exactly |
| `outputs` | headline numbers keyed by the names in `produces`; each `{value, unit?, low?, high?}`; `value` is required |
| `input_hash` | `sha256:<64 hex>` of the canonical form of `{inputs, params, assumptions}` (see below). Identical inputs on the same tool version collapse onto the first run and the answer says `deduplicated: true` |
| `status` | `draft`, `reviewed` or `final`. Start at `draft`; only a reviewer moves it on |
| `parents` | optional array of run ids this one was derived or re-run from |
| `artifacts` | optional `doc:<uuid>` refs of files the run produced (file them first through `POST /api/items`) |

Do not send `supersedes` on a new run, and do not send a status of `superseded`; the supersede endpoint sets both.

## Hash the inputs

Canonical form means keys sorted at every level, no whitespace, numbers and strings as JSON, `undefined` skipped; `assumptions` is `{}` when absent. This matches `canonicalHash` in `js/vault-client.js`:

```bash
node -e '
const c=v=>v===null?"null":Array.isArray(v)?"["+v.map(x=>x===undefined?"null":c(x)).join(",")+"]":typeof v==="object"?"{"+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+":"+c(v[k])).join(",")+"}":JSON.stringify(v);
const r=JSON.parse(require("fs").readFileSync(0,"utf8"));
console.log("sha256:"+require("crypto").createHash("sha256").update(c({inputs:r.inputs,params:r.params,assumptions:r.assumptions||{}})).digest("hex"));' < run.json
```

## Post it

Show the user the record (title, inputs, assumptions with sources, outputs) and get agreement, then:

```bash
curl -sS -X POST "$VAULT_URL/api/runs" -H 'content-type: application/json' -d @run.json
```

- `201 {id, deduplicated:false}`: saved. Report the id; cite it as `[run:<id>]`.
- `200 {id, deduplicated:true}`: an identical run already exists; use that id and say so.
- `400`: a field is wrong; the error `path` says which (`/assumptions/price/source`, `/tool_commit`). Fix it and post again with a fresh `id`.
- `403`: you are not a member of the project, or the record is outside your scope.
- `409` `immutable`: that `id` exists. To correct a saved run, post the corrected record to `POST /api/runs/<old-id>/supersede` (same project; the old run becomes `superseded`, the history stays). `409` `legal_tag_conflict`: the inputs belong to two clients; split the work.

The Vault does not run the tool for you: `outputs` are numbers you computed and must be able to reproduce. To re-run a saved run in the tool itself, use `POST /api/runs/<id>/rerun`.

## What not to do

- Do not `PUT`, `PATCH` or `DELETE` a run (409); do not hide a run to hide an error.
- Do not put a client's name or confidential figures in `title` or `tags` of a run under a public or firm tag; the tag follows the inputs, and a title is shown wherever the run is listed.
- Do not record a run with an assumption whose source you cannot name. Say `assumed` and explain, so a reviewer sees it.
- Do not record lessons here. A finding worth keeping goes through the `record-lesson` skill.

---
name: draft-with-vault
description: Draft an email, letter, report section or calc note for an Alpha Technical Centre project from the Vault's own records, with every factual sentence cited, then put it on letterhead. Use when the user says "draft a letter", "write to <client>", "reply to this email", "write up the results", "draft the report section" or "calc note" for a project that has runs or documents in the Vault. Calls the company MCP `draft` tool, renders through POST /api/render, and never states a figure the Vault cannot cite.
---

# Draft with the Vault

The Vault assembles the context (project, counterparty, correspondence so far, contracts in force, the project's runs, lessons, and who worked on the topic) under the project's own scope, and refuses to let an uncited figure through. You add the judgement: the brief, the answers to its questions, and the review.

## Before you start

1. Identify the **project id** (`vault://projects/<id>/summary.md` shows the counts, last activity, stale records and contacts; or `GET $VAULT_URL/api/projects`). Drafting needs write access to the project: partners, or associates who are members.
2. Identify the **counterparty** (`organisation_id`) if the letter or email goes to someone other than the project's client. Omit it for the client.
3. Write a **brief** of one to three sentences: what the reader must know or decide, and the tone if it matters. Do not paste figures into the brief; the drafting tool finds them in the Vault so they carry citations. Minimum eight characters.

## Draft

With the company MCP server connected (`.mcp.json` at the repo root, server `atc-vault`), call `draft`:

| Argument | Meaning |
|---|---|
| `kind` | `email`, `letter`, `report-section` or `calc-note` |
| `project_id` | the engagement id; the search scope is `project:<project_id>` and cannot be widened |
| `brief` | what the piece must do |
| `organisation_id` | optional counterparty; defaults to the project's client |
| `language` | optional, `en` (default) or `es` |

Without the MCP server, `POST $VAULT_URL/api/draft` takes the same fields as JSON.

The answer holds `id`, `draft`, `paragraphs`, `citations`, `sources`, `who_to_ask`, `warnings` and `questions`. The assembled context is deliberately not returned. The draft is saved as a note in the project (`id` is its item id), so it appears on the timeline and takes part in staleness checks.

## What the markers mean

- `[run:<id>]` the sentence rests on that run's outputs (a calculation). Open it with `get_run` and check the number and its status: a `draft` run is not a basis for a letter to a client; a stale run (its inputs changed since) needs a re-run first.
- `[doc:<id>]` the sentence rests on a filed document: an earlier letter, an NDA, a contract, a note. Check the date and that it is the current version.
- `[lesson:<id>]` a confirmed firm lesson shaped the wording. It is guidance, not a fact about the counterparty.
- `[ref:<id>]` a reference set (price deck, fiscal terms).
- `[QUESTION FOR YOU: ...]` a sentence carried a figure with no record in scope to cite, so it was withheld and turned into a question. Answer it yourself from a source you can name, then either record that source in the Vault first (a run or a filed document) and draft again, or write the sentence and mark it as unsupported when you hand it over. Never delete the marker and leave the number uncited.
- A citation outside the project's scope is removed and reported in `warnings`; do not restore it.

`warnings` and `who_to_ask` are for you: a skeletal draft (nothing found in scope), stale sources, and the colleagues who last worked the topic.

## Review before it goes out

1. Read every cited record for the sentence that cites it. The check that a citation exists is the Vault's; the check that it says what the sentence says is yours.
2. Resolve every `[QUESTION FOR YOU: ...]`.
3. Confirm language, salutation and signatory. Letters are signed by the person calling, not by the assistant.
4. Tell the user what you could not support and what you assumed. Do not smooth this over.

## Render

Letters and formal emails go on letterhead through the API (not the MCP server):

```bash
# HTML preview (default): {html, reference_no}
curl -sS -X POST "$VAULT_URL/api/render" -H 'content-type: application/json' \
  -d '{"draft_id":"<id from draft>","subject":"Proposed scope of the joint evaluation"}'

# Word or PDF download
curl -sS -X POST "$VAULT_URL/api/render?format=docx" -H 'content-type: application/json' \
  -d '{"draft_id":"<id>","subject":"..."}' -o letter.docx
```

The render reserves the reference number once (`ATC-<year>-<n>`, reused on every later render of the same draft), fills the counterparty block, previous correspondence and signatory, and strips the citation markers and any unanswered questions from the output unless you pass `"keep_citations": true` (useful for an internal review copy). `their_reference`, `confidentiality_note` and `organisation_name` (when the draft has no organisation) are optional body fields. PDF needs a Chromium on the server and answers 503 without one; use DOCX then.

After sending, file the sent letter with its dispatch record (`POST /api/items`, then `POST /api/dispatches`) so the next draft sees it in the correspondence history.

## What not to do

- Do not add figures to the draft text yourself; put the source in the Vault, then draft.
- Do not call `search_vault` in a wider scope to find "more evidence" for a project draft. The scope is the confidentiality boundary.
- Do not paste one client's material into another client's draft. The draft tool cannot see it; do not route around that.
- Do not treat a draft as sent. It is a note until a person files the final version.

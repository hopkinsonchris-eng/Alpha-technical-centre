---
name: record-lesson
description: Record a lesson learned during a Claude Code session in the Alpha Technical Centre repo as a cited, structured lesson in the Vault. Use when the user says "record a lesson", "remember this for next time", "we should not do that again", or after a mistake, correction or discovery that a colleague on another job would want to know. Proposes the lesson for partner review; it never writes to the firm-wide index itself.
---

# Record a lesson

A lesson is a short, actionable claim with evidence, a scope and a confidence. It enters the Vault as `proposed`; a partner confirms it, and only then does it appear in `vault/firm/LESSONS.md` and in every future session's context.

## When to record one

Record when the session produced something a colleague would act on: a tool that behaved unexpectedly, a source that proved unreliable, a check that would have caught an error, a convention the user corrected. Do not record: task progress, preferences about tone, anything already in `vault/firm/LESSONS.md` (check it first; it is in your context at session start), or anything you cannot cite.

## Steps

1. **Check for a duplicate.** Read the injected LESSONS.md, or `GET $VAULT_URL/api/lessons?scope=<scope>` for the scope you have in mind. If a lesson already says it, say so to the user instead of adding another; if it needs refining, propose the refinement as a new lesson with the better wording and tell the user which id it refines, so a partner can supersede the old one.
2. **Find the evidence.** At least one reference that exists in the Vault or this session:
   - `run:<uuid>` a run record that shows it (`GET /api/runs`)
   - `doc:<uuid>` a filed document, letter, note or draft
   - `transcript:<id>` this session (use the session id shown by the harness, for example `transcript:session_01Cjvnf4...`)
   A lesson with no evidence is refused. Never invent a reference; the API rejects `run:` and `doc:` ids that do not exist.
3. **Draft the lesson** and show it to the user before posting:
   - `claim` (at most 400 characters): what to do or avoid, written so it makes sense without this conversation, with no client, well or person names unless the scope is that client's own.
   - `detail`: what was intended, what happened, why, what to do next time.
   - `scope` and `scope_id`: `project:<id>` if it holds only for one job (the safe default), `client:<id>`, `tool:<id>`, `discipline:<name>`, or `firm`.
   - `disciplines`: for grouping in the index, e.g. `["reservoir"]`.
   - `confidence`: 0 to 1.
4. **Post it** once the user agrees:

```bash
curl -sS -X POST "$VAULT_URL/api/lessons" -H 'content-type: application/json' -d '{
  "claim": "Confirm the datum before comparing well tops from two sources; a 12 m offset looked like a fault.",
  "detail": "Intended: overlay tops. Happened: apparent fault. Why: one source used KB, the other MSL. Next time: state the datum in the header of every tops table.",
  "scope": "discipline", "scope_id": "geology", "disciplines": ["geology"],
  "evidence": ["transcript:<session-id>", "doc:<uuid>"], "confidence": 0.7
}'
```

With the company MCP server connected, call `record_lesson` with the same fields instead.

5. **Read the answer.**
   - `201`, `status: proposed`: done. Tell the user the lesson id and that a partner confirms it in the Hub queue.
   - `400`: a field is wrong (the `path` says which); fix and retry.
   - `403`: the evidence is under a client NDA and the scope is `firm`, `discipline` or `tool`. Client content reaches firm scope only through a partner's sanitised confirmation. Re-post at `project` or `client` scope, or ask the user to run the project-closeout skill so a sanitised method note is written.
   - `409`: the evidence spans two clients' confidential records; split it into one lesson per client.

## What not to do

- Do not post `"status": "confirmed"`. Only a partner's own post is honoured; anyone else's is stored as `proposed` regardless.
- Do not set `legal_tag`, `author` or `sanitised` to get around a refusal; the server derives the tag from the evidence and ignores them, and `sanitised` counts only when a partner confirms it.
- Do not edit `vault/firm/LESSONS.md` or `vault/firm/lessons.json`; they are generated.

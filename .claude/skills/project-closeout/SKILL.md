---
name: project-closeout
description: Close out a finished project or milestone for Alpha Technical Centre. Runs the four-question after-action review, records each finding as a cited lesson through POST /api/lessons, and drafts a sanitised method note as the only route by which client content becomes firm knowledge. Use when the user says "close out", "wrap up", "after-action review", "AAR", "what did we learn", or when a project is being marked closed.
---

# Project close-out

Turns a finished project into reusable firm knowledge: a few cited lessons and one sanitised method note. Nothing here is written to the firm-wide index until a partner has confirmed it.

## Before you start

1. Identify the project id (`GET /api/projects`) and read its record: runs, correspondence, notes and drafts (`GET /api/projects/<id>/timeline`, `GET /api/runs?project=<id>`). Every lesson must cite records you have actually read.
2. Note the project's client and legal tag. If the project is under a client NDA, everything you write stays under that client's tag until the last step, and no lesson may be firm scope on your say-so (the API refuses it with 403).
3. API base: `$VAULT_URL` (in development `http://localhost:8787` with `DEV_USER_EMAIL` set; in production the Hub's Cloudflare Access session or service token). When the company MCP server is connected, use its `record_lesson` tool instead of `curl`; the fields are the same.

## The four questions

Ask them of the person closing the project, in this order, and draw the answers from the record first so they only have to correct you. Keep each answer to a few sentences.

1. **What did we intend to happen?** The objective, the plan, the assumptions and the headline numbers we expected (cite the runs that set them).
2. **What actually happened?** What was delivered, what moved, where the results differed (cite runs, re-run deltas, letters).
3. **Why was there a difference?** The contributing factors, including anything the client, data or tool caused. Facts, not blame.
4. **What should we do next time?** One recommendation per finding: something to sustain, something to change.

## Record the lessons

Each finding worth keeping becomes one lesson. Aim for two to five, not twenty.

- `claim`: one or two actionable sentences (at most 400 characters). Write it so a colleague on another job can act on it without knowing this client.
- `detail`: the four answers in short form (intended, happened, why, next time).
- `scope`: `project` by default (`scope_id` = project id). Use `client` only for a point about that client, `tool` for a tool's behaviour (`scope_id` = tool id), `discipline` for craft practice (`scope_id` = discipline). Propose `firm` only through the method note below.
- `disciplines`: e.g. `["reservoir"]`.
- `evidence`: at least one of `run:<uuid>`, `doc:<uuid>`, `transcript:<id>`. They must exist and be visible to you; the lesson's legal tag becomes the union of theirs.
- `confidence`: 0 to 1, honestly.

```bash
curl -sS -X POST "$VAULT_URL/api/lessons" -H 'content-type: application/json' -d '{
  "claim": "Screen extra-heavy plays with measured viscosity at reservoir temperature; analogue values understated the Cubiro case by half.",
  "detail": "Intended: screen 8 analogues. Happened: 3 cP assumed, 6 cP measured, potential fell 18%. Why: no measured data requested up front. Next time: ask the operator for PVT before the first run.",
  "scope": "project", "scope_id": "<project-id>", "disciplines": ["reservoir"],
  "evidence": ["run:<uuid>", "doc:<uuid>"], "confidence": 0.8
}'
```

The response is `201` with status `proposed`; a partner confirms it in the Hub queue (or posts `"status": "confirmed"` themselves). A `403` means the evidence is under a client NDA and the scope you asked for is firm-wide: drop to `project` scope and use the method note.

## The sanitised method note

A method note is the redacted description of what we did and how, with everything client-identifying removed. It is the only way client-derived knowledge reaches firm scope.

1. Draft it as plain prose in the conversation (do not create a file in the repo): title, the problem class in generic terms, the method we used, the pitfalls, what to do next time. Roughly one page.
2. Remove: client, counterparty and person names; project, field, well, block and licence names; company-specific numbers, dates and prices; anything that lets a reader identify the client. Replace with generic descriptions ("a heavy-oil operator in the Llanos", "a mid-size waterflood").
3. Show the draft to a partner. Do not file it, and do not describe a lesson as sanitised, until they have approved the wording.
4. File it as a firm item, citing no client record (citing one would raise its tag back to the client's):

```bash
curl -sS -X POST "$VAULT_URL/api/items" -H 'content-type: application/json' -d '{
  "type": "note", "title": "Method note: measured viscosity in extra-heavy screening",
  "project_id": "firm", "legal_tag": "lt-firm", "origin": {"source": "assistant"},
  "content_hash": "sha256:<64 hex characters: sha256 of the note text>", "tags": ["method-note"],
  "extracted": {"kind": "method-note", "text": "<the sanitised note>"}
}'
```

5. If the method note supports a firm-wide lesson, the partner confirms the matching lesson as sanitised: `POST /api/lessons/<id>/confirm` with `{"sanitised": true, "claim": "<the sanitised claim>"}`. That re-tags it `lt-firm` and adds it to `vault/firm/LESSONS.md`. Only a partner can do this.

## Finish

Report to the user: the lessons proposed (id, claim, scope), the method note item id, and what still needs a partner (confirmations, sanitising sign-off). Never edit `vault/firm/LESSONS.md` by hand; it is generated on confirmation.

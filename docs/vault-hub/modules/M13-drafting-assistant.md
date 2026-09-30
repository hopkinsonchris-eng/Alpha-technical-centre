# M13 — Drafting assistant

**Wave 4 · Tier A writes the prompts and the citation contract; Tier B implements · Depends on: M12 · Size M**

## Purpose
"If I need to send an email, write a report, do some calculations, everything
should be taken into account." A draft with citations, never a send.

## Read first
`../05-innovation-options.md` O4, `../06-architecture.md` §4 F5, M12 contracts, `.claude/skills/humaniser/SKILL.md` (house style), Gmail `create_draft` and Zoho Mail draft APIs.

## Deliverables
- `POST /api/draft {kind: 'email'|'letter'|'report-section'|'calc-note', project_id, brief, thread_id?, organisation_id?, language: 'en'|'es', tone?}`.
- Letter kind (R2): context always includes the counterparty file from `GET /api/organisations/:id/file` (contacts and addresses, every dispatch in both directions with dates and references, contracts and NDAs in force, open items), the relevant runs and evaluations, the current letterhead and letter template, the signing partner's block and the house style; the draft carries a "previous correspondence" block listing each prior document with its date and reference, reserves the next reference number, and is rendered by `POST /api/render` to DOCX (template merge) and PDF (headless LibreOffice) on letterhead; saved as an Item with `organisation_ids`, `reference_no` and a pending Dispatch completed when the letter is marked sent.
- `vault/src/llm/draft.ts`: (1) decompose brief into ≤ 6 sub-queries; (2) `search` each in scope; (3) assemble context: 5–7 top hits with anchors, the RunRecords they cite (headline outputs and assumptions), current lessons in scope, the thread if `thread_id`, and the colleague who last worked the topic; (4) draft with inline citations `[run:<id>]`, `[doc:<id>#anchor]`, `[lesson:<id>]`; (5) post-check: every sentence containing a number or a claim of fact must carry a citation that resolves in scope, else the sentence is rewritten as a question to the author; (6) return `{draft, citations[], sources[], who_to_ask[], warnings[]}`.
- Calc-note kind: produces a basis note (method, data relied on, data accepted as represented, assumptions with sources, tool version) from a RunRecord, PRMS §1.2.0.12 shape.
- Outputs: Hub `hub/draft.html` (Tier C), Gmail draft (existing connector pattern) or Zoho draft, never send; saved as an Item of type `note` with `cites[]` so it participates in staleness.
- `POST /api/llm` for tools: scoped, logged, prompt-cached; used by the simulator's explanation.
- Provider interface with Anthropic implementation and a recorded fake for tests; prompt caching on the stable prefix; token counts written to the audit event.

## Acceptance criteria
1. Every factual sentence in 40 gold-set drafts carries a resolving citation (AC9 part 1).
2. RAGAS on the gold set: faithfulness ≥ 0.85, context precision ≥ 0.7 (AC9 part 2), run in CI on index changes with recorded provider responses.
3. A brief for project A never produces a citation outside A's scope (extends AC6 to the draft).
4. The Spanish draft passes the house bilingual review (no untranslated fragments).
5. A calc note for a fixture run lists every assumption with its source and the tool version.
6. AC15: the letter draft for the seeded prospective partner lists all six prior dispatches with correct dates and references, names the NDA, renders on the current letterhead with a reserved reference number, and the test passes with network access restricted to the API origin.

## Smoke tests
`vault/test/draft.citations.test.mjs`, `draft.letter.test.mjs`, `render.test.mjs`, `eval/ragas.yml` + `eval/gold/*.json` (40 partner-written questions; start with 15 and grow), `draft.calcnote.test.mjs`.

## Out of scope
Sending mail; long-form article generation (radar skill).

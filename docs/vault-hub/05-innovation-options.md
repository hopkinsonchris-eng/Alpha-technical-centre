# Phase 4 — Innovation Options

Four responses to the gap. Each is checked against the AI-leverage list:
(i) an LLM reasoning over our own data, (ii) pattern or anomaly detection the
eye would miss, (iii) optimisation of parameters humans set by habit,
(iv) first-draft generation a human then edits.

## O1 — Stale-aware, self-updating vault   **RECOMMENDED**

Every run carries `inputs[]` with versions and the tool version that produced
it; every document records which runs, evaluations and reference sets it
cites. A nightly job walks the graph and marks anything downstream of a change
as stale: the run, the evaluation, the letter, the email. The Hub shows the
stale set per project, offers "re-run with current version" (the pinned inputs
are replayed through the tool headlessly), and shows the delta in headline
numbers.
- (i) The LLM writes the explanation of the delta ("NPV10 moved −8% because the
  fiscal terms file changed royalty from 8% to 12%") from the two run records.
- (ii) Anomaly detection on deltas: a change that moves a result more than the
  historical spread for that tool is flagged for review before anyone quotes it.
- (iii) The job learns which inputs actually move results and orders the review
  queue by impact.
- (iv) First-draft "revised figures" note to the client, citing both runs.
Why recommended: it is the gap itself. Every other option gets more valuable
once staleness is a property of the system, and it is cheap because it is a
graph walk over records the tools already write.

## O2 — Compounding analogue memory

Every evaluation emits an `analogue_row` (≈60 fixed attributes keyed to
Basin/Field master IDs) and a basis note. Mined papers and regulator feeds are
extracted into the *same* row schema, so our own evaluations, the literature
and public production data form one analogue table.
- (i) LLM extraction of paper facts (lithology, mechanism, recovery factor,
  key numbers) with evidence quotes; LLM-written basis notes from the run.
- (ii) "Find similar" across the table (normalised numeric distance plus
  categorical match) surfaces fields we evaluated three years ago that a
  partner has forgotten.
- (iii) Analogue defaults in `js/analogues.js` are auto-proposed from the table
  instead of typed by habit, with provenance badges (already a house pattern).
- (iv) First-draft "analogue section" of an evaluation.
Depends on O1's run record; second wave.

## O3 — Lessons that dream

Lessons are structured objects (claim, scope, evidence links, validity,
confidence). A weekly Batch job reads the week's transcripts, runs and
correspondence and proposes new or updated lessons into a partner review queue;
approved lessons enter a small core index that is injected into every drafting
context and every Claude Code session in this repo.
- (i) Consolidation and contradiction detection over our own record.
- (ii) Recurrence detection: the same issue appearing on a third project is
  promoted from project scope to firm scope automatically.
- (iii) Decay: lessons unconfirmed for twelve months fall in rank and are
  queued for re-confirmation.
- (iv) The drafted lesson itself, with citations.
Cheap to run (Batch pricing), but only pays off once O1 and the ingest
pipeline give it something to read; third wave.

## O4 — Scope-gated drafting assistant on a company MCP server

One retrieval gateway with a mandatory scope; a drafting service that
decomposes the task into sub-queries, pulls 5–7 cited sources plus the
colleague who last worked the topic, and drafts the email, report section or
calculation note with citations back to vault paths. Exposed in the Hub, as a
Gmail/Zoho draft, and as an MCP server so Claude Code, claude.ai and Cursor use
the same store.
- (i) The whole feature is an LLM reasoning over our own data.
- (ii) Coverage jobs (every document in scope × one structured question) for
  "have we ever seen X" rather than top-k similarity.
- (iii) Retrieval parameters (chunking, fusion weights, rerank depth) tuned
  against the RAGAS gold set rather than set once.
- (iv) Every output is a first draft with citations a partner edits.
This is what every firm is building; it is necessary but not the
differentiator. It is the spine that O1–O3 hang off, so it is built in wave 4
on top of the ingest pipeline.

## Recommendation

Build O1 as the core promise, in the order O1 → O2 → O3 → O4 by wave, with the
run record and legal tag (wave 0–1) as the foundation all four share. Marking
O1 recommended does not defer O4: the Markup in `06` includes all four, and
`07-build-plan.md` sequences them.

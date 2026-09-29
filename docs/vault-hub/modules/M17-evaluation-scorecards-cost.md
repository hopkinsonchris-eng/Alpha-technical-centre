# M17 — Evaluation, scorecards and cost

**Wave 4 · Tier B for evaluation harness, Tier C for pages · Depends on: M12–M15 · Size S**

## Purpose
Know whether retrieval and drafting are getting better or worse, show every
project's health against the rules that matter, and keep model spend visible.

## Read first
`../02-practice-scan.md` P11 (RAGAS), Appendix A "Catalog and scorecards", `../06-architecture.md` §9 AC14.

## Deliverables
- `eval/`: gold set format `{question, scope, expected_refs[], expected_answer}`; runner that executes search and draft with recorded provider responses; RAGAS metrics (faithfulness, context precision, context recall, response relevancy) written to `eval/results/<date>.json`; CI job on changes under `vault/src/gateway`, `vault/src/ingest`, `vault/src/llm`, failing below the thresholds in M13.
- Scorecards `vault/src/scorecards.ts`: rules per project, each returning pass/fail with refs: "every final run uses the current tool version", "every evaluation has a basis note", "every letter cites at least one run", "no stale document older than 7 days", "no unfiled correspondence older than 3 days", "legal tags not expiring within 30 days without a renewal note". Red/amber/green per project on the Today page and `hub/project.html`.
- Cost page `hub/cost.html`: tokens and USD per feature (draft, extraction, dream, delta, contextual chunking) from audit events, per week; infrastructure line items entered by hand in settings; alert when a feature exceeds its monthly budget.
- Token accounting: every provider call records model, input, cached, output tokens and computed cost in the audit event (M13 already writes counts).

## Acceptance criteria
1. The eval runner reproduces identical scores on two runs with recorded responses.
2. A deliberate regression (disable rerank) drops context precision below threshold and fails CI.
3. Scorecard rules produce the expected pass/fail on the fixture project.
4. The cost page totals equal the sum of audit-event costs for the period.
5. Infrastructure cost line stays ≤ USD 60 in the seeded settings (AC14 assertion is on the displayed number).

## Smoke tests
`eval/test/runner.test.mjs`, `vault/test/scorecards.test.mjs`, Playwright for the cost page.

## Out of scope
Billing integrations with Render or Supabase APIs.

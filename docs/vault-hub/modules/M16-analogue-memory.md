# M16 — Analogue memory

**Wave 4 · Tier B · Depends on: M05, M11 · Size M**

## Purpose
Every evaluation, paper and regulator snapshot becomes a row in one analogue
table; find-similar and proposed defaults with provenance.

## Read first
`../05-innovation-options.md` O2, `analogue-row.schema.json`, `js/analogues.js` and `js/potential.js` (existing provenance badges and play types), `../02-practice-scan.md` P7.

## Deliverables
- `vault/src/analogues/emit.ts`: on every Run whose tool declares `produces` evaluation outputs (Register technical potential, ELA, financial model), build an AnalogueRow from `params`, `assumptions` and `outputs` with per-property provenance; on every paper or feed Item with `extracted.paper_facts`, map to a row (M11 supplies the facts).
- `GET /api/analogues/similar?asset=<id>|row=<json>&k=10`: distance over normalised numeric properties present in both rows plus categorical agreement (lithology, drive, fluid type, environment); results carry the source ref and legal tag; scope-filtered through M12's predicate.
- `GET /api/analogues/defaults?play_type=`: low/mid/high per input from rows in scope, with counts and provenance mix; `js/analogues.js` gains an optional loader that overlays these on the static defaults and badges them `analogue (n=…)`.
- Hub `hub/analogues.html` (Tier C): table, filters, similar-to-this, export CSV.
- Basis note generation hooks into M13's calc-note kind.

## Acceptance criteria
1. Every evaluation Run in the fixture emits a row that validates, with provenance on each numeric (AC11 part 1).
2. `similar` returns the seeded nearest field first and never a row outside scope (AC11 part 2).
3. Defaults for `carbonate-waterflood` computed from 12 fixture rows match hand-calculated P10/P50/P90 within rounding.
4. The Register with the loader enabled shows the analogue count badge and the existing `test/potential.test.mjs` stays green.
5. Paper-derived rows are marked `provenance: paper` and never `own-evaluation`.

## Smoke tests
`vault/test/analogues.emit.test.mjs`, `analogues.similar.test.mjs`, `analogues.defaults.test.mjs`, Playwright for the page.

## Out of scope
Changing the calculators' physics.

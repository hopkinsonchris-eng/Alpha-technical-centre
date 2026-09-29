# M15 — Lessons and the weekly dream

**Wave 4 · Tier A writes the consolidation prompt and decay rules; Tier B implements · Depends on: M09, M13 · Size M**

## Purpose
Learning crosses projects because lessons are structured, cited, reviewed,
decayed and always in context.

## Read first
`../05-innovation-options.md` O3, `lesson.schema.json`, `../02-practice-scan.md` P10, Anthropic Managed Agents "Dreams" and Batch API docs.

## Deliverables
- Lessons endpoints: `GET /api/lessons?scope=`, `POST /api/lessons`, `POST /api/lessons/:id/confirm|reject|invalidate` (invalidate sets `valid_to` and `superseded_by`, never deletes).
- `vault/src/jobs/dream.ts` weekly, Batch API: input = the week's runs, re-run deltas, filed correspondence, assistant transcripts and existing lessons in the same scopes; output = proposed new lessons and proposed updates (each with `evidence[]` ≥ 1 and a `confidence`); duplicates merged by claim similarity; contradictions flagged with both ids. Never modifies confirmed lessons directly.
- Recurrence: a project-scope lesson observed on a third distinct project is proposed for `firm` scope with `sanitised: false` until a partner edits it.
- Decay: at retrieval, rank multiplied by a factor that falls after 12 months without `last_confirmed`; lessons past 12 months are queued for re-confirmation.
- `vault/src/jobs/lessons-index.ts`: regenerates `vault/firm/LESSONS.md` (≤ 200 lines, grouped by discipline, each line a claim with its id) on every confirmation; committed by a bot PR so it is reviewable and injected by the M14 hook.
- Hub queue section for proposals (M06 already renders the section).
- Legal tag on every lesson inherited from its evidence; a lesson with `client-nda` evidence cannot be `firm` scope unless `sanitised: true` and confirmed by a partner.

## Acceptance criteria
1. On a seeded week the dream proposes ≥ 1 lesson with evidence, and a duplicate of an existing confirmed lesson is merged, not duplicated (AC10 part 1).
2. Confirming a lesson regenerates `LESSONS.md` containing it within the same job.
3. An attempt to set `firm` scope on an unsanitised NDA-evidenced lesson is rejected 403.
4. A lesson unconfirmed for 13 months ranks below an equal lesson confirmed last week and appears in the re-confirmation queue.
5. Invalidating a lesson keeps it readable by id and hides it from `get_lessons`.

## Smoke tests
`vault/test/dream.test.mjs` (recorded Batch output), `lessons.api.test.mjs`, `lessons.index.test.mjs`.

## Out of scope
Free-text wiki pages.

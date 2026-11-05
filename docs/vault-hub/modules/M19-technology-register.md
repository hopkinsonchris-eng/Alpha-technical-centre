# M19 — Technology register

**Wave 10 · Tier B · Depends on: M02, M12, M14, M15 (review pattern) · Size M**

## Purpose
A curated, sourced register of field technologies, split by application area: artificial lift, water handling,
IOR/EOR, well intervention, integrity and emissions/power to start with. Each technology is ranked on four
separate scores:
- how often the technical literature cites it;
- its cost-benefit;
- how strong and independent the evidence is;
- how well it fits a project.

Projects draw shortlists from the register by matching their own conditions against each technology's operating
window, and they record which technologies they suggest, shortlist or dismiss. Entries are firm knowledge built
only from public sources. They are proposed, and they reach the register only when a partner confirms them, the same
review pattern as lessons (M15).

## Read first
- `../06-architecture.md` §2 and §6.
- `lessons.routes.ts`, for the propose/confirm/invalidate pattern and how proposals are visible.
- `analogues.routes.ts`, for scope handling.
- `standing.routes.ts` `figuresFor`, for project figures with units.
- `insight-radar` skill, `references/ranking.md`, for the evidence tiers E1–E5 and readiness 1–4.

## Contract decision
Entries are validated in-module by a zod schema in `vault/src/technology/model.ts`. They are not a Tier A JSON
Schema in `docs/vault-hub/schemas/`, so no existing contract changes. Promoting the shape to a Tier A schema later
is a partner decision that ships with a migration.

## Deliverables
- `vault/db/016_technology_register.sql`. Every table has row-level security, as `test/db.rls.test.ts` requires.
  - `tech_entries`: one row per version of an entry.
    - `key` is stable across versions, e.g. `AL01`.
    - `record` is a jsonb holding the validated body.
    - `status` is one of `proposed`, `confirmed`, `rejected` or `retired`.
    - `legal_tag` is always `lt-firm`.
    - `superseded_by` / `superseded_at` track replacement. A revision is a new row; confirming it supersedes the
      previous confirmed row. Nothing is deleted.
  - `tech_citations`: append-only paper counts per key, one row per count. Fields: query, source, since-2016,
    since-2023, `counted_at`. Scores read the latest row. Counts are metadata, not claims, so they need no
    confirmation.
  - `tech_conditions`: a project's screening conditions, versioned (latest row wins).
  - `tech_suggestions`: a project's suggest, shortlist or dismiss decisions per entry key, versioned the same way.
- `vault/src/technology/model.ts`: zod schemas for the entry body, conditions and weights; the application list.
- `vault/src/technology/score.ts`: the scores.
  - Citation score: log-scaled 1–5 within an application.
  - Cost-benefit: benefit × mean(capex, opex) ÷ 5.
  - Overall: a weighted mean. Default weights are citation 0.20, cost-benefit 0.35, evidence 0.20, fit 0.25. When
    there is no citation count, the citation weight is dropped and the rest renormalised.
- `vault/src/technology/screen.ts`: compares a project's conditions with an entry's `screening` limits.
  - A numeric condition is:
    - `pass` inside the limits;
    - `marginal` within 10% of a bound;
    - `fail` beyond that;
    - `unknown` when either side is missing.
  - Environment, sand tolerance, power and rig availability are categorical rules. Sand one level above the
    tolerance (low < moderate < high) is marginal, two levels is a fail; missing power or rigs is marginal.
  - Project fit is 1 on any fail. Otherwise it is 5 − 1 per marginal − 0.25 per unknown, with a floor of 2.
  - Conditions can be derived from project figures (depth, API, water cut, temperature, GOR, viscosity, with units
    converted). Stored conditions override derived ones, key by key, and the response says where each value came
    from.
- `vault/src/api/technology.routes.ts`:
  - `GET /api/technology?application=&status=&w=`: current entries with scores, ranked.
  - `GET /api/technology/applications`: the application areas, each with its entry count.
  - `GET /api/technology/:id`: one version and the key's history.
  - `POST /api/technology`: proposes an entry. A body with an existing `key` proposes a revision. A partner's
    `status: confirmed` confirms at once.
  - `POST /api/technology/:id/confirm|reject|retire`: partner only.
  - `POST /api/technology/citations`: partner or `job:` service only; appends counts.
  - `GET/POST /api/projects/:id/technology/conditions`.
  - `GET /api/projects/:id/technology/match?application=`: a ranked shortlist with a verdict per screening key.
  - `GET/POST /api/projects/:id/technology/suggestions`.
  - Project routes go through `requireWritableProject` for writes and `assertVisible` for reads.
  - An entry's `evidence` may cite Vault records (`doc:`/`run:`) only when their tag is `lt-firm` or `lt-public`, so
    client material cannot leak into firm knowledge.
- `vault/src/mcp/server.ts` (additive): register the technology routes on the private route app, and add three
  tools: `find_technologies`, `match_technologies`, `suggest_technology`.
- `vault/src/jobs/tech-citations.ts`: the monthly recount. It uses Semantic Scholar bulk search with pacing and
  backoff; `S2_API_KEY` (the key the miners already use) raises the rate limit. Its `fetch` is injectable so tests
  make no network calls. It runs as the Render cron `atc-vault-tech-citations` on the 2nd of each month at
  05:30 UTC (`render.yml`).
- `vault/scripts/import-technology.ts`: imports a seed file of entries as `proposed` (author `import:<file>`) with
  their citation counts. It is idempotent per key and content hash.
- `vault/firm/technology/register-2026-11.json`: the seed. Pilot artificial lift and water handling, plus
  IOR/EOR, well intervention, integrity, and emissions/power, with public sources and ADIPEC 2026 exhibitor matches.
- `hub/technology.html` and `hub/technology.js` (`noindex`; Disallow in `robots.txt`):
  - browse by application, with filters and sortable columns;
  - weight sliders that re-rank live;
  - an entry drawer with evidence, providers and history;
  - a project match tab with a conditions form and a suggest/shortlist/dismiss control per entry;
  - a partner review list of proposals.
- `.claude/skills/insight-radar/SKILL.md` (additive step): each monthly edition proposes register revisions or new
  entries for developments that land in an existing application area.

## Acceptance criteria
1. A proposal by an associate is `proposed`. It cannot be confirmed by its author unless the author is a partner,
   and it is invisible to other associates until confirmed.
2. Confirming a revision supersedes the previous confirmed version. `GET /api/technology` returns exactly one
   current row per key, and the history keeps every version.
3. Evidence citing a `doc:` whose tag is client-NDA is rejected with 400 at the evidence path.
4. Citation scores in an application span 1–5 on a log scale. An entry without a count is scored on the other three
   components, with weights renormalised.
5. Screening returns `fail` for a 3,000 m well against a 2,000 m maximum, `marginal` for 2,150 m, `pass` for 1,500 m
   and `unknown` when depth is missing. Project fit follows the rule above.
6. Match uses stored conditions over derived figures key by key, converts ft→m, °F→°C and %→fraction, and reports
   the source of each condition.
7. Project condition and suggestion writes need a writable project. Reads need the project to be visible. A
   non-member gets 403.
8. The citation job appends one row per key and never edits an entry. With the fetch failing it records nothing and
   exits non-zero.
9. Every table has row-level security. The suite and the typecheck stay green.

## Smoke tests
- `vault/test/technology.score.test.ts`
- `technology.screen.test.ts`
- `technology.api.test.ts`
- `technology.citations.test.ts`
- `technology.import.test.ts`

## Out of scope
- Vendor price feeds.
- Automatic confirmation of any entry.
- Contacting providers.

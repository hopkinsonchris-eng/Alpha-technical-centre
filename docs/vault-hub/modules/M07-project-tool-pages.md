# M07 — Project and tool pages

**Wave 2 · Tier C for components, Tier B for pages · Depends on: M02, M06 · Size M**

## Purpose
The two views partners will live in: a project's complete record, and a tool's
versions and runs.

## Read first
`hub/index.html` (M06), `GET /api/projects/:id/timeline|lineage|stale|vintages` (M02, M08), `../06-architecture.md` §5.

## Deliverables
- `hub/project.html?id=`: header (client, legal tag, contacts, assets); **Timeline** (runs, letters, emails, spreadsheets, papers, newest first, filter by type, stale badge with reason); **Headline numbers** vintage table (one row per final evaluation run: date, tool version, 1P/2P/3P, NPV10, RF, method, reason for change vs previous, from `/vintages`); **Lineage** graph (inline SVG, nodes = runs/items/reference sets, edges = inputs/cites, stale nodes highlighted); **Basis notes** list; **Lessons in scope**.
- `hub/tool.html?id=`: manifest, versions table with status and changelog, runs by version, "runs on older versions" count, owner.
- Components in `hub/components/`: `timeline-list.js`, `vintage-table.js`, `lineage-graph.js`, `stale-badge.js`, each a plain custom element with no framework.
- `GET /api/projects/:id/vintages` in M02 if not present: final runs with headline outputs and computed deltas.

## Acceptance criteria
1. Timeline shows every seeded record exactly once with the right type icon and stale state.
2. Vintage table computes deltas correctly for the fixture (three vintages, one breaking version change).
3. Lineage graph renders 200 nodes without layout overlap failures; clicking a node opens the record.
4. Tool page lists versions in descending order and links each run.
5. Bilingual rule and `noindex` as in M06.

## Smoke tests
Playwright with the M02 fixtures; screenshots of both pages in the PR; unit tests for delta computation and graph layout.

## Out of scope
Editing records; drafting.

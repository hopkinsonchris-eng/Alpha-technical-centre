# M06 — Hub shell and Today page

**Wave 1 · Tier B · Depends on: M02, M03 · Size M**

## Purpose
The staff dashboard entry. Replaces `admin.html` as the place everyone starts.

## Read first
`STYLE-GUIDE.md`, `_page-template.html`, `style.css`, `admin.html` (the day-rate config it holds must move to `hub/settings.html`), `../06-architecture.md` §5.

## Deliverables
- `hub/index.html` (Today) using `style.css` and `main.js`, with EN/ES attributes per house rule, `noindex`, not in the sitemap, listed in `robots.txt` Disallow.
- Sections: **Tools** (every catalog entry: name, owner, lifecycle pill, current version, "what's new" badge when the changelog's newest entry is < 14 days, Open button that resolves `@current`); **My projects** (projects where I authored a run or item in 90 days, with counts and last activity); **Needs attention** (stale runs and documents from M08, filing queue from M10, lesson proposals from M15, re-run deltas; each section hides when its API returns 501); **Recent runs across the firm** (last 20, scope-filtered).
- `hub/hub.js`: fetch helpers, session display, error states, empty states.
- `hub/settings.html`: the day-rate config moved from `admin.html`, stored via `POST /api/settings` (M02 adds a small key-value table) instead of localStorage; `plan-your-job.html` reads it from the API with localStorage fallback.
- `admin.html`: banner linking to `/hub/` (deleted in wave 2).

## Acceptance criteria
1. Every tool with a manifest appears; deprecated tools show the replacement; opening resolves to `aliases.current` (AC1).
2. With the API down the page still renders the catalog from `hub/catalog.json` and says so.
3. Sections backed by unbuilt modules render nothing, not errors.
4. Passes the house bilingual rule: every text node has `data-en` and `data-es`.
5. Lighthouse accessibility ≥ 90 on the seeded page.

## Smoke tests
Playwright: seeded catalog and runs; screenshot attached to the PR; assertion on link targets; a test with the API stubbed to 500.

## Out of scope
Project and tool detail pages (M07), search (M12), drafting (M13).

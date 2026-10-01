# Wave 2 — Decision Log

The Tooler record for the opportunity-centred Hub, 30 September to 1 October 2026.

## Gate 1 (Choice Sheet, `02-choice-sheet.md`)

| # | Decision (verbatim) |
|---|---|
| W2-D1 | "Yes, one table (Recommended)" — opportunities and projects are one table |
| W2-D2 | "I would ideally like something spectacular like a 3d spinning planet earth that can be slowed down and zoomed into… But hey if not do the recommended option. Chicken out!!" — read as: build the globe |
| W2-D3 | "Manifest-declared, context passed (Recommended)" — met with a sidecar beside the manifest because the manifest schema is a Tier A contract |
| W2-D4 | "Record page with highlights, related cards, timeline (Recommended), Catalog lifecycle defaults and APEX version file (Recommended), Command menu (Cmd+K)" |
| W2-D5 | Portfolio rank and compare not selected — deferred (F10) |

## Gate 2

Markup `05-markup.md` approved 30 September 2026: "Approved, build it as written (Recommended)", with "Open and merge each when green (Recommended)" for the four pull requests.

## What shipped

| PR | Scope | Acceptance criteria |
|---|---|---|
| [#24](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/24) | Foundation: project fields, PATCH, countries summary, catalog sidecar and live versions, catalog chips, record panel and sheet | AC7, AC8, AC11, AC12, AC13, AC14 |
| [#25](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/25) | The globe, country drill-down, register, Add opportunity | AC1–AC6 |
| [#26](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/26) | Toolbar with context, stage in place, opportunity card, Cmd+K | AC9, AC10, AC15 |
| [#27](https://github.com/hopkinsonchris-eng/Alpha-technical-centre/pull/27) | Country brief | AC16 |

AC17 (every suite green, public pages unchanged) held on every PR; AC18 evidence is in `../evidence/w2-*.png`.

## Deviations from the Markup, stated

1. The Opportunity Register tool is not marked deprecated: its manifest cannot name the Hub as a replacement (a Tier A schema rule), and the tool stays the calculator the toolbar opens. Its changelog records that the list moved.
2. `vault/ADAPTERS.md` does not exist; the APEX `version.json` instruction is in `vault/src/adapters/README.md` and `vault/SETUP.md` §5.
3. The sidecar replaces a manifest field (W2-D3), recorded in the Choice Sheet.

## Evidence

Final suites on the last head: Vault, Playwright and root suites green, typecheck clean, secret scan clean, public pages byte-identical to `main`. Screenshots: `w2-globe-front.png`, `w2-globe-country.png`, `w2-record-sheet-ipad.png`, `w2-project-toolbar.png`, `w2-palette.png`, `w2-country-brief.png`.

## Still only Chris can do

Set `ANTHROPIC_API_KEY` (and rotate the two keys seen on screen) so the brief and the drafting assistant run; ask the APEX developer for `/version.json`; set Cloudflare's Browser Cache TTL to respect existing headers; decide which Render static site the domain points at.

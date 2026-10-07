# Wave 8 — risk on the map (Markup)

Tooler, 7 October 2026. Chris Hopkinson: "Could we colour countries or give them halos related to the country risk level. Could we indicate other things on the map. What about the risk table that we have in the opportunity register, I liked that." Then, to the two-step proposal below: "Build both and open pr."

## 1. Practice scan (compressed)

| Who | What they put on the map | Taken here |
|---|---|---|
| Insurers (Marsh, Aon political risk maps) | Every country tinted on a five-band scale; the map is the gauge underwriters price from | A band per held country only, as a halo: our globe's first message stays where we work |
| Travel security (International SOS risk map) | Separate medical and security ratings used for duty of care | The advisory level, with its source and date, in the project context the connector hands Claude |
| Maritime intelligence (Windward, Lloyd's List) | Port heat maps, sanctions overlays, chokepoints | Port tanker calls and their 30-day trend for the selected country, one line |
| Conflict monitoring (ACLED) | Event dots clustered with counts; "change since last month" | Event dots near our fields with a count; the score's change since the last reading |

Principle kept from the register (R11): the country's risk and our execution risk stay two different numbers, named apart.

## 2. BEFORE → AFTER

| Surface | Before | After |
|---|---|---|
| Globe | Fill for held countries; outline amber/red for stale or NDA expiring; gold ring for an open round | The same, plus a **halo** per held country in the register's three tones (green < 40, amber < 70, red ≥ 70 on World Monitor's index), a **rising tick** on the halo when the trend is rising, a **sanctions mark** when sanctions are active. One meaning per channel. |
| Globe, selected country | Project and field points | **Event dots** (ACLED, last 30 days) clustered with a count, drawn only for the selected country, cleared on leaving it |
| Globe legend | none | A legend under the hint naming fill, outline, ring, halo, tick, mark and event dots, bilingual |
| Country panel risk line | "World Monitor 71 · advisory: reconsider travel (09:00)" | adds "· rising", "· sanctions", "· +16 since 1 Oct" when the summary carries them |
| Country panel, after intel loads | Intelligence card lists events and ports | Two lines above the card: "N conflict events within 100 km of our fields in 30 days (M fatalities)" and "Ports: X tanker calls in 30 days across N ports · trend ±y %" |
| Register group head | "2 projects · World Monitor 71" | "2 projects · World Monitor 71 ▲ · sanctions · +16" with the same marks, so the map, the table and the panel share one legend |
| `GET /api/countries` | `risk: {score, level, trend, computed_at, fetched_at, sanctions_active, sanctions_count}` | adds `change` (score minus the previous distinct reading) and `previous_computed_at`, from an append-only log the route writes each time World Monitor's `computed_at` moves |
| `get_project_context` (connector) | pack headlines and terms | adds "## Country risk (World Monitor)": index, level, trend, as-of, sanctions, change, and the advisories with source, level and date; nothing without a key |

Out of scope, named: a whole-globe tint (the insurers' map); event dots for every held country at once (one country's events per selection keeps the calls to one); a dark theme.

## 3. Files

Vault: `db/013_country_risk_log.sql` (new), `src/intel/risk-log.ts` (new), `src/api/countries.routes.ts`, `src/mcp/server.ts`. Hub: `hub/globe.js`, `hub/hub.js`, `hub/index.html`, `hub/hub.css`. Tests: `vault/test/countries.brief.test.ts`, `vault/test/mcp.risk.test.ts` (new), `vault/test/{auth,boot,db}.test.ts`, `test/e2e/hub-globe.spec.mjs`. Docs: this file, the wave 7 decision log (a wave 8 entry).

## 4. Acceptance criteria

- **W8-AC1** `GET /api/countries` carries `risk.change` and `risk.previous_computed_at`: null on the first reading; after World Monitor's `computed_at` moves and the score changes, the difference and the earlier reading's time. The log is append-only and never written twice for one `computed_at`.
- **W8-AC2** The globe draws a halo per held country in the tone of its score, a rising tick when `trend` is "rising" and a sanctions mark when `sanctions_active`; `#sec-globe` reports them as `data-halos="KZ:amber,VE:red"`, `data-halo-rising`, `data-halo-sanctions`. A country without a reading wears none. The legend names every channel in both languages.
- **W8-AC3** The country panel's risk line and the register's group head carry the trend, the sanctions mark and the change, with `data-risk-trend`, `data-risk-sanctions` and `data-risk-change`, only when the summary carries them.
- **W8-AC4** Choosing a country draws its ACLED events as clustered dots (`data-events-shown` on `#sec-globe`) and writes the near-fields line from the events within 100 km of the country's located projects and fields; leaving the country clears both. No browser request goes to worldmonitor.app.
- **W8-AC5** The ports line sums tanker calls across the country's ports and gives the trend; it is absent when the section did not answer.
- **W8-AC6** `get_project_context` for a project with a country carries the risk block with the score, level, trend, sanctions, change and advisories when World Monitor is connected, and no such block without a key; the key never appears.
- **W8-AC7** (after first live use, 7 October: "The legend is poorly positioned. Can we make the globe bigger in the centre of the screen and not in a blue box with the legend on its right side.") The globe stands on a full-width stage, centred, at least 600 px wide on a desktop viewport, with no box behind it; the legend is a column on its right, never over the canvas; on an iPad in portrait the legend drops under the globe; the register follows below, full width, scrolling in its own box.
- **W8-AC8** ("If I click on a country on the globe … the legend should show the actual values.") Choosing a country turns the legend into that country's values under each name: projects, stale and NDA expiring, open round or not, the World Monitor index with its tone word and trend, the trend, the sanctions count, and the conflict events with those within 100 km of our fields; "no reading" where there is none; leaving the country restores the plain legend. Both languages.

## 5. Smoke plan

| Criterion | Test |
|---|---|
| W8-AC1 | `countries.brief.test.ts` W3-AC9/W3-AC10: `risk.change === null` first, `+16` after the score moves from 64 to 80 with a later `computed_at`; the log holds two rows, not three, after a third read of the same reading |
| W8-AC2 | `hub-globe.spec.mjs` W8-AC2: `#sec-globe` attributes after load with VE (71.4, rising, sanctions) and KZ (45, stable, none); legend items present in EN and ES |
| W8-AC3 | `hub-globe.spec.mjs` W8-AC3: `#country-risk [data-risk-trend]`, `[data-risk-sanctions]`, `[data-risk-change]`; the register head for VE; none for KZ |
| W8-AC4 | `hub-globe.spec.mjs` W8-AC4: intel mock with one event 15 km from Barinas and one 180 km away → `data-events-shown="2"`, near line "1 conflict event within 100 km"; back to all countries clears both; worldmonitor.app never requested |
| W8-AC5 | the same test with two ports → "Ports: 120 tanker calls in 30 days across 2 ports · trend −8 %"; ports failed → no line |
| W8-AC6 | `mcp.risk.test.ts`: with a fake World Monitor the context markdown carries the block and the advisory; without a key it does not |
| W8-AC7 | `hub-globe.spec.mjs` W8-AC7: the legend is in the stage, not the wrap; the wrap has no background image; the canvas is ≥ 600 px wide at 1440 px and the legend's left edge is right of the canvas; at 820 px the legend is below the canvas |
| W8-AC8 | `hub-globe.spec.mjs` W8-AC8: the seven values for Venezuela in EN and ES, cleared on leaving, "no reading" for Egypt; evidence `w8-risk-stage.png` |
| Migrations | `auth`, `boot`, `db` tests count 13 |

Risks: the halo must not be mistaken for the round ring (different colour family, thicker and softer, no dash); the globe stays readable on an iPad at 1x zoom (the halo radius follows the ring's cap radius). Rollback: revert the PR; the log table is harmless when unread.

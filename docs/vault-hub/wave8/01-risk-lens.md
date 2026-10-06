# Wave 8 — The risk lens (markup)

6 October 2026. What the globe, the country panel and Today do with World Monitor's data, worked out from how other
industries draw country risk and built in one pull request on `claude/onedrive-zoho-workdrive-migration-ytsnn4`.
Smokes first (`vault/test/risk.routes.test.ts`, the wave 8 block in `vault/test/worldmonitor.test.ts`,
`test/e2e/hub-risk.spec.mjs`), then the code, then the full Vault suite and the full Hub suite green. Evidence:
`evidence/wave8-risk-lens.png`.

## 0. What other industries do, and what we take from each

| Industry | What they draw | Source | What we take |
|---|---|---|---|
| Political risk insurance | Every country rated on a six-point scale per peril (exchange transfer, legal, interference, violence, non-payment, supply chain), updated quarterly; the composite is a headline, the perils are the columns people act on; the change since last quarter is always beside the rating | Aon Interactive Political Risk Map; Marsh World Risk Review (nine perils, 197 countries); Control Risks RiskMap | The table keeps the register's five columns and adds a delta column from our own daily snapshots |
| Maritime and supply-chain intelligence | Ports, lanes and chokepoints are the objects; countries are context; an anomaly on a port is a signal in its own right | Windward; Resilinc EventWatch; Everbridge Visual Command Center | Export ports as markers with their 30-day tanker trend; the chokepoint and a half-closure figure on the country panel |
| Humanitarian risk indices | Risk split into hazard, vulnerability and coping capacity; events as points with recency | INFORM (191 countries); ACLED | Events within 200 km of the asset in 30 days, counted for real on the dot and in the Security column |

## 1. The globe (hub/globe.js, hub/hub.js, hub/index.html)

BEFORE: held countries gold; a dashed gold ring for an open round; project dots and field points; the country panel's
one line "World Monitor 71 · advisory: reconsider travel (09:00)". World Monitor was read once per held country.

AFTER:
- **Halo, not fill.** A radial glow in the band colour under each held country with a reading, drawn before the land so
  it spills around the edge; the gold fill keeps meaning "we hold a project here". A chevron above the halo says
  rising or falling. The band colours are the register's (green `#2ECC8A`, amber `#E8963A`, red `#E0544A`).
- **Risk heat layer.** A segmented switch on the globe (Opportunities, the default; Risk heat). On Risk heat every
  tracked country wears a muted tint of its band; held countries keep the gold. The choice is remembered per browser.
  The data is one call: `GET /api/intelligence/v1/get-risk-scores` with no region returns every tracked country,
  cached an hour like every other reader, exposed as `world_risk` on `GET /api/countries`.
- **Sanctions as a hatch.** A pale diagonal hatch clipped to the polygon, over the fill, for a country with active OFAC
  designations (held countries always; every tinted country on Risk heat). Hatch, not colour, so it never collides
  with the band and reads for colour-blind readers.
- **Ports.** Small teal diamonds at the export ports World Monitor tracks for a held country, red-rimmed on an anomaly
  signal; the tooltip gives the port's 30-day tanker calls and trend.
- **Tooltips.** A project dot says "Barinas–Apure Cluster · 1 event within 200 km · 30 d"; a country says its score,
  trend glyph and sanctions; an open round still reads as before.
- **Legend** bottom-right of the globe: the three bands under the words "World Monitor instability", the chevron, the
  hatch, the held swatch, the ring, the port. Hidden on phones.
- **Country panel.** The risk line gains "▲ +5 in 7 d · −10 in 30 d". A trade line under it: "Export: José Terminal
  41 tanker calls (+8 %) anomaly · Puerto La Cruz 18 tanker calls (−12 %) · via Panama Canal (exposure 0.62) · half of
  Panama Canal lost: 12.5 kb/d of crude, 21 days of cover · manageable". The shock figure comes from
  `GET /api/risk/shock?country=XX` after the panel opens; nothing shows when the feed has no ports and no chokepoint.
- **Register.** The country head carries the trend beside "World Monitor 71"; a project row with events near its point
  wears a flag "1 event · 200 km".

## 2. The risk table on Today (GET /api/risk/table, vault/src/api/risk.routes.ts, vault/src/intel/risk-table.ts)

The opportunity register's heat table, half live, as the band after the counters. One row per opportunity the caller
may see (the same scope rule as the countries summary), highest overall first.

| Column | Where it comes from | Formula |
|---|---|---|
| Geopolitical | World Monitor instability index (`get-country-risk`) | the score itself, 0–100 |
| Sanctions | the same reading's `sanctionsActive` and `sanctionsCount` | 5 when none; otherwise 40 + 20 per decade of designated entities, capped at 100 (1 → 40, 10 → 60, 100 → 80) |
| Security | ACLED events via World Monitor, 30 days | 10 + 8 per event + 3 per fatality within 200 km of the project point, capped at 100; country-wide when the project has no point, and the evidence says so |
| Technical | the project's register block (`risks.Technical`) | as entered; "not entered" otherwise |
| Commercial | `risks.Commercial` | as entered |
| Overall | the register's own rule | the mean of the three highest columns with a value |
| 30 d | `risk_snapshots` | today's country score minus the latest snapshot on or before 30 days ago |
| Our execution risk | `register.risk`, `register.risk_score` | shown apart, in the register's words (R11) |

Every live cell carries `source`, `as_of` and `evidence` (the formula in words with the numbers that went in); a cell
opens its evidence under the table, as the register's scorecard does. Without a key the three live columns say
"n/a" and the entered two stand; nothing is simulated. The arithmetic lives in `risk-table.ts` as pure functions so
the route, the tests and this note agree.

## 3. Daily snapshots (db/013_risk_snapshots.sql, vault/src/intel/risk-snapshots.ts)

The countries summary writes one row per held country per day the first time it fetches a score that day
(`ON CONFLICT DO NOTHING`: the first reading of the day stands, like a run). Deltas over 7 and 30 days are read back
against the latest snapshot on or before each horizon, so a country first held yesterday has no delta yet and says so.
No job, no cron: the page people open every morning is the writer.

## 4. One scale, two names (hub/components/risk-scale.js)

`bandOf`: 70 and over red, 40 and over amber, else green; the server states the same in `worldmonitor.ts`. The
register's `heatColour` stops move from 45 to 40 so the two pages agree. The words stay apart: "World Monitor
instability" (low / elevated / high) for the country, "our execution risk" (Managed / Elevated / High, Green / Amber /
Red) for the project, never mixed in one phrase.

## 5. Acceptance criteria

- W8-AC1 A held country with a reading wears a halo in its band colour and a chevron for its trend; the legend names
  the scale; the layer starts on Opportunities; no browser request reaches worldmonitor.app.
- W8-AC2 Risk heat tints every tracked country from the one all-country reading; the choice is remembered;
  Opportunities restores the plain land.
- W8-AC3 The country panel says the trend and the change, the ports with tanker calls and trend, the anomaly, the
  chokepoint and the half-closure figure; the register head carries the trend; a project row says the events near it.
- W8-AC4 The table shows the five columns on the one scale, Overall by the register's rule, the 30-day change and the
  execution risk apart; a cell opens its evidence with source, as-of and the formula.
- W8-AC5 Without World Monitor the live columns say unavailable and the entered ones stand; without the route the
  band stays hidden.
- Vault: `GET /api/countries` carries band, trend, deltas, ports, chokepoint, near-asset counts and `world_risk`; one
  snapshot a day per country; `GET /api/risk/table` and `GET /api/risk/shock` follow the scope rules; a 429 still
  costs at most one call per country (the risk reading goes first and alone).

## 6. Cost and failure

One all-country call an hour plus four per held country (risk, ports, chokepoint, events), all cached an hour, all
server-side; the shock call only when a country panel opens. Ports, the chokepoint index and the shock are reported
per reader and never hide the risk line; a Pro-gated reader says so in `world_monitor.notes`. Response shapes were
taken from the published OpenAPI bundle; `get-risk-scores` keys its rows by `region`, which is an ISO code for a
country and a name for a region, so only ISO-keyed rows are kept and a held country's own reading always wins.

## 7. Out of scope (named)

Markets and commodities, military posture, GPS interference, internet outages on the map (the country pack and the
intelligence card carry outages already); tenders (Pro-gated, a Today card for a later wave); a per-project risk
history chart (the snapshots make it possible).

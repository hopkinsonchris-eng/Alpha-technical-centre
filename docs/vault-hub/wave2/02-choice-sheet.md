# Wave 2 — Gate 1 Choice Sheet

Answered 30 Sep 2026 by Chris Hopkinson (partner) to the four Gate 1 questions.
Decisions are numbered W2-D1 to W2-D5; later artifacts cite them.

| # | Question | Chosen (verbatim) | Adopts |
|---|---|---|---|
| W2-D1 | Should the Opportunity Register and the Vault projects table become one thing? | "Yes, one table (Recommended)" | P13, P18, P21 |
| W2-D2 | How should the world map be drawn on the Hub front page? | "I would ideally like something spectacular like a 3d spinning planet earth that can be slowed down and zoomed into. I dont know. What are you capable of. I keep seeing these amazing things like Jarvis galaxy like visualisations that were built by Claude. But hey if not do the recommended option. Chicken out!!" | P13, P19 |
| W2-D3 | Which tools should the toolbar show, and how does it carry the project? | "Manifest-declared, context passed (Recommended)" | P14, P16 |
| W2-D4 | Scope: which deferrable items ship with this wave? | "Record page with highlights, related cards, timeline (Recommended), Catalog lifecycle defaults and APEX version file (Recommended), Command menu (Cmd+K)" | P15, P17, P20, P21 |
| W2-D5 | (implied by D4) Portfolio rank and compare | not selected | P22 deferred to wave 3 |

## Readings of the answers

- **W2-D2 is read as: build the 3D globe.** The answer sets a bar ("spectacular", "spinning", "slowed down", "zoomed into") and falls back to the flat map only if that bar cannot be met. It can: an orthographic globe drawn on a canvas from the same public-domain Natural Earth polygons, auto-rotating, slowing on hover, draggable with inertia, pinch and wheel zoom, and a click that flies to a country and opens it. No WebGL, no tile server, no key, runs on the iPad. The Markup (05) shows exactly what it looks like and how it degrades; Gate 2 is where the choice is confirmed.
- **W2-D3 cannot be met literally.** `docs/vault-hub/schemas/tool-manifest.schema.json` is a Tier A contract with `additionalProperties: false`, so a `context` field cannot go into `tool.json` (rule 3). The nearest faithful reading: a Hub-owned sidecar `tools/<id>/hub.json` beside the manifest, merged into the catalog exactly as `releases` already is. The declaration still lives with the tool, in its folder, owned by the tool's owner. Recorded here so the deviation is visible.
- **W2-D1 keeps the public register page byte-identical.** `opportunity-register.html` is disallowed in `robots.txt` and not in the sitemap, so rule 6 does not bind it, but it is also a public-site page with its own `localStorage` store. The register moves into the Hub (where the API is reachable behind Access); the public page keeps working as it does today and is marked deprecated in its manifest with the Hub as its replacement once the Hub register is live.

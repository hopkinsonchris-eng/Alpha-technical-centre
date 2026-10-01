# Wave 3 — Gate 1 Choice Sheet

Answered 1 Oct 2026 by Chris Hopkinson to the four Gate 1 questions. Decisions W3-D1 to W3-D4.

| # | Question | Chosen (verbatim) | Adopts |
|---|---|---|---|
| W3-D1 | When a document names fields, how should they reach the project? | "Propose, you confirm (Recommended)" | P24 |
| W3-D2 | Where should field locations and facts come from? | "Global Energy Monitor tracker (Recommended), GeoNames and Wikidata (Recommended)" — the per-field regulator and paper miners, and model web search, were **not** chosen | P25, P26 |
| W3-D3 | World Monitor: do you hold, or will you buy, a Pro licence with an API key? | "Yes, build the adapter now (Recommended)" | P28 |
| W3-D4 | How much of this wave ships first? | "Everything, in order (Recommended)" | P23, P27 (gazetteer part), P29 |

## Readings

- **W3-D2 narrows "search for any information related to that field".** What is filed automatically when a field is attached is what the three gazetteers hold: the Global Energy Monitor dossier (status, operator and owners, discovery and start years, production, reserves, its wiki page), Wikidata facts and the GeoNames record. Running the regulator and paper miners per field, and open web search, are recorded as follow-ups (F13, F14); either can be switched on later without changing the design.
- **W3-D3 means the adapter ships now and runs the moment `WORLD_MONITOR_API_KEY` is set on the Vault service.** Until then the brief and the globe say the feed is not connected; nothing is simulated in the Hub.
- Coordinates never come from the model's memory: each location carries its source (a gazetteer record or a document) and waits for a person's confirmation.

# Wave 4 — Choice Sheet (Gate 1)

Answered 1 October 2026 by Chris Hopkinson to the four Gate 1 questions. Decisions W4-D1 to W4-D4.

| # | Question | Decision (verbatim) | Practices |
|---|---|---|---|
| W4-D1 | Which sources should a research run use? | "World Monitor research (Recommended), The Vault's own miners (Recommended)" — Claude web search and fetch, and GEM wiki pages, were **not** chosen | P30, P31; P36 not adopted |
| W4-D1 (revised 1 Oct 2026, after the first live run) | Which sources should I add to the run? | "GEM wiki pages per field (Recommended), Web search with URL citations (Recommended)" — the first run on High Tech Electronica found nothing for small Oficina-area fields that Google finds plenty on | P36 adopted; F14 closed by this decision |
| W4-D2 | When should a run start? | "Button and automatic (Recommended)" | P35 |
| W4-D3 | What does a run put in the Vault? | "Research notes plus proposals (Recommended)" | P33, P34, P37 |
| W4-D4 | How far does one run go? | "15 minutes or about £3" | P32 |
| W4-D5 (addendum 2, 1 Oct 2026) | Where should the four boxes (current owner, government, licence type, JV partner) live? | "Opportunity card, project level (Recommended)" | asked after "I've set the owner to be High Tech Electronica. When it does research will it now find information about that company" — the Owner box was the firm's lead, never a search term |
| W4-D6 (addendum 2) | Should research use these names as search topics? | "Yes: holder, partners and government become topics (Recommended)" | a stated deviation from W4-AC1's "register text is never a search term": named organisations, not free text |
| W4-D7 (addendum 2) | Licence type: a pick-list or free text? | "Pick-list with Other (Recommended)" | Concession · Production sharing · Service contract · Joint venture / empresa mixta · Licence · Other, with a note |
| W4-D8 (addendum 2) | Rename the existing Owner box so it is not read as the asset owner? | "Rename to Lead at the firm (Recommended)" | same register key `owner`; label only |

## Readings

- **W4-D5 to W4-D8 give research named counterparties.** The register gains `holder`, `government`, `licence_type` (+ `licence_note`) and `partners` (a list); the card and the register table show them; `buildQueries` reads the three name fields as companies (split on "/" and ","), so World Monitor enrichment and signals, SEC filings, web search and a strict literature topic ask about each. The lead at the firm, the thesis and the next step stay out of every query. Downstream: `05-markup.md` §1.4.9 and W4-AC13–AC15.

- **W4-D1 revised adds two sources, still behind a record.** Each attached field with a Global Energy Monitor record gets its GEM wiki page fetched (CC BY 4.0, no key, no model) and every reference the page cites becomes a finding with its URL. Web search runs through the model's server-side search tool; only sentences the API cites are filed, each with the page URL and the verbatim cited text, so nothing comes from the model's memory. Downstream: `05-markup.md` §1.4.8 and W4-AC9–AC11; `06-decision-log.md` records the reversal; F14 closes.
- **W4-D1 keeps every fact behind a licensed or public record.** Everything a run files comes from World Monitor's research endpoints (GDELT documents, company enrichment and signals, SEC filings, the intelligence timeline where the plan allows) or from the Vault's own miners (literature, regulators, EIA). Open-web search stays a follow-up (F14) and can be switched on later behind the same run.
- **W4-D2 means two hooks and a button.** A run is queued when a project is created from the Hub and when a field is attached (one open run per project; a second trigger extends the queued run rather than starting another), and a partner or member can press "Research this project" at any time.
- **W4-D3 means findings are ordinary records.** Each finding is a public note under the project with its source, URL, date, the query that found it and a verbatim excerpt; the Research tab lists them and Find indexes them. A finding that names a field not yet attached opens the wave 3 asset proposal; one that names an operator, licence or production figure opens a `research` proposal. Nothing becomes a fact in a brief without its citation.
- **W4-D4 is the smaller budget.** A run stops at 15 minutes of wall clock or about £3 of model spend (the model is used only to read findings for proposals, at low effort), files what it found, and reports what it did not reach; a re-run continues from each source's cursor.

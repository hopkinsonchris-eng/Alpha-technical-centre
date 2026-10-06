# Wave 7 — the country pack rework (Markup)

6 October 2026. First live use of the pack (Venezuela) returned a card worse than a web search: prose headlines quoting a news item, no fiscal terms, risk "not registered". Chris Hopkinson: "The country pack should state the licence type for the country (PSA, straight licence, service contract etc) and should pull royalty, tax etc and put it at the top of the page. It should pull risks from world monitor." Approved as proposed: "yes build it".

## Why the first pack read thin

The Chambers chapter the Vault had filed already stated the regulator, the national company, the 50 % income tax and the three contract forms. It never reached the card because (1) each section could read only the originals fetched for it, and Chambers was tagged "legal"; (2) the drafter saw at most 12,000 characters of any original; (3) the headline rule asked for "a sentence", so a quotation served; (4) the risk section wanted a text original and World Monitor's reading is not one; (5) with 14 registered sources, half of them dead, there was nothing else to read.

## BEFORE → AFTER

| Surface | Before | After |
|---|---|---|
| Top of the Country pack card | ten rows | the **terms card** first: contract regime, state participation, royalty, income tax, special taxes, cost recovery, stability, local content, regulator, national oil company, how acreage is awarded, sanctions; each value cited and dated, "not published" where no original states it; "meets the bar" or "below standard: no original states …" |
| What a section may read | its own originals, 12k chars each | every original of the country, 40k chars each, in one block the provider caches across the eleven calls of a build; the section's own originals named first |
| Headline | "one sentence that answers the question" | the answer with its key figure or name; never what a person said as the rule |
| Sources | the registry only | the registry, plus pages the model's web search names, which the **job** fetches under the pack's rules and files as originals ("found by web search" chips); the model still fetches nothing and cites only stored copies (D67 kept, by Chris's decision of 6 Oct) |
| Risk | "no source registered" | World Monitor's reading filed as an original of the risk section and drafted with OFAC |
| Quality | none | `quality: {ok, missing}` on the view, the resource and the project context; the tests hold the pack to it |
| Cost of a Refresh | every section re-drafted | sections kept when no original changed; the terms rebuilt only when something was re-drafted |

## Files

`vault/db/012_country_terms.sql`, `vault/src/country/types.ts` (TERMS, TermsCard, PackQuality, PackView), `vault/src/country/terms.ts`, `vault/src/llm/country-pack.ts`, `vault/src/jobs/country-pack.ts` (World Monitor original, web search step, view), `vault/src/mcp/server.ts`, `hub/components/country-pack.js`, `hub/hub.css`, tests, `vault/SETUP.md`.

## Acceptance criteria

- **W7-R1** The terms card is drafted from the country's originals in one call, every value cites an original the build offered, an uncited value becomes a question, and the required terms missing are listed as `quality.missing`.
- **W7-R2** A section cites an original fetched for another section (fiscal cites the legal chapter); the prompt's system block is identical across the sections of a build.
- **W7-R3** The web search step files the pages the search cited as originals of the section its query served, skips blocked hosts and pages already registered, caps the pages per build, and a section's chip says "found by web search".
- **W7-R4** The World Monitor reading is filed as an original of the risk section and the section drafts from it.
- **W7-R5** The card shows the terms first with chips and as-of, "below standard" with the missing fields when the bar is not met, and the connector resource prints the terms before the sections.
- **W7-R6** A Refresh that finds no changed original makes no call; one changed page re-drafts its section and the terms.

## Smoke plan

`vault/test/country-pack.terms.test.ts` (R1, R2, R5 resource), `vault/test/country-pack.job.test.ts` (R3, R4, R6), `vault/test/country-pack.sections.test.ts` (R2), `test/e2e/hub-country-pack.spec.mjs` (R5).

## Risks and rollback

Web pages found by search carry no vetted licence: they are quoted with attribution for screening, never at length, and the registry sources stay preferred. Spend: one cached block per build, eleven short calls, four searches; under the £2 build budget and the £10 daily cap. Rollback: `PACK_WEB_SEARCH=false` switches the search step off; the terms table is additive.

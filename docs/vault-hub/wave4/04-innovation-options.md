# Wave 4 — Innovation Options

Each option is checked against the AI-leverage list: (a) an LLM over the firm's own data, (b) pattern recognition the eye would miss, (c) optimisation of parameters set by habit, (d) first-draft artifacts a person edits.

## Option A — Budgeted research runs with cited findings and proposals (RECOMMENDED)

A `research` job per project. The query builder takes the project's name, client, country, each attached field's names (the short name, the GEM name, "name other") and operators, and asks: World Monitor (GDELT documents per name; company enrichment and signals per operator and client; SEC filings per operator; the intelligence timeline for the country where the plan allows) and the Vault's miners (one `TopicSpec` per field and per operator for the literature feeds; the regulator feed for the project's country; EIA and SEC for operators). Every finding is filed as a public note under the project with source, URL, date, query and a verbatim excerpt, deduplicated on external id. The run stops at 15 minutes or about £3, writes its summary (findings per source, proposals opened, where it stopped), and a re-run continues from each source's cursor.

AI leverage: (a) the model reads each finding once, at low effort, to propose fields (`extractAssets`, wave 3) and operators, licences and production figures with a verbatim quote (new `research` proposals); (b) findings that repeat across sources are grouped so a partner sees "four sources name PDVSA as operator" rather than four rows; (d) the run's summary is the first draft of the project's "what we know" note. (c) not used: the budget and the query set are explicit, not tuned.

Chosen by W4-D1 to W4-D4 as a whole.

## Option B — Standing watch per project

The same run repeated weekly for every active project, with a digest of what changed. AI leverage: (b) change detection across runs. Deferred: W4-D2 chose event triggers and the button; the weekly miners already cover the slow drift. Recorded as F16.

## Option C — Open-web research through a licensed search tool

Claude's server-side web search and fetch tools, every page quoted and cited. AI leverage: (a) and (d). **Not chosen** at W4-D1 (P36); stays F14 and can be added as one more source behind the same run.

## Option D — Model-written project summaries without records

Ask the model what it knows about the project and file the answer. Rejected: it breaks rule 4 of the firm's method (no fact without a record) and the wave 3 rule that the model never supplies a location.

## Recommendation

Build Option A in two pull requests (§5 of the Markup); record B as F16 and keep C as F14.

# Wave 3 — Innovation Options

AI-leverage checklist per option: (a) LLM over own data, (b) pattern recognition, (c)
optimisation of habitual parameters, (d) first-draft artefacts.

## Option A — Verified entity proposals from every document (RECOMMENDED)

On index, the model reads the document and names the fields, blocks, basins, wells and
operators it finds, each with the sentence that names it. The Vault keeps only candidates
whose quote is verbatim in the text (a hallucinated name cannot survive), ranks them against
the gazetteers for the project's country, and files a proposal per unattached field. A
person accepts with one tap; the acceptance attaches the asset, records its location source,
and starts the dossier. Without a provider the same step runs on a dictionary of known names
(Vault assets plus the gazetteer for that country), so the pipeline never depends on a key.

- (a) yes, (b) yes: the quote check and the gazetteer match are what make it trustworthy,
  (c) no, (d) yes: the dossier note is the first draft of a field summary.
- Why recommended: it is the clever part Chris asked for, it reuses the ingest pipeline and
  the review queue that exist, and it cannot write anything on its own.

## Option B — Country risk from World Monitor, cited like a run

The brief's Situation paragraph and the country list carry World Monitor's composite risk
score, advisory level and the last 30 days of armed-conflict events for the country, each
cited as a World Monitor record with its id, through the same citation check as everything
else. (a) yes in the brief, (b) the feed's own, (c) no, (d) no. Chosen at Gate 1 (W3-D3);
built in this wave.

## Option C — Asset-aware staleness

When a field gains a new gazetteer release (GEM publishes roughly twice a year) the runs and
letters that cite that field are flagged "field data moved on" through the existing staleness
engine. (b) yes. Cheap once assets carry a release date; proposed as follow-up F15 rather than
this wave, to keep the wave to what was chosen.

## Option D — Model-guessed coordinates

Ask the model where a field is. Rejected: unverifiable; every coordinate must carry a
gazetteer or document source.

## Recommendation

Build Option A and Option B in this wave (three pull requests, §5 of the Markup); record C as F15.

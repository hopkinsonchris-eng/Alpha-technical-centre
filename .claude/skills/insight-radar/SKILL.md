---
name: insight-radar
description: Research, rank and publish the monthly Oil & Gas Technology Radar insight article for the Alpha Technical Centre site. Use when asked to run the technology radar, produce the monthly insight article, find the latest oil and gas technical developments, or when the user says "run the radar" or invokes /insight-radar. Sweeps society journals (SPE, SEG, AAPG, SPWLA, EAGE), agency and regulator publications and trade press across seismic, geological modelling, petrophysics, reservoir engineering, production, completions, facilities, transport and trading; ranks findings by evidence tier and potential impact; writes a humanised, fully cited article and publishes it to the Insights page with an archive.
---

# Insight Radar

Produce one monthly edition of the Oil & Gas Technology Radar: a ranked,
cited review of what actually happened in technical oil and gas, written so a
reader does not need to go looking themselves.

The standard is the point. Anyone can aggregate headlines. This series is worth
reading only if every claim is sourced, every source resolves, the ranking is
defensible, and the prose does not read like a machine wrote it. **A thin,
honest edition beats a padded one.**

## Non-negotiables

1. **Never cite a source you have not opened.** Fetch every URL in this run and
   confirm it resolves to the work you are citing. Fabricated or misattributed
   citations are the one failure that destroys the series, and they are the
   characteristic failure mode here. The publish script refuses to run without
   `verified: true` on every reference; do not set that flag on trust.
2. **Never describe results you could not read.** Paywalled paper, abstract
   only? Cite the abstract, say what the abstract says, mark it `abstract`, and
   stop there. Do not reconstruct findings from a press release and attribute
   them to the paper.
3. **Attribute vendor claims to the vendor**, in the sentence, every time.
4. **Do not invent numbers, dates, well counts, basins or author names.** If a
   detail is not in the source, it does not go in the article.
5. **Run the humaniser skill over the body before publishing.** Non-optional.
6. **Nothing goes live without review.** Push a branch and open a PR. Never
   commit an edition straight to the default branch.

## Process

### 1. Set the window and read the ledger

The window is the calendar month just ended, unless told otherwise. Read
`insights-data/radar-ledger.json` (it may not exist on the first run) for what
previous editions already covered. A development already in the ledger comes
back only with new evidence, and then you say what changed.

Note the previous edition's filename for the `prev` link.

### 2. Sweep

Load `references/sources.md` and work the discipline checklist in it. Every
discipline gets a real search: seismic acquisition and processing, seismic
interpretation, geological modelling, petrophysical evaluation, reservoir
engineering and simulation, production and artificial lift, drilling and
completions, well integrity and abandonment, surface facilities, transport and
midstream, trading and commercial, digital and data, emissions and measurement.

Search with the discipline's own vocabulary and always constrain by date.
Search in Spanish and Portuguese for Latin America. Chase every trade-press
report back to its primary source.

Aim to screen 40 or more candidate items. Keep a running list with source, tier,
date and URL as you go — you will need it for the dossier, and reconstructing it
later wastes the work.

If a discipline turns up nothing, record that. Silence in the dossier must be
deliberate and visible, not an oversight.

### 3. Verify

For every candidate that might make the edition, fetch the URL. Confirm it
resolves, that it is the work you think it is, and how much of it you can
actually read. Record the access level honestly. Drop anything that fails.

Do this before ranking, not after — an unverifiable item cannot be ranked, and
verification often changes what a finding actually says.

### 4. Rank

Load `references/ranking.md` and apply it: evidence tier E1–E5, readiness 1–4,
impact scored 1–5 across magnitude, breadth, adoption cost, time to value and
relevance to this firm's work. E5 is not citable. Every edition needs at least
one E1 or E2 source.

Select five to eight developments. Spread the disciplines. Include a genuine
negative result if you found one — they are more useful than a fifth
incremental improvement and almost nobody reports them.

### 5. Write the dossier

Before the article, write the working file to
`insights-data/dossiers/<YYYY-MM>.md`:

- Every candidate screened, with source, tier, date, URL and verdict.
- The impact scoring for each selected item, factor by factor, so the ranking
  can be argued with.
- Disciplines that turned up nothing, and what you searched.
- Anything you dropped for being unverifiable, and why.

This is the audit trail. It is what lets you or the user defend a claim in six
months, and it is what makes the next edition's dedupe possible.

### 6. Write the article

Load `references/article-spec.md` for the house format and the JSON schema.
Body copy 1,100–1,600 words. One section per development, strongest first, each
answering: what it is, what was measured, who did it and where, **what it is
good for**, and the honest limit.

The benefit is what the user asked for and what readers return for. Make it
concrete and decision-shaped: which workflow it replaces, what it costs, what it
saves, on which kind of asset. "Improves efficiency" is a failure.

Include the "What we would use, and where" section. That is the firm's own read
and the reason this is not an aggregator.

Write the edition JSON to `insights-data/editions/<YYYY-MM>.json`.

### 7. Humanise

Invoke the **humaniser** skill on the body copy. Keep every fact and citation
exactly as written; strip the AI tells. Then run the publish script with
`--dry-run` and fix every style warning it reports. Warnings are defects.

### 8. Publish

```bash
python3 .claude/skills/insight-radar/scripts/publish_edition.py \
    insights-data/editions/<YYYY-MM>.json --dry-run
python3 .claude/skills/insight-radar/scripts/publish_edition.py \
    insights-data/editions/<YYYY-MM>.json
```

The script writes the article page, puts its card at the top of the Insights
grid, rolls cards past the sixth into the archive list on the same page, updates
`sitemap.xml` and appends to the ledger. It fails loudly on citation problems.

Then check the rendered page:

```bash
python3 -m http.server 8000   # visit http://localhost:8000/insights.html
```

Confirm the radar table scrolls rather than breaking the layout on a narrow
viewport, the citation superscripts jump to the right source, and the archive
list renders once the grid has more than six cards.

### 9. Branch, commit, PR

```bash
git checkout -b insights/radar-<YYYY-MM>
git add insights-<slug>.html insights.html sitemap.xml insights-data/
git commit
git push -u origin insights/radar-<YYYY-MM>
```

Open a PR. In the body: the ranked list with tiers, the count of items screened
versus reported, any discipline that came up empty, and anything the reviewer
should look at hardest. Do not merge it yourself.

## Reporting back

Tell the user, in the chat reply: the developments selected with their tiers and
readiness, how many items were screened, which disciplines were quiet, anything
you dropped for being unverifiable, and the PR link. Flag honestly if the month
was thin — that is useful information, not a failure to hide.

## Failure modes to watch in yourself

- **Padding a thin month.** If only four developments survive verification, run
  four and say so in the method note.
- **Recycling.** Check the ledger. A series that repeats itself is worthless.
- **Vendor capture.** An edition built from service-company material is a
  brochure. Count your E3 sources; if they outnumber E1 and E2 combined, go back
  to the journals.
- **Subsurface bias.** Facilities, transport, trading and commercial are easy to
  skip because the journals are thinner. Skipping them breaks the promise that
  this covers the technical stack.
- **Citation drift.** The number in the prose must match the source that
  actually supports that sentence. Re-read each superscript against its
  reference before publishing.

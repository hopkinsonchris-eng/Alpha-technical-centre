---
name: insight-radar
description: Research, rank and publish the monthly Oil & Gas Technology Radar insight article for the Alpha Technical Centre site. Use when asked to run the technology radar, produce the monthly insight article, find the latest oil and gas technical developments, or when the user says "run the radar" or invokes /insight-radar. Sweeps SPE and OnePetro first, then SEG, AAPG, SPWLA, EAGE and the geological societies, global regulators and agencies, operator, service-company and vendor technical disclosure, and trade press, across seismic, geological modelling, petrophysics, reservoir engineering, production, completions, well integrity, facilities, transport, trading and digital. Global in scope with no regional weighting. Ranks findings by evidence tier and potential impact, writes a humanised, fully cited article and publishes it to the Insights page with an archive.
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
2. **Never describe results you could not read**, and **never publish an item
   you could not read.** These are two different rules and both bind.

   An item earns a place in the article only if you have read enough of the
   primary source to state what was measured. A title from a table of contents
   is not a development, it is a lead. Leads go on the reading list (step 5a),
   never into the article.

   This is a commercial publication. Prose that admits the author could not
   reach a source reads as weakness, not rigour, and undermines every other
   claim on the page. **The article never discusses its own access
   limitations.** No "behind the paywall", no "we could not assess", no note
   explaining what could not be read. If the evidence is not in hand, the item
   is simply absent, and the reader never learns there was a gap.

   Access constraints are recorded in the dossier, which is internal, and in
   the reading list, which is for the client. Never in the published article.

   The cost of this rule is shorter editions. Pay it. Four developments stated
   with authority is a stronger publication than eight where three carry an
   apology.
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

Start with SPE every edition: OnePetro, JPT and the SPE journals are the spine
of the series, and an edition with no SPE material has a search problem. Then
SEG, AAPG, SPWLA, EAGE and the geological societies, then the regulators and
agencies, then the commercial sources, then trade press to corroborate.

Sweep the commercial sources properly. Operator, service company and vendor
technical pages carry field-trial numbers and deployment counts a year or more
before the journals do. Go to their technical papers, case studies and
newsrooms, not their product pages.

**The series is global.** Technology does not care which country it was proven
in. Run each discipline search without a region term first, then check what came
back and go looking explicitly for whatever is missing: Norway and the UK, the
Middle East, Asia-Pacific, Africa, Australia, Canada, the CIS and Caspian,
Latin America, North America. Search in other languages where the literature is
in-language. No single region should hold more than about half an edition.

Search with the discipline's own vocabulary and always constrain by date.
Chase every trade-press report back to its primary source.

Aim to screen 40 or more candidate items. Keep a running list with source, tier,
date and URL as you go — you will need it for the dossier, and reconstructing it
later wastes the work.

If a discipline turns up nothing, record that. Silence in the dossier must be
deliberate and visible, not an oversight.

### 3. Verify and obtain the full text

For every candidate that might make the edition, fetch the URL. Confirm it
resolves and that it is the work you think it is. Then get the substance, in
this order:

**Use the societies as the index, not as the only source.** SPE, SEG and AAPG
tell you what is worth knowing about. What the work actually found is very often
readable somewhere else, because the people who did it want it known. A paper
number and title from a paywalled table of contents is a *search key*, and
running it properly is the difference between a four-item edition and an
eight-item one.

Work down this list for each candidate:

1. **Check the papers folder.** `insights-data/papers/<YYYY-MM>/` holds PDFs the
   client has downloaded with their own society access. Read them. These take
   priority over everything else.
2. **Search the paper number and the exact title.** This is the highest-yield
   single step and it usually resolves the authorship the paywall hid. Searching
   "SPE 230613" plus its title returns the authors, their companies, the
   operator, the basin and the mechanism, none of which appear on the restricted
   page. Do this before concluding anything is unreadable.
3. **Go to the authors' employers.** A field trial has a service company and an
   operator, and both publicise it. Press releases, technical pages and product
   announcements carry the mechanism and the commercial framing, though rarely
   the numbers. Attribute to the company in the sentence, always.
4. **Look for third-party technical commentary.** Specialist consultancies and
   modelling firms publish readable conference reviews naming paper numbers and
   findings, and they are frequently *critical*, which a vendor source never is.
   ResFrac's HFTC reviews are the model. This class of source is often the best
   available: readable, technically literate, and willing to state limitations.
   See the commentary section of `references/sources.md`.
5. **Check for a legitimate open-access copy.** Resolve the DOI, then Crossref,
   Unpaywall and OpenAlex, then the authors' institutional repository. A
   Stanford, NORCE or TU Delft co-author usually means a readable copy exists
   somewhere legal.
6. **Read the society summary.** JPT technology-focus synopses, The Leading Edge
   and First Break summarise papers readably and are citable in their own right.
7. **Conference programme and presentation pages.** Abstracts and slide decks
   are often free on the conference site even when the paper is not.

Cite what you read. If the substance came from a vendor release and a
third-party review, cite those and cite the paper for the record, and make the
prose reflect which claim rests on which source.

**If none of that yields enough to state what was measured, the item does not go
in the article.** Put it on the reading list and move on. Do not write it up
thinly, and do not explain the gap to the reader.

**Date the primary source, not the summary.** Papers surface months after they
are presented: a February conference paper often reaches the JPT technology
focus in June. Reporting an in-window *surfacing* is legitimate, because that is
when practitioners meet the work, but the prose must give the paper's real venue
and date. Never let a February paper read as a July result.

Never attempt to bypass a paywall, and never use the client's society
credentials to fetch content automatically. Both risk their membership and
breach the publishers' terms. The papers folder exists so a human makes that
download deliberately, under their own licence.

Do this before ranking, not after. An item you cannot read cannot be ranked,
and getting the full text often changes what a finding actually says.

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

- Every candidate screened, with source, tier, date, region and URL, and the
  verdict on each.
- The impact scoring for each selected item, factor by factor, so the ranking
  can be argued with.
- **The discipline spread and the regional spread**, counted. Both are the
  check against the two biases this series is most prone to.
- Disciplines and regions that turned up nothing, and what you searched to
  establish that.
- Anything you dropped for being unverifiable, and why.

This is the audit trail. It is what lets you or the user defend a claim in six
months, and it is what makes the next edition's dedupe possible.

### 5a. Write the reading list

Write `insights-data/reading-list/<YYYY-MM>.md`: the papers that looked
significant but could not be read, so the client can pull them with their own
society access.

For each one give the paper number, the exact title, where it appeared, the
direct link, and one line on why it is worth their time. Rank the list, because
their time is limited and they will start at the top. Keep it short. Ten items
they will actually fetch beats forty they will not.

Tell them where to put the PDFs:
`insights-data/papers/<YYYY-MM>/` (git-ignored, so nothing licensed is
committed). Anything dropped there is read in full on the next run and becomes
citable with its results.

This is the loop that makes the series compound. A month with a login is
substantially deeper than a month without one, and the reading list is how the
run asks for what it needs.

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
- **Regional skew.** The firm works in Latin America and the US Gulf Coast, and
  that makes it easy to over-select papers from those basins and to score them
  up. Do neither. Count the regional spread before publishing and record it in
  the dossier. Middle East and Asia-Pacific work is the most commonly missed,
  because much of it appears in ADIPEC, IPTC and APOGCE proceedings rather than
  in the journals, and some of it is not in English. If an edition is more than
  half one region, go back and search the others.
- **Missing SPE.** SPE is the largest body of relevant literature that exists.
  An edition without it is not a radar.
- **Citation drift.** The number in the prose must match the source that
  actually supports that sentence. Re-read each superscript against its
  reference before publishing.

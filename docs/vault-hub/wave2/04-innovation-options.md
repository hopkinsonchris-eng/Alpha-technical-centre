# Wave 2 — Innovation Options

Each option answers the Gap Statement. The AI-leverage checklist is applied to
each: (a) an LLM reasoning over our own data, (b) pattern recognition the eye
would miss, (c) optimisation of parameters set by habit, (d) first-draft
artifacts a human edits.

## Option A — The Country Brief (RECOMMENDED)

On the globe, every country the firm has touched carries a **Brief** button.
The brief is written by the drafting gateway (M13) from what the Vault holds
for that country, in scope for the reader: projects and their stages, the
latest headline numbers per project, the analogue rows, the confirmed lessons,
the correspondence threads, the public-data miners' latest rows. Every
sentence cites its source; the brief is saved as a note item citing them, so
it is a record, not a chat. It is regenerated only when something in that
country's scope changed since the last one (content-hash of the source set),
so it costs one call per real change.

- (a) LLM over own data: yes, this is the whole point. (b) Pattern recognition:
  the gateway is asked to name contradictions between runs and letters and
  between a lesson and a current assumption. (c) Optimisation: no. (d) First
  draft: yes, the brief is the opening section of any country or portfolio
  memo.
- Why recommended: it turns the globe from a picture into the place a partner
  starts a Monday. It reuses M12 retrieval and M13 drafting unchanged, so the
  cost is one route, one panel and one cache table. It is the option a
  competitor with a vendor database cannot copy, because the input is our own
  work.
- Cost: 0.5 day on top of the wave. Risk: quality depends on how much is in
  the Vault; with one project the brief is short, and says so.

## Option B — Opportunity triage on entry

When an opportunity is added (or its potential model changes), the Vault
proposes: the country (from name and coordinates), the closest analogue rows
the firm has evaluated (M16, cosine over the analogue schema), the prior
projects in the same basin (M06 master data), and a stage suggestion with the
one question to ask next. The partner accepts or edits each proposal; nothing
is written without a click.

- (a) yes, for the "next question". (b) yes: "we screened this basin in 2024
  and the sweep efficiency we used then was 0.55, you have 0.67". (c) yes:
  proposes measured/assumed defaults from analogues instead of the tool's
  hard-coded defaults. (d) yes: the thesis paragraph.
- Cost: 1 day. Depends on analogue rows existing; today there are few, so
  the value arrives later than Option A's. Good wave-3 candidate on top of A.

## Option C — Drift on the globe

A pure computation: the staleness engine (M08) already knows when a run's
inputs moved. The globe colours a country amber when any project in it holds
a stale final run or a document awaiting filing, and red when a legal tag
expires within 30 days. No LLM: the signal is exact and the eye should see it
without interpretation, which is the stated reason AI adds nothing here.

- Cost: 0.25 day, and it rides on the globe's data route. Included in the
  Markup as part of the globe rather than as a separate option, because it is
  cheap and makes the front page honest.

## Option D — Natural-language jump in Cmd+K

Typing "the Kazakh waterflood" resolves to the project through the retrieval
gateway rather than a fuzzy string match. (a) marginal, (b) no, (c) no, (d)
no. With under fifty projects a fuzzy match on name, country and client is
faster, offline and exact; AI adds nothing here yet. Not adopted; revisit when
the register exceeds a few hundred rows.

## Recommendation

Build the wave with **Option A** and fold **Option C** into the globe. Keep
Option B on the wave-3 list next to P22 (rank and compare), which shares its
data.

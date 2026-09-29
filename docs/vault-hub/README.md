# ATC Vault & Hub — design pack

**Status: Gate 1 decided (29 Sep 2026, all eleven decisions recorded in `03-choice-sheet.md`). Gate 2 (approval of the Markup in `06-architecture.md`) is open. Nothing has been built.**

This folder is the complete design for the Alpha Technical Centre internal
platform: a **Vault** (every run, version, evaluation, client file, letter,
email, spreadsheet, mined paper and regulator feed, with provenance and legal
tags) and a **Hub** (the staff dashboard that guarantees everyone works from the
current tool versions and the latest runs, and an assistant that drafts emails,
reports and calculation notes with everything relevant taken into account).

It was produced with the Tooler process (research → choose → gap → innovate →
approve → build). Read in order:

| File | Phase | What it is |
|---|---|---|
| `01-baseline.md` | 0 | What exists today, verified in the repo |
| `02-practice-scan.md` | 1 | Practice Scan: what the best analogous systems do, with sources |
| `03-choice-sheet.md` | 2 · **Gate 1** | Numbered decisions with a recommended default each. Chris decides. |
| `04-gap-statement.md` | 3 | The one falsifiable paragraph: what nobody does that we can |
| `05-innovation-options.md` | 4 | Four AI-leveraged responses to the gap; one recommended |
| `06-architecture.md` | 5 · **Gate 2** | The Markup: system design, data model, surfaces, acceptance criteria, smoke plan, risks, rollback |
| `07-build-plan.md` | 5 | Module breakdown, build waves, which model tier builds what, cost model |
| `modules/M*.md` | 5 | One contract per module: interfaces, fixtures, acceptance criteria, smoke tests |
| `schemas/*.json` | 5 | The seven JSON Schema contracts every module and every model builds against |

## How the module specs are meant to be used

Each `modules/M??-*.md` is written so that a *single* model session, given only
that file plus `schemas/`, `06-architecture.md` and the repo, can build the
module and prove it with the smoke tests listed in the spec. The tier column
says which class of model should do it (see `07-build-plan.md`). A cheaper
model that fails its smoke tests twice escalates one tier; nothing in Tier C
touches auth, scope filtering or schemas.

## Naming

- **Vault**: the store of record (Postgres + object storage) and its API.
- **Hub**: the staff dashboard at `/hub/` and the assistant behind it.
- **Run**: one execution of one tool version on one set of inputs, saved as an
  immutable record (`schemas/run-record.schema.json`).
- **Legal tag**: the confidentiality and contract envelope on every record
  (`schemas/legal-tag.schema.json`).
- **Lesson**: a firm-wide learning with evidence links, scope and validity
  (`schemas/lesson.schema.json`).

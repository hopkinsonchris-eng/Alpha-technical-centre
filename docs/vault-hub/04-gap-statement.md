# Phase 3 — Gap Statement

Nobody currently ties **the number that appears in a client letter** to **the
exact tool version, input versions and reference data that produced it**, and
then keeps that link alive: flagging the letter, the evaluation and the run the
moment any of those move on, offering to re-run the pinned inputs through the
current version, and explaining what changed in the answer. The evidence is on
both sides of the scan. Simulation data management (Teamcenter, Minerva) flags
out-of-sync results but stops at the CAE object; it does not know about
letters, emails or the client. Consulting knowledge systems (Lilli, iManage,
Glean) know about documents and confidentiality but have no notion of a run or
a tool version. MLOps registries (MLflow, W&B) know runs and versions but not
clients, contracts or correspondence. Our own state is the worst case: runs
live in individual browsers, versions are pinned by hand-bumped query strings,
and no letter can name the run it quotes. Doing this would win three things a
four-partner evaluation firm cannot otherwise afford: every deliverable
becomes reproducible to auditor standard (PRMS §1.2.0.12) at zero marginal
effort; nothing quietly goes out of date, because staleness propagates from
tool and data to every document that depends on them; and every drafting task
can be given the complete, scope-legal set of runs, letters, emails, papers
and lessons that bear on it, which is the precondition for learning to
cross projects instead of partners. The claim is falsifiable: if, after wave
2, a partner can still send a number the Hub cannot trace to a run, a tool
version and a legal tag, the gap has not been closed.

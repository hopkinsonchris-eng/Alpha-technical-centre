# Wave 6 — Choice Sheet (Gate 1)

Answered by Chris Hopkinson on 4 October 2026, quoted verbatim. Later artifacts cite these numbers.

| # | question | decision (verbatim) | adopts |
|---|---|---|---|
| D60 | How should a person's mailbox reach the Vault? | "OAuth at first sign-in (Recommended)" | P50; rules out admin forwarding and app passwords by hand (IMAP stays as a fallback source for `info@`) |
| D61 | What does the firm see of a connected mailbox by default? | "Everything, with Protected and Blocked lists (Recommended)" | P54 (Attio's two levels; Affinity's per-person level kept as an option the person may lower to) |
| D62 | How much history should arrive when a mailbox is connected? | "180 days, newest first, capped (Recommended)" | P55 |
| D63 | Should the Hub send mail, or only record it? | "Send from the person's mailbox, confirm first (Recommended)" | P60 |

Taken as given from the brief (no question asked): P51 filing memory, P52 status per message, P53 one record per Message-Id, P56 bulk apart from human, P57 who last spoke to them, P58 transparency and withdrawal, P59 WorkDrive changes cursor and Books by modified time, and the owner-side session settings (Access to one month, no Private tabs).

Standing constraints carried from earlier waves: schemas in `docs/vault-hub/schemas/` unchanged; hide, never delete; runs and items immutable; `isVisible` on every read; no secrets to browsers; bilingual chrome; public pages byte-identical.

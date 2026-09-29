# Decision Log

| When | Gate / event | Record |
|---|---|---|
| 2026-09-29 | Gate 1 | D1–D11 decided, all recommended defaults, D11 Zoho Books. Verbatim in `03-choice-sheet.md`. Requirements R1 (complete inventory) and R2 (letter-ready vault) added. |
| 2026-09-29 | Gate 2 | Markup `06-architecture.md` approved: "Approved. Start building. I would like to see mockups of the system". |
| 2026-09-29 | Build start | Mockups of every Hub screen first, then wave 0 (M00, M01), then wave 1 (M02–M06). Evidence of done per module is recorded below as it lands. |

## Shipped (append as modules land)

| Module | Commit | Tests | Visual proof |
|---|---|---|---|
| M00 Ontology, schemas, master and reference data | wave-0 commit | `vault/npm test`: legal (6, property-based), schemas (10, 42 fixtures + AC15 seed), db (3) green | n/a (no surface) |
| M01 Infrastructure, auth, CI | wave-0 commit | auth (5) green; CI workflow with AC12 and AC13 checks; Access checklist in `vault/README.md` awaiting the Cloudflare and Supabase steps only Chris can do | n/a |

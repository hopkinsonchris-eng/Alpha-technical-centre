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
| Mockups (all nine Hub screens) | ea47d2b | n/a | `docs/vault-hub/mockups/*.png`; `hub/mockups/index.html` clickable |
| M03 Tool registry and catalog | 775a37d | catalog (14) green; register pins follow `tool.json` | n/a |
| M04 Vault client library | 5224720 | vault-client (9) green; e2e smoke loads it in Chromium | n/a |
| M08 Staleness rules (engine only; re-run and delta note follow M05/M13) | ab151f5 | staleness (6) green incl. AC4 set and idempotence | n/a |
| M02 Vault API core | see git log | vault api/audit/seed tests (59) green; 83 total | n/a |
| M05 Opportunity Register capture | ceb7096 | e2e (3) green | `docs/vault-hub/evidence/m05-opportunity-register.png` |
| M05 APEX Reservoir 3D capture, browser key removed | see git log | e2e (3) green; AC12 grep clean | `docs/vault-hub/evidence/m05-reservoir-simulator.png` |
| M06 Hub Today page and settings | see git log | e2e (10) green incl. axe WCAG 2 A/AA | `docs/vault-hub/evidence/m06-hub-today.png` |
| M05 ELA Studio, Nodal Analysis, Financial Model, Plan Your Job capture | 6deadc7, ece8f6f, 17ef913, 2d4d07d | e2e 3+2+2+2 green | `docs/vault-hub/evidence/m05-*.png` |
| M08 re-run, delta note, review queue | 7c049e5 | rerun (3) + hash (2) green; AC5 proven headlessly against the Register fixture | n/a (Hub surface in M07) |
| M05 ELA Model Suite capture | b62e35d | e2e (5) green | `docs/vault-hub/evidence/m05-ela-model-suite.png` |
| M05 APEX external-app adapters (D6): push with app tokens, re-run adapters, nightly snapshot | bd0cedc | app-tokens (7) + adapters (7) green; 102 vault tests | n/a; developer contract in `vault/src/adapters/README.md` |
| M07 Project file and tool pages | see git log | e2e (23) green; 33 with Today | `docs/vault-hub/evidence/m07-project.png`, `m07-tool.png` |
| M12 core: scope predicate and hybrid search | ed0cf70 | gateway (4) green; oracle over every chunk/scope/role; 10,000-query property with zero cross-client hits (30 s) | n/a (Find page follows with the search route) |
| M13 core: letter rendering (HTML, DOCX, PDF) and drafting with enforced citations | c2b2f59, 3b6a272 | render (4) + draft (6) green; AC15 context assembled from the Vault alone | `docs/vault-hub/evidence/m13-letter.png`, `.pdf`, `.docx` |

# Module specs

One file per module, numbered in dependency order. Each is self-sufficient for
a single model session at the stated tier. See `../07-build-plan.md` for
tiers, waves and the session procedure, and `../schemas/` for the contracts.

| Wave 0 | Wave 1 | Wave 2 | Wave 3 | Wave 4 |
|---|---|---|---|---|
| M00 Ontology and schemas | M02 Vault API core | M07 Project and tool pages | M09 Document ingest | M12 Retrieval gateway |
| M01 Infrastructure, auth, CI | M03 Tool registry and catalog | M08 Staleness engine and re-run | M10 Correspondence capture | M13 Drafting assistant |
| | M04 Vault client library | | M11 Research and public-data miners | M14 MCP server, skills, hooks |
| | M05 Tool run capture | | | M15 Lessons and weekly dream |
| | M06 Hub shell and Today page | | | M16 Analogue memory |
| | | | | M17 Evaluation, scorecards, cost |

Fixtures referenced by the specs live in `vault/test/fixtures/` once M00 is
built; until then the examples in `../schemas/` are the contract.

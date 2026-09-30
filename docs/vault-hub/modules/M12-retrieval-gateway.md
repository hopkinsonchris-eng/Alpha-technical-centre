# M12 — Retrieval gateway

**Wave 4 · Tier A writes the scope predicate and the leakage test; Tier B implements search · Depends on: M09 · Size M**

## Purpose
The single door through which any model or page reads the Vault: scope
mandatory, hybrid search, rerank, expiry, audit. Every AI feature inherits
confidentiality from here.

## Read first
`../02-practice-scan.md` P5, P11; `../06-architecture.md` §4 F5, §7; `vault/src/legal.ts` (M00).

## Deliverables
- `vault/src/gateway/scope.ts` (Tier A): `buildPredicate(scope: Scope, person: Person, now): SQL` producing `WHERE` terms on `chunks.legal_tag`, `client_id`, `project_id`, expiry; scope grammar `project:<id>` | `client:<id>` | `firm` | `public`; a project scope means `project ∪ same-client items marked shareable ∪ firm ∪ public`. Nothing else is expressible.
- `vault/src/gateway/search.ts`: `search(q, scope, k=20)`: BM25 (Postgres `ts_rank_cd`) top 50 ∪ vector top 50, both with the predicate inside the query, fused by reciprocal rank fusion, reranked by Voyage rerank (interface with a fake), returns `SearchHit {ref, item_id|run_id, version, score, snippet, anchor, legal_tag}`.
- Structured retrieval helpers: `runsFor(scope, filters)`, `lessonsFor(scope)`, `peopleWhoWorked(topic, scope)` (authors of hits, ranked by recency).
- `GET /api/search?q=&scope=` (400 without scope), used by `vault.find` (M04) and the Hub search page `hub/search.html` (Tier C).
- Every call writes an audit event with the person, scope, query hash and returned refs.

## Acceptance criteria
1. Property test: seeded corpus with three clients; 10,000 random queries in `project:A` scope return zero chunks tagged `client-nda` for B or C (AC6).
2. Request without scope is 400; a scope the person is not entitled to (associate not on the project) is 403.
3. Expired-tag chunks never appear (AC7).
4. Exact identifiers (a well name, `potential.js 2.1.0`) rank first from BM25 even when vectors disagree.
5. p95 latency < 800 ms on a 100k-chunk corpus locally with the fake reranker.

## Smoke tests
`vault/test/gateway.scope.test.mjs` (property test with fast-check), `gateway.search.test.mjs`, `gateway.audit.test.mjs`.

## Out of scope
Drafting, MCP transport.

# M00 — Ontology, schemas, master and reference data

**Wave 0 · Tier A · Depends on: nothing · Size S**

## Purpose
Freeze the contracts every other module builds against: the seven JSON Schemas,
the Postgres DDL, the legal-tag inheritance rule, and the seed master data.

## Read first
`../06-architecture.md` §2–3, `../schemas/*.json`, `js/analogues.js` (existing
play types), `insights-data/radar-ledger.json` (existing ledger shape).

## Deliverables
- `docs/vault-hub/schemas/*.json` reviewed and marked `1.0.0` in `$id`.
- `vault/db/001_init.sql`: tables listed in `06` §3 (including `organisations`, `contacts`, `dispatches`, `firm_assets`, and a `reference_counters` table for `ATC-<yyyy>-<nnnn>` numbering) with foreign keys, `chunks.embedding vector(1024)`, `chunks.tsv tsvector` with a GIN index, `audit_events` append-only (revoke UPDATE/DELETE).
- `vault/src/legal.ts`: `unionTags(tags: LegalTag[]): LegalTag` (most restrictive classification wins, earliest expiry wins, client_id must agree or the result is `client-nda` with both clients listed in `notes` and a `conflict: true` facet) and `isVisible(tag, scope, now)`.
- `vault/master/{basins,fields,wells}.json`: Latin America seed (Colombia, Venezuela, Brazil, Argentina, Peru, Ecuador, Trinidad, Mexico, Guyana) with stable ids `basin:llanos`, `field:<basin>:<slug>`, sourced from regulator lists; each entry carries `source_url`.
- `vault/reference/price_decks/README.md` and one example deck; `vault/reference/fiscal_terms/README.md` and one example regime; each with an `id`, `as_of`, `source`.
- `vault/master/people.json` with each partner's signature block; `vault/firm/assets/` with the ATC letterhead (EN and ES, DOCX and PDF background), letter and report templates, logos and the house-style note, each registered as a `firm-asset` item with a version.
- `vault/test/fixtures/`: at least 3 valid and 3 invalid examples per schema, plus one seeded counterparty with contacts, an NDA and six dispatches (used by AC15).

## Contract
```ts
export type LegalTag = /* schemas/legal-tag */;
export function unionTags(tags: LegalTag[]): LegalTag;
export type Scope = { project_id?: string; client_id?: string; include_firm: boolean; include_public: boolean };
export function isVisible(tag: LegalTag, scope: Scope, now: Date): boolean;
```

## Acceptance criteria
1. Every fixture validates or fails exactly as labelled under a Draft 2020-12 validator.
2. `unionTags` is commutative and idempotent; a union containing any `client-nda` tag is `client-nda`; expiry is the minimum.
3. `isVisible` returns false for an expired tag in every scope, and false for client B's NDA tag in a client A scope.
4. `001_init.sql` applies cleanly to an empty Postgres 16 with pgvector; `audit_events` refuses UPDATE and DELETE.
5. Master data has no duplicate ids and every field has a parent basin.

## Smoke tests (write first)
`vault/test/schemas.test.mjs`, `vault/test/legal.test.mjs` (property test over random tag lists), `vault/test/db.test.mjs` (applies DDL in a container or against a test database URL from env).

## Out of scope
Any HTTP handler, any UI.

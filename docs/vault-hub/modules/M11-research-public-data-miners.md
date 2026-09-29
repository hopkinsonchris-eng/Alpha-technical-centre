# M11 — Research and public-data miners

**Wave 3 · Tier C per feed adapter (fixed interface) · Tier B for extraction and orchestration · Depends on: M09 · Size M**

## Purpose
Papers and regulator data arrive on a schedule as Vault Items with structured
facts, and the existing insight-radar reads from the Vault rather than a
gitignored folder.

## Read first
`../02-practice-scan.md` Appendix A "Literature and public data" (endpoints and limits), `.claude/skills/insight-radar/SKILL.md`, `insights-data/radar-ledger.json`, `vault-item.schema.json`, `analogue-row.schema.json`.

## Adapter interface (all adapters, Tier C, one file each)
```ts
export interface FeedAdapter {
  id: string;                                   // 'semantic-scholar' | 'crossref' | 'openalex' | 'anh-co' | 'anp-br' | 'ar-energia' | 'perupetro' | 'sec-edgar' | 'eia'
  schedule: 'weekly'|'monthly';
  fetch(since: Date, topics: TopicSpec[]): AsyncIterable<FeedRecord>;   // FeedRecord = {external_id, url, title, authored_at, authors, text?, file?: Buffer, mime?, meta}
  rateLimit: { perSecond: number };
}
```
Adapters: Semantic Scholar bulk search + Recommendations seeded from vault papers (free key, 1 req/s); Crossref `from-index-date`; OpenAlex `from_publication_date`; ANH Colombia Socrata (`fdvb-hsrf`, `5dux-bfvx`, `4dai-7crq`); ANP Brazil monthly per-well CSV; Argentina CKAN datastore with a 4 req/s throttle; Perupetro Excel downloads; SEC `data.sec.gov` company facts for a configured list of issuers; EIA API v2 series list.

## Deliverables
- `vault/src/miners/<adapter>.ts` per adapter, `miners/run.ts` orchestrator (topics from `vault/master/topics.json`, dedupe on DOI/external id/fuzzy title, negative keywords), every fetched record becomes an Item (`type: paper` or `feed-snapshot`, `legal_tag` `lt-firm-public` or the licence tag, `origin` filled) with a manifest `{url, fetched_at, sha256, rows}`.
- `vault/src/miners/paper-facts.ts` (Tier B): LLM extraction of `analogue-row` properties and a `paper_facts` block with evidence quotes; Batch API; skipped for abstracts under 400 characters.
- OnePetro rule: metadata and abstract only; never fetch PDFs; any individually licensed PDF is uploaded manually with the subscription tag.
- Radar bridge: `insights-data/radar-ledger.json` imported as Items; the skill's reading list is generated from `GET /api/items?type=paper&since=`.

## Acceptance criteria
1. Each adapter's conformance test yields ≥ 1 record from a recorded response and respects its rate limit under a mock clock.
2. Re-running a miner with no upstream change creates zero new Items.
3. Paper-facts extraction on the 20-paper fixture produces rows that validate, with an evidence quote for every numeric property.
4. No adapter fetches from `onepetro.org` (static test on the source).
5. The radar skill runs end-to-end with the Vault as its source on a seeded week.

## Smoke tests
`vault/test/miners.<adapter>.test.mjs` (recorded), `miners.dedupe.test.mjs`, `paper-facts.test.mjs`.

## Out of scope
Ranking papers for the article (stays in the skill).

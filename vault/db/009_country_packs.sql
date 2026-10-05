-- ATC Vault schema 009 (wave 7 PR4 and PR5, docs/vault-hub/wave7/05-markup.md §1.8; proposals 04-step-changes.md P1).
-- The country opening pack: ten sections per country, each drafted only from stored public originals with every
-- sentence cited, each with its own time to live and freshness. Public scope, built from public sources only.
-- Additive: a new table only. Builds run as rows in `jobs` (name 'country-pack').
CREATE TABLE IF NOT EXISTS country_packs (
  id            uuid PRIMARY KEY,
  country       char(2) NOT NULL,
  section       text NOT NULL,                       -- one of the ten section ids in vault/src/country/types.ts
  version       int NOT NULL DEFAULT 1,              -- a rebuild writes a new version; older rows stay (rule 9)
  body          jsonb NOT NULL,                      -- {sentences: [{en, es, cites: ['doc:<id>', …]}], questions: [{en, es}], changed_since: [{en, es}], headline: {en, es}}
  source_items  text[] NOT NULL DEFAULT '{}',        -- the item ids (stored originals) this version was drafted from
  sources       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- the registry entries used: [{id, url, licence, attribution, fetched_at, item_id, sha256, reachable}]
  ttl_days      int NOT NULL,                        -- from the registry's section TTL at build time
  status        text NOT NULL CHECK (status IN ('fresh','due','stale','unreachable','empty')),
  stale_reason  text,                                -- 'ttl' | 'source_changed:<item_id>' | 'unreachable:<source id>'
  built_at      timestamptz NOT NULL DEFAULT now(),
  built_by      text,                                -- person id, or 'job:<id>' for the cron
  model         text,
  spend_gbp     numeric,
  superseded_by uuid REFERENCES country_packs(id),
  UNIQUE (country, section, version)
);
CREATE INDEX IF NOT EXISTS country_packs_country_idx ON country_packs (country, section, version DESC);

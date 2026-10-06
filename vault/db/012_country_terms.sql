-- ATC Vault schema 012 (wave 7 pack rework, docs/vault-hub/wave7/07-pack-rework.md). The terms card: the fixed facts a
-- petroleum engineer wants first about a country (contract regime, state share, royalty, income tax, special taxes,
-- cost recovery, stability, local content, regulator, national oil company, how acreage is awarded, sanctions), each
-- value cited to stored originals and dated. Versioned like the sections: supersede, never overwrite. Additive.
CREATE TABLE IF NOT EXISTS country_terms (
  id            uuid PRIMARY KEY,
  country       char(2) NOT NULL,
  version       integer NOT NULL,
  fields        jsonb NOT NULL,                     -- {term_id: {en, es, cites[], as_of} | null}
  questions     jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{en, es}]: what no original answered
  source_items  text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'fresh' CHECK (status IN ('fresh','due','stale','empty')),
  stale_reason  text,
  built_at      timestamptz NOT NULL,
  built_by      text NOT NULL,
  model         text,
  spend_gbp     numeric(10,4) NOT NULL DEFAULT 0,
  superseded_by uuid REFERENCES country_terms(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, version)
);
CREATE INDEX IF NOT EXISTS country_terms_head_idx ON country_terms (country) WHERE superseded_by IS NULL;

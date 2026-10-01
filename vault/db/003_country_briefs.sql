-- ATC Vault schema 003 (wave 2, docs/vault-hub/wave2/05-markup.md §1.6).
-- Country briefs are cached per legal scope and per source set, never written
-- to items, so a brief can never widen anyone's scope. A row is served only
-- to a caller who may see every tag in `tags`, and only while `source_hash`
-- still matches what the Vault holds for the country.
CREATE TABLE IF NOT EXISTS country_briefs (
  id            bigserial PRIMARY KEY,
  country       char(2) NOT NULL,
  language      text NOT NULL DEFAULT 'en',
  scope_hash    text NOT NULL,                       -- hash of the sorted legal tags the sources carry
  source_hash   text NOT NULL,                       -- hash of the source set (refs, versions, stages)
  tags          text[] NOT NULL DEFAULT '{}',
  body          jsonb NOT NULL,                      -- {paragraphs, citations, sources, warnings, questions, projects}
  model         text,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS country_briefs_lookup_idx ON country_briefs (country, language, scope_hash, source_hash);

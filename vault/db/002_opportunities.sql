-- ATC Vault schema 002 (wave 2, docs/vault-hub/wave2/05-markup.md §1.3).
-- An opportunity is a project with status 'prospect'; the register's summary
-- fields live on the project so the Hub globe, the register table and the
-- project file share one id from first screen to closed job. Additive only.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS country        char(2),                                   -- ISO 3166-1 alpha-2, upper case
  ADD COLUMN IF NOT EXISTS lat            double precision,
  ADD COLUMN IF NOT EXISTS lon            double precision,
  ADD COLUMN IF NOT EXISTS stage          text NOT NULL DEFAULT 'Initial screen',
  ADD COLUMN IF NOT EXISTS stage_history  jsonb NOT NULL DEFAULT '[]'::jsonb,        -- [{stage, at, by}], append only
  ADD COLUMN IF NOT EXISTS register       jsonb NOT NULL DEFAULT '{}'::jsonb;        -- source, current, plan, risk, risk_score, attractiveness, thesis, next, owner, risks

CREATE INDEX IF NOT EXISTS projects_country_idx ON projects (country);

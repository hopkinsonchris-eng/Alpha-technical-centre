-- ATC Vault schema 013 (wave 8, docs/vault-hub/wave8/01-risk-lens.md §3).
-- One row a day per country the firm holds a project in, written the first time the countries summary fetches
-- World Monitor's Instability Index that day. Insurers show the change since last quarter beside every rating;
-- this table is what makes "+5 in 30 days" true for our countries without re-reading the feed. Additive: one table.
CREATE TABLE IF NOT EXISTS risk_snapshots (
  country          char(2) NOT NULL,
  day              date NOT NULL,
  score            numeric(6,2),                    -- World Monitor combined CII score, 0-100
  level            text,                            -- advisory level as the feed words it
  trend            text,                            -- rising | stable | falling
  sanctions_active boolean,
  sanctions_count  integer,
  components       jsonb,                           -- the CII component contributions as fetched
  fetched_at       timestamptz NOT NULL,
  PRIMARY KEY (country, day)
);
CREATE INDEX IF NOT EXISTS risk_snapshots_country_day_idx ON risk_snapshots (country, day DESC);

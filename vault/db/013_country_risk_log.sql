-- ATC Vault schema 013 (wave 8 risk on the map, docs/vault-hub/wave8/01-risk-on-the-map.md, W8-AC1). Every World Monitor
-- reading the countries summary fetches is appended here once per computed_at, so the Hub and the connector can say
-- what changed since the previous reading. Append-only: never updated, never deleted. Additive.
CREATE TABLE IF NOT EXISTS country_risk_log (
  id               bigserial PRIMARY KEY,
  country          text NOT NULL,
  score            numeric,
  level            text,
  trend            text,
  sanctions_active boolean,
  sanctions_count  integer,
  computed_at      timestamptz NOT NULL,
  fetched_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (country, computed_at)
);
CREATE INDEX IF NOT EXISTS country_risk_log_country_idx ON country_risk_log (country, computed_at DESC);

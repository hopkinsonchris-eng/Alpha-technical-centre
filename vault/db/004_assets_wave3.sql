-- ATC Vault schema 004 (wave 3, docs/vault-hub/wave3/05-markup.md §1.6).
-- Fields carry a location and the source it came from (a gazetteer record or a
-- document, never the model's memory); the review queue gains the 'asset' kind
-- for fields a document names. Additive; the kind constraint is widened only.
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS lat             double precision,
  ADD COLUMN IF NOT EXISTS lon             double precision,
  ADD COLUMN IF NOT EXISTS location_source text,                 -- gem | geonames | wikidata | document | manual
  ADD COLUMN IF NOT EXISTS status          text,
  ADD COLUMN IF NOT EXISTS created_by      text,
  ADD COLUMN IF NOT EXISTS created_at      timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS assets_country_name_idx ON assets (country, lower(name));

ALTER TABLE review_queue DROP CONSTRAINT IF EXISTS review_queue_kind_check;
ALTER TABLE review_queue ADD CONSTRAINT review_queue_kind_check
  CHECK (kind IN ('lesson','nda-expiry','organisation','rerun-delta','reconfirm-lesson','stale','asset'));

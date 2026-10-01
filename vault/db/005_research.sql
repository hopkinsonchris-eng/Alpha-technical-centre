-- ATC Vault schema 005 (wave 4, docs/vault-hub/wave4/05-markup.md §1.6).
-- Research runs file findings as items and open proposals of kind 'research'
-- (operator, licence, production figure) beside the wave 3 'asset' kind. Runs
-- are rows in `jobs` (name 'research'). Additive; the kind constraint is widened only.
ALTER TABLE review_queue DROP CONSTRAINT IF EXISTS review_queue_kind_check;
ALTER TABLE review_queue ADD CONSTRAINT review_queue_kind_check
  CHECK (kind IN ('lesson','nda-expiry','organisation','rerun-delta','reconfirm-lesson','stale','asset','research'));
CREATE INDEX IF NOT EXISTS items_extracted_kind_project_idx ON items ((extracted->>'kind'), project_id);
CREATE INDEX IF NOT EXISTS jobs_name_status_idx ON jobs (name, status);

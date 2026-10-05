-- ATC Vault schema 011 (wave 7 PR6, docs/vault-hub/wave7/05-markup.md §1.9, W7-AC21). The review queue carries the
-- round watch's proposals as kind 'round', beside the asset, organisation and research proposals. Additive: one
-- constraint widened, nothing dropped.
ALTER TABLE review_queue DROP CONSTRAINT IF EXISTS review_queue_kind_check;
ALTER TABLE review_queue ADD CONSTRAINT review_queue_kind_check
  CHECK (kind IN ('lesson','nda-expiry','organisation','rerun-delta','reconfirm-lesson','stale','asset','research','round'));

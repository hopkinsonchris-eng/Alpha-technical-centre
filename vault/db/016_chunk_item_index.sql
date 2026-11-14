-- 14 Nov 2026: chunks had no index on item_id. Every per-file check the indexer makes (has this version been chunked?)
-- and the queue query's NOT EXISTS scanned the whole table, which grows by thousands of rows a day while Parker Creek
-- indexes; Find timed out at 60 seconds while those scans ran. Partial indexes, so run chunks cost nothing in them.
CREATE INDEX IF NOT EXISTS chunks_item_idx ON chunks (item_id, item_version) WHERE item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chunks_run_idx ON chunks (run_id) WHERE run_id IS NOT NULL;

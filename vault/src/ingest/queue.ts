/**
 * The ingest queue's SQL, shared by the job (src/jobs/ingest-sync.ts) and index health (./health.ts).
 *
 * It lives here, not in the job file, because of 14 Nov 2026: health.ts imported the job file, the app imports
 * health.ts, and the job builds the app (serviceSink) while its own module is still evaluating its top-level await.
 * That import cycle never settles, so every ingest run from #124 on hung before reading a file. Nothing the app
 * loads may import src/jobs/ingest-sync.ts (test/ingest.health.test.ts checks).
 */
import { HAS_OWN_TEXT_SQL } from './index.ts';

/** The ingest queue (params $2 SUPPORTED_EXTENSIONS, $3 EXTRACTOR_VERSION); index health reads the same queue. */
export const PENDING_WHERE = `
        WHERE NOT i.hidden AND (i.storage_key IS NOT NULL OR ${HAS_OWN_TEXT_SQL})
          AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.item_id = i.id AND c.item_version = i.version AND c.current)
          AND (coalesce(i.extracted->'ingest'->>'version', '') <> i.version::text
               -- marked unsupported by an older extractor, but its type is read now (LAS from 14 Nov 2026): once more
               OR (i.extracted->'ingest'->>'status' = 'unsupported' AND coalesce(i.extracted->'ingest'->>'ext_v', '1')::int < $3
                   AND lower(substring(coalesce(i.extracted->>'filename', i.title) from '\\.([A-Za-z0-9]{1,8})$')) = ANY($2::text[])))`;
export const PENDING_ORDER = `
        -- A file that failed before goes behind every file that has not, so one that fails every run (a bad key, a
        -- file the extractor chokes on) never holds the queue: before this, the oldest 200 were retried forever.
        ORDER BY CASE WHEN i.extracted->'ingest_error'->>'version' = i.version::text
                      THEN coalesce((i.extracted->'ingest_error'->>'attempts')::int, 1) ELSE 0 END,
                 -- a scan a run had no OCR time for waits behind the files that need none
                 CASE WHEN i.extracted->>'ocr_deferred' = i.version::text THEN 1 ELSE 0 END,
                 i.created_at`;

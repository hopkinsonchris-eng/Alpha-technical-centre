-- 14 Nov 2026: LAS well logs are now read (their headers: well, API number, company, curves). The 318 Parker Creek logs
-- were marked unsupported at their current version, which keeps them out of the queue for good; clearing that marker
-- puts them back, once. Only the derived ingest marker changes; the records do not.
UPDATE items SET extracted = extracted - 'ingest'
 WHERE extracted->'ingest'->>'status' = 'unsupported'
   AND lower(coalesce(extracted->>'filename', title)) ~ '\.las$';

-- Wave 9 (docs/vault-hub/wave9/01-project-folders.md): every project's records filed into one skeleton.
-- The skeleton is a view: a filing row says which folder a record sits in, how it got there and why. Rows are
-- append-only: a re-filing writes a new row and marks the old one superseded, so the history of every move stays.
CREATE TABLE IF NOT EXISTS folder_filings (
  id            uuid PRIMARY KEY,
  project_id    text NOT NULL REFERENCES projects(id),
  item_id       uuid NOT NULL REFERENCES items(id),
  folder        text NOT NULL,                     -- a skeleton key: 'legal', 'subsurface/wells/<asset id>', 'unsorted'
  doc_kind      text,                              -- what the record is (psc, joa, well-log…), for the folder checklists
  method        text NOT NULL CHECK (method IN ('rule','model','manual')),
  confidence    real,
  quote         text,                              -- the verbatim words the filing rests on (model filings)
  reason        text,
  filed_by      text NOT NULL,
  filed_at      timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid,                               -- the row that replaced this one
  superseded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS folder_filings_current ON folder_filings (item_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS folder_filings_project ON folder_filings (project_id) WHERE superseded_by IS NULL;

-- A partner's "not applicable" on an expected document (a checklist gap); the latest row per (project, folder, expect) wins.
CREATE TABLE IF NOT EXISTS folder_waivers (
  id            uuid PRIMARY KEY,
  project_id    text NOT NULL REFERENCES projects(id),
  folder        text NOT NULL,
  expect        text NOT NULL,
  waived        boolean NOT NULL,
  by_person     text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folder_waivers_project ON folder_waivers (project_id, folder, expect, at DESC);

ALTER TABLE review_queue DROP CONSTRAINT IF EXISTS review_queue_kind_check;
ALTER TABLE review_queue ADD CONSTRAINT review_queue_kind_check
  CHECK (kind IN ('lesson','nda-expiry','organisation','rerun-delta','reconfirm-lesson','stale','asset','research','round','folder'));

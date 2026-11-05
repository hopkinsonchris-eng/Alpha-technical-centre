-- M19 (docs/vault-hub/modules/M19-technology-register.md): the technology register.
-- Entries are firm knowledge built from public sources only (legal tag lt-firm). An entry is versioned by key: a
-- revision is a new row, and confirming it supersedes the previous confirmed row. Nothing is deleted; a retired
-- entry keeps every version. Citation counts, project conditions and project suggestions are append-only.
CREATE TABLE IF NOT EXISTS tech_entries (
  id            uuid PRIMARY KEY,
  key           text NOT NULL CHECK (key ~ '^[A-Z]{2}[0-9]{2,3}$'),   -- stable across versions: AL01, WH12, IR03
  version       integer NOT NULL CHECK (version >= 1),
  application   text NOT NULL,
  name          text NOT NULL,
  record        jsonb NOT NULL,                                       -- the validated body (technology/model.ts)
  content_hash  text NOT NULL,
  status        text NOT NULL CHECK (status IN ('proposed','confirmed','rejected','retired')),
  legal_tag     text NOT NULL DEFAULT 'lt-firm' REFERENCES legal_tags(id),
  author        text NOT NULL,                                        -- person id, 'import:<file>' or 'job:<name>'
  note          text,                                                 -- why this version: "new entry", "radar 2026-12 evidence"
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_by    text,
  decided_at    timestamptz,
  superseded_by uuid,
  superseded_at timestamptz,
  UNIQUE (key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS tech_entries_current ON tech_entries (key) WHERE status = 'confirmed' AND superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS tech_entries_app ON tech_entries (application, status);

-- Paper counts are metadata, not claims: appended monthly by the citation job, never confirmed, latest row wins.
CREATE TABLE IF NOT EXISTS tech_citations (
  id            uuid PRIMARY KEY,
  key           text NOT NULL,
  query         text NOT NULL,
  source        text NOT NULL,                                        -- 'semantic-scholar' | 'openalex' | 'import'
  since_2016    integer CHECK (since_2016 >= 0),
  since_2023    integer CHECK (since_2023 >= 0),
  counted_at    timestamptz NOT NULL DEFAULT now(),
  counted_by    text NOT NULL
);
CREATE INDEX IF NOT EXISTS tech_citations_key ON tech_citations (key, counted_at DESC);

-- A project's screening conditions (depth, API, water cut ...). Append-only: the latest row per project wins.
CREATE TABLE IF NOT EXISTS tech_conditions (
  id            uuid PRIMARY KEY,
  project_id    text NOT NULL REFERENCES projects(id),
  conditions    jsonb NOT NULL,
  note          text,
  set_by        text NOT NULL,
  set_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tech_conditions_project ON tech_conditions (project_id, set_at DESC);

-- What a project decided about an entry. Append-only: the latest row per (project, key) wins.
CREATE TABLE IF NOT EXISTS tech_suggestions (
  id            uuid PRIMARY KEY,
  project_id    text NOT NULL REFERENCES projects(id),
  key           text NOT NULL,
  entry_id      uuid NOT NULL REFERENCES tech_entries(id),            -- the version the decision was made on
  status        text NOT NULL CHECK (status IN ('suggested','shortlisted','dismissed')),
  note          text,
  by_person     text NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tech_suggestions_project ON tech_suggestions (project_id, key, at DESC);

-- Same lock as 015_lock_data_api.sql: row-level security with no policy, nothing granted to the Data API roles.
ALTER TABLE tech_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_citations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_conditions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_suggestions ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON tech_entries, tech_citations, tech_conditions, tech_suggestions FROM %I', r);
    END IF;
  END LOOP;
END $$;

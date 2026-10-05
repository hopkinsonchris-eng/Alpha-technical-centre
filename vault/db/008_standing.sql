-- ATC Vault schema 008 (wave 7 PR3, docs/vault-hub/wave7/05-markup.md §1.7; data review 03-data-hierarchy.md §5.1).
-- Data that flows the way engineers think: one dated, unit-bearing figure per project and job; dated obligations;
-- counterparties as linked organisations; where a project came from and how long its stage has been open; the
-- record kind as a column; a reviewed run; a brief that ages; advisory age flags kept apart from `stale`.
-- Additive: new tables and nullable or defaulted columns only. No Tier A schema file changes.

-- One queryable figure per project (and optionally per asset) and per job: the newest non-superseded run's
-- outputs, or the register's current/plan with provenance 'register'. Filled nightly by jobs/figures.ts.
CREATE TABLE IF NOT EXISTS project_figures (
  id            uuid PRIMARY KEY,
  project_id    text NOT NULL REFERENCES projects(id),
  asset_id      text REFERENCES assets(id),
  job           text NOT NULL,                                -- the run's job, or 'register'
  name          text NOT NULL,                                -- the output name (npv10, technical_potential_bopd, current, plan)
  value         numeric NOT NULL,
  unit          text NOT NULL,
  as_of         date NOT NULL,                                -- the run's created date, or the register's source date
  source_ref    text NOT NULL,                                -- run:<id> | doc:<id> | register
  provenance    text,                                         -- run | register | research
  run_status    text,                                         -- draft | reviewed | final (when the source is a run)
  superseded    boolean NOT NULL DEFAULT false,
  stale         boolean NOT NULL DEFAULT false,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, asset_id, job, name)
);
CREATE INDEX IF NOT EXISTS project_figures_project_idx ON project_figures (project_id);
CREATE OR REPLACE VIEW project_figures_current AS
  SELECT * FROM project_figures WHERE NOT superseded;

-- Dated obligations on a project. A dispatch cannot carry an expected-reply date (Tier A), so the date lives here
-- with ref = 'dispatch:<id>'. `register.next` stays as the display text until a milestone replaces it.
CREATE TABLE IF NOT EXISTS project_milestones (
  id            uuid PRIMARY KEY,
  project_id    text NOT NULL REFERENCES projects(id),
  kind          text NOT NULL CHECK (kind IN ('next_action','deadline','reply_due','expiry','data_room_closes')),
  title         text NOT NULL,
  due_at        date,
  owner         text REFERENCES people(id),
  ref           text,                                         -- dispatch:<id> | doc:<id> | run:<id> | tag:<id>
  done_at       timestamptz,
  created_by    text NOT NULL REFERENCES people(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_milestones_project_idx ON project_milestones (project_id, done_at, due_at);

-- The counterparties the register names, as links to the organisations mail capture already creates.
CREATE TABLE IF NOT EXISTS project_organisations (
  project_id       text NOT NULL REFERENCES projects(id),
  organisation_id  text NOT NULL REFERENCES organisations(id),
  role             text NOT NULL CHECK (role IN ('holder','government','partner','operator','regulator','counsel','vendor')),
  since            date,
  note             text,
  PRIMARY KEY (project_id, organisation_id, role)
);

-- Where a project came from (the email or document that started it) and how long its stage has been open.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS origin_ref        text,
  ADD COLUMN IF NOT EXISTS stage_changed_at  timestamptz;

-- The record kind, lifted out of jsonb so the timeline, activity and the foreground/background split can read it.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS kind text GENERATED ALWAYS AS (extracted->>'kind') STORED;
CREATE INDEX IF NOT EXISTS items_kind_idx ON items (kind);

-- A run becomes reviewed or final through a status route; the row's status was always the one mutable field.
ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS reviewed_by text REFERENCES people(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS age_flags   jsonb NOT NULL DEFAULT '[]'::jsonb;   -- advisory, never sets `stale`

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS age_flags   jsonb NOT NULL DEFAULT '[]'::jsonb;

-- A country brief ages: after max_age_days the Hub shows its date and offers Regenerate.
ALTER TABLE country_briefs
  ADD COLUMN IF NOT EXISTS max_age_days int NOT NULL DEFAULT 90;

-- The firm's own dated, citable view of a country (not a lesson: lessons have no country scope, Tier A).
CREATE TABLE IF NOT EXISTS country_notes (
  id            uuid PRIMARY KEY,
  country       char(2) NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  source_ref    text,
  authored_by   text NOT NULL REFERENCES people(id),
  authored_at   timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES country_notes(id)
);
CREATE INDEX IF NOT EXISTS country_notes_country_idx ON country_notes (country);

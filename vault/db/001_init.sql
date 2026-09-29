-- ATC Vault schema 001 (M00). Postgres 16 + pgvector. Applied by src/db/migrate.ts.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS people (
  id            text PRIMARY KEY,                -- email local part
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('partner','associate','service')),
  disciplines   text[] NOT NULL DEFAULT '{}',
  signature_block text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organisations (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('client','partner','operator','regulator','vendor','counsel','other')),
  country       text,
  jurisdiction  text,
  registered_address text,
  identifiers   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {tax_id, registration_no, domains[]}
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organisations_name_idx ON organisations (lower(name));

CREATE TABLE IF NOT EXISTS contacts (
  id            text PRIMARY KEY,
  organisation_id text NOT NULL REFERENCES organisations(id),
  name          text NOT NULL,
  role          text,
  emails        text[] NOT NULL DEFAULT '{}',
  phones        text[] NOT NULL DEFAULT '{}',
  postal_address text,
  language      text NOT NULL DEFAULT 'en',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contacts_emails_idx ON contacts USING gin (emails);

CREATE TABLE IF NOT EXISTS legal_tags (
  id            text PRIMARY KEY CHECK (id ~ '^lt-[a-z0-9-]{3,64}$'),
  classification text NOT NULL CHECK (classification IN ('public','firm','client-nda')),
  data_type     text NOT NULL CHECK (data_type IN ('public','first-party','second-party','third-party','transferred')),
  client_id     text REFERENCES organisations(id),
  contract_id   text,
  country_of_origin text[] NOT NULL DEFAULT '{}',
  originator    text NOT NULL,
  expires_at    date,
  personal_data boolean NOT NULL DEFAULT false,
  export_restricted boolean NOT NULL DEFAULT false,
  partners_only boolean NOT NULL DEFAULT false,
  notes         text,
  CHECK (classification <> 'client-nda' OR client_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS projects (
  id            text PRIMARY KEY,
  client_id     text REFERENCES organisations(id),
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('prospect','active','closed','archived')),
  default_legal_tag text NOT NULL REFERENCES legal_tags(id),
  asset_ids     text[] NOT NULL DEFAULT '{}',
  members       text[] NOT NULL DEFAULT '{}',              -- people ids
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);

CREATE TABLE IF NOT EXISTS project_contacts (
  project_id    text NOT NULL REFERENCES projects(id),
  contact_id    text NOT NULL REFERENCES contacts(id),
  PRIMARY KEY (project_id, contact_id)
);

CREATE TABLE IF NOT EXISTS assets (                       -- master data: basin / field / well / block
  id            text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('basin','field','reservoir','well','block','country')),
  name          text NOT NULL,
  parent_id     text REFERENCES assets(id),
  country       text,
  operator      text,
  source_url    text,
  props         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS assets_parent_idx ON assets (parent_id);

CREATE TABLE IF NOT EXISTS firm_assets (
  id            text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('letterhead','template','signature','logo','style')),
  language      text NOT NULL DEFAULT 'en',
  version       integer NOT NULL DEFAULT 1,
  path          text NOT NULL,
  content_hash  text,
  is_current    boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tools (
  id            text PRIMARY KEY,
  manifest      jsonb NOT NULL,                            -- tool.json, validated by schema
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id            uuid PRIMARY KEY,
  job           text NOT NULL,
  tool_version  text NOT NULL,
  tool_commit   text NOT NULL,
  author        text NOT NULL REFERENCES people(id),
  created_at    timestamptz NOT NULL,
  client_id     text REFERENCES organisations(id),
  project_id    text NOT NULL REFERENCES projects(id),
  asset_ids     text[] NOT NULL DEFAULT '{}',
  legal_tag     text NOT NULL REFERENCES legal_tags(id),
  title         text,
  record        jsonb NOT NULL,                            -- the full RunRecord
  input_hash    text NOT NULL,
  output_hash   text,
  status        text NOT NULL CHECK (status IN ('draft','reviewed','final','superseded')),
  supersedes    uuid REFERENCES runs(id),
  stale         boolean NOT NULL DEFAULT false,
  stale_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  hidden        boolean NOT NULL DEFAULT false,
  UNIQUE (job, tool_version, input_hash)
);
CREATE INDEX IF NOT EXISTS runs_project_idx ON runs (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS run_inputs (
  run_id        uuid NOT NULL REFERENCES runs(id),
  ref           text NOT NULL,                             -- run:<uuid> | doc:<uuid> | ref:<path> | tool:<id>
  kind          text NOT NULL CHECK (kind IN ('run','document','reference','asset','manual')),
  version       text,
  hash          text,
  role          text,
  PRIMARY KEY (run_id, ref)
);
CREATE INDEX IF NOT EXISTS run_inputs_ref_idx ON run_inputs (ref);

CREATE TABLE IF NOT EXISTS items (
  id            uuid PRIMARY KEY,
  type          text NOT NULL,
  title         text NOT NULL,
  created_at    timestamptz NOT NULL,
  authored_at   timestamptz,
  authors       text[] NOT NULL DEFAULT '{}',
  client_id     text REFERENCES organisations(id),
  project_id    text NOT NULL REFERENCES projects(id),
  asset_ids     text[] NOT NULL DEFAULT '{}',
  organisation_ids text[] NOT NULL DEFAULT '{}',
  legal_tag     text NOT NULL REFERENCES legal_tags(id),
  origin        jsonb NOT NULL,
  external_id   text,
  storage_key   text,
  mime          text,
  content_hash  text NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  supersedes    uuid REFERENCES items(id),
  reference_no  text,
  parent_id     uuid REFERENCES items(id),               -- attachments
  filing        jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted     jsonb NOT NULL DEFAULT '{}'::jsonb,
  stale         boolean NOT NULL DEFAULT false,
  stale_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  hidden        boolean NOT NULL DEFAULT false,
  tags          text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS items_project_idx ON items (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS items_external_idx ON items (external_id);
CREATE INDEX IF NOT EXISTS items_hash_idx ON items (content_hash);

CREATE TABLE IF NOT EXISTS item_versions (
  item_id       uuid NOT NULL REFERENCES items(id),
  version       integer NOT NULL,
  content_hash  text NOT NULL,
  storage_key   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, version)
);

CREATE TABLE IF NOT EXISTS item_cites (
  item_id       uuid NOT NULL REFERENCES items(id),
  ref           text NOT NULL,
  PRIMARY KEY (item_id, ref)
);
CREATE INDEX IF NOT EXISTS item_cites_ref_idx ON item_cites (ref);

CREATE TABLE IF NOT EXISTS dispatches (
  id            uuid PRIMARY KEY,
  item_id       uuid NOT NULL REFERENCES items(id),
  direction     text NOT NULL CHECK (direction IN ('out','in')),
  organisation_id text NOT NULL REFERENCES organisations(id),
  contact_ids   text[] NOT NULL DEFAULT '{}',
  channel       text NOT NULL CHECK (channel IN ('email','post','courier','portal','hand','fax')),
  occurred_at   timestamptz NOT NULL,
  reference_no  text,
  their_reference text,
  in_reply_to   uuid REFERENCES dispatches(id),
  signed_by     text REFERENCES people(id),
  acknowledged_at timestamptz,
  tracking      text,
  recorded_by   text NOT NULL,
  notes         text
);
CREATE INDEX IF NOT EXISTS dispatches_org_idx ON dispatches (organisation_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS reference_counters (
  year          integer PRIMARY KEY,
  last_no       integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lessons (
  id            uuid PRIMARY KEY,
  record        jsonb NOT NULL,
  scope         text NOT NULL,
  scope_id      text,
  legal_tag     text NOT NULL REFERENCES legal_tags(id),
  status        text NOT NULL CHECK (status IN ('proposed','confirmed','invalidated')),
  created_at    timestamptz NOT NULL,
  last_confirmed timestamptz,
  valid_to      timestamptz,
  superseded_by uuid REFERENCES lessons(id)
);

CREATE TABLE IF NOT EXISTS analogue_rows (
  id            uuid PRIMARY KEY,
  source_ref    text NOT NULL,
  asset_id      text NOT NULL,
  legal_tag     text NOT NULL REFERENCES legal_tags(id),
  provenance    text NOT NULL,
  as_of         date NOT NULL,
  row           jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS analogue_rows_asset_idx ON analogue_rows (asset_id);

CREATE TABLE IF NOT EXISTS chunks (
  id            bigserial PRIMARY KEY,
  item_id       uuid REFERENCES items(id),
  run_id        uuid REFERENCES runs(id),
  item_version  integer,
  ordinal       integer NOT NULL,
  anchor        text,
  context       text NOT NULL DEFAULT '',
  text          text NOT NULL,
  legal_tag     text NOT NULL REFERENCES legal_tags(id),
  client_id     text,
  project_id    text NOT NULL,
  partners_only boolean NOT NULL DEFAULT false,
  expires_at    date,
  current       boolean NOT NULL DEFAULT true,
  embedding     vector(1024),
  tsv           tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(context,'') || ' ' || text)) STORED,
  CHECK (item_id IS NOT NULL OR run_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_scope_idx ON chunks (project_id, client_id, legal_tag);

CREATE TABLE IF NOT EXISTS filing_queue (
  id            uuid PRIMARY KEY,
  item_id       uuid NOT NULL REFERENCES items(id),
  suggestions   jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{project_id, confidence}]
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','dismissed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_by   text,
  resolved_at   timestamptz
);

CREATE TABLE IF NOT EXISTS review_queue (
  id            uuid PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('lesson','nda-expiry','organisation','rerun-delta','reconfirm-lesson','stale')),
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_by   text,
  resolved_at   timestamptz
);

CREATE TABLE IF NOT EXISTS jobs (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS mail_cursors (
  mailbox       text PRIMARY KEY,
  cursor        text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key           text PRIMARY KEY,
  value         jsonb NOT NULL,
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit log. UPDATE and DELETE are refused by trigger (works on
-- managed Postgres where role grants are not available to the app).
CREATE TABLE IF NOT EXISTS audit_events (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  person_id     text NOT NULL,
  action        text NOT NULL,
  scope         text,
  refs          text[] NOT NULL DEFAULT '{}',
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  tokens_in     integer,
  tokens_cached integer,
  tokens_out    integer,
  cost_usd      numeric(10,5)
);
CREATE INDEX IF NOT EXISTS audit_events_at_idx ON audit_events (at DESC);

CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

CREATE TABLE IF NOT EXISTS schema_migrations (
  name          text PRIMARY KEY,
  applied_at    timestamptz NOT NULL DEFAULT now()
);

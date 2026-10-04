-- ATC Vault schema 007 (wave 6, docs/vault-hub/wave6/05-markup.md §1.1, §1.2, §1.3, D60, D61).
-- Each person connects their own mailbox by OAuth consent; the Vault keeps one encrypted refresh token per
-- person, the person's privacy level and the cursors of the poll and the history. Exclusions become two-level
-- rules (Protected and Blocked; firm or personal). Filing decisions are remembered so one person's Assign
-- files everyone's copies. Additive: new tables and nullable columns only.
CREATE TABLE IF NOT EXISTS mailbox_connections (
  id                  uuid PRIMARY KEY,
  person_id           text NOT NULL REFERENCES people(id),
  provider            text NOT NULL DEFAULT 'zoho-mail' CHECK (provider IN ('zoho-mail')),
  address             text NOT NULL,                      -- the mailbox, as Zoho names it (lower case)
  account_id          text,                               -- Zoho accountId
  accounts_url        text NOT NULL,                      -- the data centre's accounts server (token refresh, revoke)
  api_url             text NOT NULL,                      -- the data centre's mail API host
  refresh_token_enc   text NOT NULL,                      -- sealed with VAULT_TOKEN_KEY; the plaintext never leaves the server
  scopes              text[] NOT NULL DEFAULT '{}',
  privacy             text NOT NULL DEFAULT 'all' CHECK (privacy IN ('all','subjects','none')),
  status              text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','error','revoked')),
  live_cursor         text,                               -- forward from the connection (set by the poll)
  history_cursor      text,                               -- backward through the window (set by the history job)
  history_window_days int NOT NULL DEFAULT 180,
  history_done_at     timestamptz,
  last_poll_at        timestamptz,
  last_error          text,
  connected_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz
);
-- One live connection per person; revoked rows stay as the record of what was held and when it was withdrawn.
CREATE UNIQUE INDEX IF NOT EXISTS mailbox_connections_live_idx ON mailbox_connections (person_id, provider) WHERE status <> 'revoked';

CREATE TABLE IF NOT EXISTS mail_rules (
  id          uuid PRIMARY KEY,
  owner_id    text REFERENCES people(id),                 -- NULL: the firm's rule (partners); else the person's own
  kind        text NOT NULL CHECK (kind IN ('protected','blocked')),
  pattern     text NOT NULL,                              -- an address, or a domain (no @); lower case
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_rules_unique_idx ON mail_rules (COALESCE(owner_id, ''), kind, pattern);

CREATE TABLE IF NOT EXISTS filing_decisions (
  id          uuid PRIMARY KEY,
  key_kind    text NOT NULL CHECK (key_kind IN ('thread','domain','attachment')),
  key         text NOT NULL,
  project_id  text REFERENCES projects(id),               -- NULL: not a project email
  item_id     uuid REFERENCES items(id),
  decided_by  text NOT NULL,
  decided_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS filing_decisions_key_idx ON filing_decisions (key_kind, key, decided_at DESC);

ALTER TABLE people ADD COLUMN IF NOT EXISTS last_seen_activity_at timestamptz;
ALTER TABLE people ADD COLUMN IF NOT EXISTS mailbox_prompt_hidden_until timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS relationship jsonb NOT NULL DEFAULT '{}'::jsonb;

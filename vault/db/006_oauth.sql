-- ATC Vault schema 006 (wave 5, docs/vault-hub/wave5/05-markup.md §1.4).
-- The Vault is an OAuth 2.1 authorisation server for its own MCP endpoint, so the Claude app
-- connects as the signed-in person. Clients (registered or Client ID Metadata Documents),
-- single-use authorisation codes and hashed tokens in rotating refresh families. Additive.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id            text PRIMARY KEY,                         -- a registered id, or the https URL of a client metadata document
  name          text NOT NULL,
  redirect_uris text[] NOT NULL DEFAULT '{}',
  metadata_url  text,                                     -- set for CIMD clients; refetched after an hour
  fetched_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES oauth_clients(id),
  person_id      text NOT NULL REFERENCES people(id),
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  resource       text NOT NULL,
  scope          text NOT NULL DEFAULT 'vault',
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash   text PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('access','refresh')),
  family       uuid NOT NULL,                               -- one connection: an access token and its rotating refresh tokens
  client_id    text NOT NULL REFERENCES oauth_clients(id),
  person_id    text NOT NULL REFERENCES people(id),
  scope        text NOT NULL DEFAULT 'vault',
  resource     text NOT NULL,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS oauth_tokens_family_idx ON oauth_tokens (family);
CREATE INDEX IF NOT EXISTS oauth_tokens_person_idx ON oauth_tokens (person_id, created_at DESC);

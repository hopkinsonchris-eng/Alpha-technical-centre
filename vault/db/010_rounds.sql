-- ATC Vault schema 010 (wave 7 PR6, docs/vault-hub/wave7/05-markup.md §1.9; proposal 04-step-changes.md P2, practice P63).
-- The licence round as a first-class object with a process timeline. Regulator pages are watched for change; a
-- changed page is read once to extract dated stages with a verbatim quote; nothing counts until a member confirms
-- it in the review queue. Additive: one new table.
CREATE TABLE IF NOT EXISTS round_events (
  id            uuid PRIMARY KEY,
  country       char(2) NOT NULL,
  round         text NOT NULL,                      -- the round's name as the regulator writes it ('33rd Offshore Licensing Round', 'Oferta Permanente OPC 5')
  stage         text NOT NULL CHECK (stage IN ('announced','data_package','qualification','bids_open','bid_deadline','award','signature','other')),
  event_date    date,                               -- the date the regulator gives for the stage, when it gives one
  title         text NOT NULL,                      -- one line: what happens at this stage
  quote         text NOT NULL,                      -- the verbatim sentence from the fetched page that states it
  source_item   uuid REFERENCES items(id),          -- the stored original (country-pack snapshot) the quote came from
  source_url    text NOT NULL,
  read_at       timestamptz NOT NULL,               -- the day the page was read
  status        text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','dismissed','superseded')),
  confirmed_by  text REFERENCES people(id),
  confirmed_at  timestamptz,
  superseded_by uuid REFERENCES round_events(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS round_events_country_idx ON round_events (country, status, event_date);

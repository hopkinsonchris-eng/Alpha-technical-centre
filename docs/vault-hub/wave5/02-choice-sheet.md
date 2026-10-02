# Wave 5 — Choice Sheet (Gate 1)

Answered 2 October 2026 by Chris Hopkinson. Decisions W5-D1 to W5-D4.

| # | Question | Answer (verbatim) | Practices |
|---|---|---|---|
| W5-D1 | Where should originals live so they survive deploys and are shared by the API and the crons? | "Supabase Storage (Recommended)" | P40 |
| W5-D2 | How far should the viewer go? | "PDF, images and spreadsheets inline; Word and PowerPoint download (Recommended)" | P40, P41, P42; P43 not adopted |
| W5-D3 | What should Write to… include? | "The full review loop (Recommended)" | P44, P45, P46, P47 |
| W5-D4 | How should the Claude app sign in to the Vault connector? | "OAuth in the Vault, Cloudflare Access as the login (Recommended)" | P48, P49 |

## Readings

- **W5-D1** means one private bucket in the Supabase project that already holds the database; the API and every cron write originals and derived text there through the existing `Storage` interface. Files uploaded to the live Vault before this wave were on the container disk and are gone; their text and chunks remain, and the record panel says "original missing" for them until they are uploaded again.
- **W5-D2** means the record panel opens PDFs in a canvas viewer (iPad Safari cannot embed a PDF beyond page one), images inline, spreadsheets as a table per sheet, and offers download for Word, PowerPoint and everything else. No server-side conversion.
- **W5-D3** means a Write to… action on the project page that shows what the draft does not know first, cites every factual sentence to a passage you can open, blocks approval while a sentence is uncited, lets you accept or reject paragraph by paragraph, picks the recipient from the project's contacts and counterparties, saves the draft as a note, renders to letterhead and records the sent version as a dispatch.
- **W5-D4** means the Vault becomes an OAuth 2.1 authorisation server for its own MCP endpoint: the authorise page sits behind Cloudflare Access, so each person signs in as themselves; the token endpoint and `/mcp` accept the Vault's own bearer tokens; every call stays scoped and audited per person. Custom connectors need a Pro, Max, Team or Enterprise plan.

# Wave 5 — Markup (Gate 2)

The project file you work from: durable originals, a viewer, Write to… with the review loop, and the Vault as a connector for the Claude app. Decisions W5-D1 to W5-D4. Four pull requests, each opened and merged when green.

## 1. BEFORE → AFTER

### 1.1 Durable originals (W5-D1, P40)

BEFORE: `VAULT_STORAGE` defaults to the filesystem; on Render that is the container disk, wiped at each deploy. The Supabase backend is a stub that refuses every call.

AFTER: `supabaseStorage()` in `vault/src/storage.ts` is real: private bucket `vault` (name from `VAULT_STORAGE_BUCKET`), plain `fetch` against the Storage REST API with the service key (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`), `put` with upsert, `get` returning bytes or null on 404, `exists` by a HEAD-style request; keys unchanged (`originals/<hash-prefix>/<sha256>`, `derived/<item-id>/…`). `VAULT_STORAGE=supabase` on the API and every cron in `render.yml` (sync: false for the two secrets). Boot logs which storage is open and refuses `filesystem` in production unless `VAULT_STORAGE_DIR` is set on purpose. A record whose original is missing from the store says so in the panel ("original missing: upload it again") instead of failing.

Setup for Chris (`vault/SETUP.md` §1.5): Supabase → Storage → New bucket `vault`, private; Project settings → API → service_role key → Render `SUPABASE_SERVICE_KEY` on atc-vault-api, atc-vault-research, atc-vault-miners; `SUPABASE_URL` is the project URL. Then upload the three High Tech Electronica files again.

### 1.2 Open the original (W5-D2, P40–P42)

BEFORE: the record panel shows the extracted text, facts, versions and the storage key. Nothing opens the file.

AFTER: `GET /api/items/:id/original` (new file `vault/src/api/originals.routes.ts`): scope-checked with `assertVisible`, streams the stored bytes with the record's `mime`, `Content-Disposition: inline; filename*=UTF-8''<title>` (or `attachment` with `?download=1`), `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Accept-Ranges: none`; 404 when the key is absent from the store; one audit event `item.view` with `{inline|download, version}`. `?version=N` serves an earlier version through `item_versions`.

Record panel (`hub/record.js`): a **View** card above Related for a document with an original:
- PDF: PDF.js (pdfjs-dist from cdnjs, worker from the same CDN) rendering pages lazily on canvas into a scroll container, page counter, zoom −/+, `maxCanvasPixels` clamped for iPad; the file fetched whole with the Access cookie.
- Images (`image/*`): an `<img>` from the same route.
- Spreadsheets (`xlsx`, `xls`, `csv`): SheetJS (`xlsx` from cdnjs) → one `<table>` per sheet behind sheet tabs, first row as header, capped at 2,000 rows with a "first 2,000 of N rows" note, download for the rest.
- Everything else (Word, PowerPoint, email, text): a **Download** button, and for `docx` the extracted text stays as today.
- Bilingual chrome, works in the bottom sheet below 1200 px. The public pages are untouched; `hub/*` stays `noindex`.

### 1.3 Write to… (W5-D3, P44–P47)

BEFORE: `POST /api/draft` and `POST /api/render` exist; the Hub has no door; the drafter reads neither the register counterparties nor the research findings.

AFTER, on the project page toolbar beside Research: **Write to…** opens the drafting panel (`hub/draft.js`, new; a panel under the toolbar, a bottom sheet on narrow screens):

1. **Set-up strip**: kind (Email · Letter · Report section · Calc note), language (EN/ES), **To** picked from the project's contacts (name, role, organisation, last contact date from dispatches) and from the register counterparties (holder, government, partners are offered as organisations to create a contact for when none exists), a scope warning when the recipient's organisation is not the client, the holder, a partner or the government of this project; and the **brief** (what to say).
2. **Draft** calls `POST /api/draft` with `organisation_id` from the recipient. The response renders as:
   - **What this draft does not know** first: each open question with the person to ask (from `who_to_ask`) and a one-tap "ask" that opens a mail to that colleague with the question.
   - **The draft**, paragraph by paragraph. Every citation `[doc:…]`/`[run:…]`/`[lesson:…]`/`[wm:…]` is a chip; tapping it opens the cited record in the record panel with the passage the drafter used (the `sources[].snippet` for that ref) highlighted at the top. A sentence with a figure and no citation is highlighted amber and counts against approval.
   - Per paragraph: **Keep**, **Keep with a note**, **Drop**. Tone buttons: Shorter · Longer · More formal · Plainer, each re-calling `/api/draft` with `tone` and re-running the uncited check.
   - **Sources used**: the records the drafter read, with "prior correspondence" marked.
3. **Save**: the draft is already a note (the API saves it); Save records the review (`paragraph decisions`, `citations_opened`, `review_seconds`) on the note's `extracted.review` through `PATCH /api/items/:id/review` (new, in `originals.routes.ts`'s sibling `draft.review.routes.ts`), and the dropped paragraphs are excluded from render. **Approve** is disabled while an amber sentence remains; a soft warning appears when no citation was opened.
4. **Render**: DOCX (default; PDF when the server has Chromium, otherwise the button says so) through `POST /api/render`; the file downloads and the panel shows the reference number.
5. **Mark as sent**: `POST /api/dispatches` (new route in the same file) records `direction out`, `organisation_id`, `contact_ids`, `channel` (email default), `occurred_at` now, `signed_by` the caller, linking the note; the timeline shows "Sent to <contact>, <org>" and the note is read-only from then on (a later edit is a new draft that supersedes).

Drafter changes (`vault/src/llm/draft.ts`): sub-queries also get the research tag so findings are retrieved (F17 closes); the context's organisation falls back to the register's holder when no `organisation_id` is given; the prompt lists the counterparties (holder, government, licence type, partners) as facts of the project with the register as their source `[doc:project:<id>]`… no: counterparties carry no citation, they are prompt context only and any sentence quoting them must cite the register note; the simplest faithful rule is that counterparties appear in the "About this project" block and are allowed as uncited names (not figures), as the client name already is.

### 1.4 The Vault as a Claude connector (W5-D4, P48–P49)

BEFORE: `POST /mcp` answers only to a Cloudflare Access token. The Claude app cannot present one, so the connector cannot be added.

AFTER: the Vault is an OAuth 2.1 authorisation server for its own MCP endpoint, and the connector URL is `https://www.alpha-technical-centre.com/mcp`. Every path below is served by the API (new files `vault/src/oauth/*.ts`, `vault/src/api/oauth.routes.ts`) and reached through the existing Worker; `VAULT_PUBLIC_URL` (default `https://www.alpha-technical-centre.com`) is the issuer.

| path | who may reach it | what it does |
|---|---|---|
| `GET /.well-known/oauth-protected-resource/mcp` | anyone | `{resource: "<issuer>/mcp", authorization_servers: ["<issuer>"], bearer_methods_supported: ["header"], scopes_supported: ["vault"]}` |
| `GET /.well-known/oauth-authorization-server` | anyone | issuer, `authorization_endpoint` `/oauth/authorize`, `token_endpoint` `/oauth/token`, `registration_endpoint` `/oauth/register`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `token_endpoint_auth_methods_supported: ["none"]`, `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true`, `scopes_supported: ["vault"]` |
| `POST /oauth/register` | anyone (rate-limited) | RFC 7591 dynamic registration of a public client: stores `redirect_uris`, `client_name`; answers 201 with `client_id`, no secret; refuses a redirect URI that is not `https://claude.ai/api/mcp/auth_callback` or a loopback (`http://localhost/…`, `http://127.0.0.1/…`, any port) |
| `GET /oauth/authorize` | **behind Cloudflare Access** (staff only) | validates `client_id` (a registered client, or a Client ID Metadata Document fetched from the `https` URL with the document's `client_id` equal to it and the `redirect_uri` listed; fetch guarded against private addresses and cached), exact `redirect_uri` (loopback ignores the port), `code_challenge` with `S256` (mandatory), `resource` equal to the canonical MCP URL, `state`; shows a bilingual consent page in house style naming the client's host and the signed-in person; **Allow** issues a single-use code (10 minutes) bound to person, client, redirect URI, challenge and resource, then redirects with `code` and `state`; **Cancel** redirects with `error=access_denied` |
| `POST /oauth/token` | anyone | form-encoded; `authorization_code` + `code_verifier` → `{access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope}`; `refresh_token` grant rotates the refresh token (30 days, reuse of a rotated token revokes the family); RFC 6749 errors (`invalid_grant`, `invalid_client`, `invalid_request`, `unsupported_grant_type`); `Cache-Control: no-store`; tokens are random, stored hashed, with `aud` = resource |
| `POST /mcp` | anyone with a token | `Authorization: Bearer <vault token>` → the person; else the Access token as today; else **401** with `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="<issuer>/.well-known/oauth-protected-resource/mcp"` |
| `GET /api/me/connections`, `DELETE /api/me/connections/:id` | the person | the apps connected to this account (client name, host, first and last use) and revocation; a **Connected apps** card on the Settings page |

Migration `vault/db/006_oauth.sql`: `oauth_clients` (id, name, redirect_uris, metadata_url, created_at), `oauth_codes` (code_hash, client_id, person_id, redirect_uri, code_challenge, resource, scope, expires_at, used_at), `oauth_tokens` (token_hash, kind, family, client_id, person_id, scope, resource, expires_at, revoked_at, created_at, last_used_at). Audit: `oauth.consent`, `oauth.token`, `oauth.revoke`. Rate limits: 30 requests a minute per address on `/oauth/*`, 120 tool calls a minute per person on `/mcp` with `Retry-After`.

MCP tools (`vault/src/mcp/server.ts`): every tool gets a `title`, `readOnlyHint` on reads, `destructiveHint: false` on writes, a description that says when not to use it; new `list_projects` (the projects in scope), `get_project_context` (the existing project-context builder: brief, counterparties, contacts, recent records, open proposals), `get_item` (a record with its extracted text, capped, and a Hub link), `file_item` (file a text note or a pasted document under a project, returns `doc:<id>`; the way a conversation's output stops living only in the conversation). `search_vault` hits carry a Hub link.

Setup for Chris (`vault/SETUP.md` §6):
1. Cloudflare Zero Trust → Access → Applications: edit **ATC Hub** and remove the `mcp` path. Add **ATC Connector login**, self-hosted, domain `www.alpha-technical-centre.com` path `oauth/authorize`, policy Staff (Allow, emails ending in the company domain). Add **ATC Connector**, same domain, paths `mcp`, `oauth/token`, `oauth/register`, `.well-known/oauth-authorization-server`, `.well-known/oauth-protected-resource`, policy **Bypass** for Everyone (the Vault checks its own tokens there).
2. Workers & Pages → `atc-api-proxy` → Domains & Routes: add `www.alpha-technical-centre.com/oauth*` and `www.alpha-technical-centre.com/.well-known/oauth*`.
3. Render → atc-vault-api: `VAULT_PUBLIC_URL=https://www.alpha-technical-centre.com`.
4. Claude app (iPad or web, Pro, Max, Team or Enterprise; an owner on Team): Settings → Connectors → Add custom connector: name `ATC Vault`, URL `https://www.alpha-technical-centre.com/mcp`, OAuth client **Register automatically**. Connect: the Access login appears (one-time PIN), then the consent page, then the connector is live. The same connector appears in Claude Code under the same account.

## 2. Files

| area | files |
|---|---|
| storage | `vault/src/storage.ts` (supabase backend), `vault/src/db/boot.ts` (storage check), `render.yml`, `vault/.env.example`, `vault/SETUP.md` §1.5 |
| original | `vault/src/api/originals.routes.ts` (new), `hub/record.js`, `hub/hub.css`, `hub/project.js` (panel height for the viewer) |
| drafting | `hub/draft.js` (new), `hub/project.html` (panel host), `hub/project.js` (toolbar button), `hub/hub.css`, `vault/src/api/draft.review.routes.ts` (new: review, dispatches), `vault/src/llm/draft.ts` (research tag, counterparties, tone), `vault/src/api/draft.routes.ts` (accepts `tone`, excludes dropped paragraphs at render) |
| connector | `vault/db/006_oauth.sql`, `vault/src/oauth/*.ts` (new), `vault/src/api/oauth.routes.ts` (new), `vault/src/api/mcp.routes.ts` (bearer tokens), `vault/src/mcp/server.ts` (tool annotations, `get_item`, `get_project_context`, `file_item`), `cloudflare/api-proxy.js` (comment only), `vault/SETUP.md` §6, `render.yml` |
| docs | `docs/vault-hub/wave5/*`, `HANDOVER.md`, `AGENTS.md` (no rule change) |

Not touched: `docs/vault-hub/schemas/*`, any public page.

## 3. Acceptance criteria

| # | criterion |
|---|---|
| W5-AC1 | With `VAULT_STORAGE=supabase` and a stubbed fetch, `put` posts to `/storage/v1/object/<bucket>/<key>` with the service key and upsert, `get` returns the bytes and null on the store's not-found answer, `exists` uses the info endpoint; an upload through `POST /api/items` lands in the store and is read back by ingest; boot refuses filesystem storage in production without an explicit directory. |
| W5-AC2 | `GET /api/items/:id/original` streams the bytes with the record's mime, inline by default and attachment with `?download=1`, `no-store`, one `item.view` audit event; 404 for a hidden record, a record outside the caller's scope (as 404, like the record itself), and a missing key; `?version=N` serves an earlier version. |
| W5-AC3 | Hub: a PDF record shows the viewer with page count and the first page rendered; an image record shows the image; a spreadsheet shows a table per sheet with tabs and the row cap note; a Word record shows Download and the extracted text; a record without an original says "original missing" and offers nothing broken. Bilingual; the panel stays a bottom sheet below 1200 px. |
| W5-AC4 | Write to… on a project the caller may write: the set-up strip lists the project's contacts with role, organisation and last contact, and offers the register counterparties; choosing a contact outside the client, holder, partners or government shows the scope warning. |
| W5-AC5 | Draft: the open questions render first with who to ask; every citation is a chip that opens the record panel with the passage highlighted; an uncited sentence with a figure is amber and Approve is disabled until it is kept with a note, dropped or cited; Keep / Keep with a note / Drop state survives a tone re-draft; Save posts the review and the dropped paragraphs are excluded from Render. |
| W5-AC6 | The drafter retrieves research findings (a finding that is the only source for a claim is cited), falls back to the register holder as the organisation, and lists the counterparties in the project block; `tone` changes the draft without losing citations (the uncited check runs again). |
| W5-AC7 | Mark as sent records a dispatch (direction out, organisation, contacts, channel, signed by the caller) linked to the note; the timeline shows it; a second Mark as sent on the same note is refused. Render produces the DOCX with the reference number; when the PDF renderer is unavailable the PDF button says so instead of failing. |
| W5-AC8 | Discovery: `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server` answer as specified; an unauthenticated `POST /mcp` answers 401 with the `resource_metadata` header. |
| W5-AC9 | Registration: a public client with Claude's callback or a loopback URI registers (201, no secret); any other redirect URI is refused with `invalid_redirect_uri`. |
| W5-AC10 | Authorize: without an Access identity the page is not served; with one, a wrong redirect URI, a missing or non-S256 challenge, a wrong resource or an unknown client are refused without redirecting; a CIMD client is fetched, validated and shown by host; Allow redirects with a single-use code; Cancel redirects with `access_denied`. |
| W5-AC11 | Token: the code with the right verifier yields an access token (1 h) and a refresh token; a wrong verifier, a reused code or an expired code answer `invalid_grant`; refresh rotates and a reused refresh token revokes the family; the endpoint accepts form encoding and sets `no-store`. |
| W5-AC12 | `/mcp` with a Vault token runs tools as that person with the same scope and audit as the Access path; a revoked or expired token answers 401 with the handshake header; the Access path keeps working. |
| W5-AC13 | Tools: every tool carries a title and hints; `get_project_context`, `get_item`, `list_projects` and `file_item` work under scope; `file_item` returns `doc:<id>` and the record appears on the project timeline; over 120 calls a minute answers a rate-limit error with `Retry-After`. |
| W5-AC14 | Settings: the Connected apps card lists the connections and revoke works; revocation answers 401 on the next `/mcp` call. |

## 4. Smoke plan

| criterion | tests |
|---|---|
| AC1 | `vault/test/storage.supabase.test.ts` (new, stubbed fetch), `api.items.test.ts` (upload with supabase storage) |
| AC2 | `vault/test/originals.routes.test.ts` (new) |
| AC3 | `test/e2e/hub-record-panel.spec.mjs` (viewer cases with stubbed originals: a small real PDF, a PNG, an xlsx fixture) |
| AC4–AC7 | `vault/test/draft.routes.test.ts` (tone, review, dispatch, render exclusions), `vault/test/draft.test.ts` (research findings, holder fallback, counterparties), `test/e2e/hub-draft.spec.mjs` (new: set-up strip, chips, amber gate, keep/drop, save, render, mark as sent) |
| AC8–AC12 | `vault/test/oauth.test.ts` (new: discovery, register, authorize with a stubbed Access identity and a stubbed CIMD fetch, token, refresh rotation, revocation), `vault/test/mcp.test.ts` (bearer path, 401 handshake) |
| AC13 | `vault/test/mcp.test.ts` (new tools, hints, rate limit) |
| AC14 | `test/e2e/hub-settings.spec.mjs` or the existing settings spec (Connected apps card) |

Visual proof: screenshots of the viewer on a PDF and a spreadsheet, the Write to… panel with chips and an amber sentence, the consent page, and the Claude app's connector dialog once Chris adds it.

## 5. Delivery: four pull requests, each green and mergeable

1. **Durable originals** (AC1): storage backend, boot check, blueprint, setup §1.5.
2. **Open the original** (AC2, AC3): route and viewer.
3. **Write to…** (AC4–AC7): drafter changes, review and dispatch routes, the panel.
4. **The connector** (AC8–AC14): migration 006, OAuth, bearer path, tools, Connected apps, setup §6.

Order matters: 2 needs 1 live (or the viewer shows "original missing"); 4 is independent of 2 and 3 and can ship second if Chris wants the connector first.

## 6. Risks and rollback

| risk | mitigation | rollback |
|---|---|---|
| Files uploaded before this wave are gone from the container | the panel says so and offers re-upload; text and chunks are intact | none needed |
| Supabase free tier caps objects at 50 MB | uploads over the bucket limit answer a clear 413 | raise the plan |
| iPad memory on large scans | lazy page rendering, clamped canvas, whole-file fetch under 20 MB, download above | the Download button |
| A consent page reachable without Access if the Access path is misconfigured | the authorize handler itself refuses a request without an Access identity (AC10); Access is defence in depth | remove the Bypass application |
| Token theft | tokens hashed at rest, 1 h access life, rotating refresh with family revocation, audience check, Connected apps revoke | revoke in Settings |
| The hosted app's own client document URL is not published | DCR is the default in the connector dialog; CIMD is supported for Claude Code and for the day Anthropic publishes it | none needed |
| PDF render still needs Chromium on Render (F5) | DOCX is the default; the PDF button reports the absence | none needed |
| Anthropic's egress range must reach the token endpoint within 10 s | Render cold starts are the risk: the API is a web service that stays warm on the starter plan | none needed |

Each PR is one revert; the migration adds tables only.

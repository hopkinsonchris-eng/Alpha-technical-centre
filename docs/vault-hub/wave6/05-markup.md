# Wave 6 — Markup (Gate 2)

Tooler phase 5, 4 October 2026. Builds Option A (`04-innovation-options.md`) under the Choice Sheet (D60 to D63). Four PRs, each green on its own, in the order below. Schemas in `docs/vault-hub/schemas/` are not changed; `extracted` carries the new facts, as it does for drafts and research.

## 1. BEFORE → AFTER, surface by surface

### 1.1 The first sign-in (Today) — D60, P50

BEFORE: a person signs in through Cloudflare Access and sees Today. Their mailbox is unknown to the Vault; an admin would have to ask them for an app password.

AFTER: on the first visit (no `mailbox_connections` row for the person) a card sits above the globe:

```
┌─ Connect your mailbox ───────────────────────────────────────────────┐
│ The Hub files mail about the firm's opportunities into their project │
│ files, both directions, and keeps what you send and receive about    │
│ them. Mail between colleagues only, and anything you block, stays    │
│ out. You can see what it holds and disconnect at any time in         │
│ Settings.                                                            │
│ [ Connect chris@alpha-technical-centre.com ]   [ Not now ]           │
└──────────────────────────────────────────────────────────────────────┘
```

Connect sends the person to Zoho's consent page (scopes `ZohoMail.accounts.READ`, `ZohoMail.folders.READ`, `ZohoMail.messages.READ`, `ZohoMail.messages.CREATE`, `access_type=offline`, `prompt=consent`) and back to `/oauth/zoho/callback` behind Access; the Vault exchanges the code, reads the account (address, account id, data-centre hosts from the token response), stores one encrypted refresh token, and returns to Today where the card now says "Connected. Mail from today onwards files as it arrives; the last 180 days arrive quietly over the next day." Not now hides the card for 30 days (a per-person setting) and leaves the Settings card as the way back. The card never appears for `service` people.

### 1.2 Settings → Your mailbox — P58, P54

BEFORE: Settings has Connected apps (Claude) and the rates. Exclusions are a raw settings key nobody can edit from the Hub.

AFTER: a card under Connected apps:

```
┌─ Your mailbox ──────────────────────────────────────────────────────┐
│ chris@alpha-technical-centre.com · connected 4 Oct 2026 · last read │
│ 2 min ago · history: 180 days, done 5 Oct 2026                       │
│ Held from this mailbox: 1,412 messages · 963 filed · 31 waiting ·   │
│ 418 internal (hidden) · 2,107 bulk (hidden)                          │
│                                                                      │
│ What the firm sees   (•) Everything  ( ) Subjects only  ( ) Nothing  │
│ Blocked (yours)      family@example.com, *@mybank.com      [ Edit ]  │
│ Firm rules (partners) Protected: alpha-technical-centre.com          │
│                       Blocked: *@recruiter.example         [ Edit ]  │
│ [ Download what is held about a contact… ]                          │
│ [ Disconnect and hide my synced mail ]                              │
└──────────────────────────────────────────────────────────────────────┘
```

Protected (Attio): a message is hidden when every participant is protected; the firm's domain and every person are protected by rule. Blocked: hidden whatever the other participants. Firm rules are partner-only; personal rules are the person's own and apply to their mailbox only. A privacy change applies retroactively (Affinity): lowering to Subjects only strips bodies and attachments from that mailbox's messages (originals purged, text and chunks removed, `extracted.privacy = 'subjects'`); Nothing hides them. Disconnect revokes the token at Zoho, hides every message captured from that mailbox that no other mailbox saw (rule 9), purges their originals, keeps contacts and organisations (Attio).

### 1.3 The queue — P52, P51, P56

BEFORE: `queue.html` lists unfiled messages with suggestions and Assign.

AFTER: the filing section is grouped by status. **Ready** (one candidate at or above 0.6 and a known counterparty on the message): rows with the suggested project and an **Accept all** button plus per-row Assign elsewhere. **Needs a decision**: as now. Bulk messages never reach the queue. Every Assign, Accept and Not a project email writes a `filing_decisions` row (thread id, counterparty domain, attachment-name tokens → project or none, by whom, when); the classifier consults it first: a thread already decided scores 1.0 for that project (or is dismissed), a domain decided three times by anyone adds 0.35 as the `memory` signal with its evidence.

### 1.4 Today → What came in — Option A, P52

BEFORE: Today has a Filing queue card with a count.

AFTER: a **What came in** card at the top of the attention section:

```
┌─ What came in · since you looked on Fri 3 Oct 17:20 ────────────────┐
│ 14 messages filed · 3 ready · 2 need a decision · 2 invoices · 5    │
│ files · 1 new organisation proposed · 38 bulk hidden                 │
│                                                                      │
│ High Tech Electronica                                                │
│   Zuata's CFO sent the data-room index [msg] and asked for the NDA   │
│   countersigned by Friday [msg]; invoice ATC-2026-0152 was paid [inv].│
│ Western Kazakhstan Brownfield                                        │
│   Nothing new.                                                       │
│ [ Open the queue ]   [ Mark all as seen ]                            │
└──────────────────────────────────────────────────────────────────────┘
```

The counts come from `GET /api/me/activity?since=`; the sentence per opportunity comes from `POST /api/me/activity/brief` (the drafter's path: every claim cites a record or is dropped; an opportunity with nothing new says so; no provider → counts only). "Since" is the person's `last_seen_activity_at`, set by Mark all as seen and by opening Today after an hour away. History (backfill) rows never count as "came in".

### 1.5 The record panel and Write to… — P57, D63

BEFORE: a contact shows last contact (wave 5). Mark as sent records a dispatch.

AFTER: the recipient picker and the contact line say "last spoke: Lars, 12 Sept 2026 · strongest connection: Chris" from `contacts.relationship` (recency and frequency over two-way exchanges, recomputed by the poll). Write to…'s last action becomes **Send**: a confirm sheet shows From (the person's connected address), To, Subject, the attachment name (the rendered DOCX or PDF) and the paragraphs kept; Send posts `POST /api/items/:id/send`, which renders, uploads the attachment to Zoho, sends from the person's account, writes the dispatch row and `extracted.sent` with Zoho's message id, and freezes the draft. The sent message is captured by the next poll and files to the project (thread memory: the draft's id in the References). A person without a connected mailbox, or whose grant predates the send scope, sees Mark as sent as now and a line "Connect your mailbox to send from here".

### 1.6 Files and invoices — P59

BEFORE: WorkDrive listed by modified time each run; Books by modified time; both idle without tokens.

AFTER: WorkDrive keeps one changes cursor per mapped team folder (`GET /changes/{folder}?page[token]=latest` after the first full listing), so moves and deletes are seen: a moved file keeps its item and gains the new path; a deleted file's item is hidden. Books unchanged in method, but its runs feed What came in. Owner-side: the two self-client tokens and the folder map, per SETUP.md §3.

### 1.7 Owner-side (not code)

- Zoho API console: one **Server-based application** client "ATC Vault" with redirect `https://www.alpha-technical-centre.com/oauth/zoho/callback`; its id and secret on the API service as `ZOHO_MAIL_CLIENT_ID` / `ZOHO_MAIL_CLIENT_SECRET`; a 32-byte `VAULT_TOKEN_KEY` (generated, never shown) on the API and the mail-poll cron. The Cloudflare Worker route for `/oauth*` already exists (wave 5 §6).
- Cloudflare Access: Hub application session and global session to one month; everyone opens the Hub from a normal tab or the Home Screen.
- WorkDrive and Books self-client tokens and `master/workdrive-map.json`, when wanted.

## 2. Files and components

| PR | area | files |
|---|---|---|
| 1 | Consent, store, rules, transparency | `vault/db/007_mailboxes.sql` (`mailbox_connections`, `mail_rules`, `filing_decisions`, `people.last_seen_activity_at`, `contacts.relationship jsonb`), `vault/src/secrets.ts` (AES-256-GCM with `VAULT_TOKEN_KEY`), `vault/src/ingest/mail/zoho-oauth.ts` (authorize URL, state, code exchange, account lookup, revoke), `vault/src/api/mailbox.routes.ts` (`GET/PATCH/DELETE /api/me/mailbox`, `POST /api/me/mailbox/connect`, `GET /oauth/zoho/callback`, `GET/PUT /api/me/mailbox/rules`, `GET/PUT /api/mail/rules` partners, `GET /api/contacts/:id/export`), `hub/index.html` + `hub/hub.js` (connect card), `hub/settings.html` (Your mailbox card), `vault/SETUP.md` §7, `vault/.env.example`, `render.yml` (env on api and mail-poll) |
| 2 | The Zoho Mail source, the poll from connections, history, capture rules | `vault/src/ingest/mail/zoho-api.ts` (MailSource over REST: Inbox and Sent, date-desc paging to the last seen id, raw MIME through `parseRfc822`, 30-a-minute limiter, 406 Accept header), `vault/src/ingest/mail/poll.ts` (sources from `mailbox_connections` plus env; per-connection status and `last_error`), `vault/src/jobs/mail-history.ts` (backward by day windows to 180 days or 20,000 messages, newest first, tagged `history`, no organisation proposals, queue only with a known counterparty, `history_done_at` and a Hub notice when done), `vault/src/ingest/mail/classify.ts` (Protected/Blocked from `mail_rules`, `memory` signal from `filing_decisions`, status `ready`/`review`), `vault/src/ingest/mail/capture.ts` (`seen_by`, `category` bulk/human, privacy level, history flag), `vault/src/ingest/mail/relationship.ts` (contacts.relationship) |
| 3 | Review and the daily view | `vault/src/api/queue.routes.ts` (status groups, `POST /api/queue/filing/accept-ready`, decisions written), `vault/src/api/activity.routes.ts` (`GET /api/me/activity`, `POST /api/me/activity/brief`, `POST /api/me/activity/seen`), `vault/src/llm/activity-brief.ts` (cited sentence per opportunity), `hub/queue.js` (Ready group), `hub/hub.js` + `hub/index.html` (What came in card), `hub/draft.js` + `hub/record.js` (last spoke, strongest connection), `vault/src/ingest/workdrive.ts` (changes cursor) |
| 4 | Send, evidence, decision log | `vault/src/api/draft.send.routes.ts` (`POST /api/items/:id/send`), `vault/src/ingest/mail/zoho-send.ts` (attachment upload, send, reply), `hub/draft.js` (Send with confirm sheet), `docs/vault-hub/wave6/06-decision-log.md`, evidence PNGs, `HANDOVER.md` |

Every route goes through `route()`; every read of a message through `isVisible`, which now also evaluates the mailbox's privacy level and the Protected/Blocked rules (a hidden-by-rule message is never returned, as a hidden item is not).

## 3. Acceptance criteria (agreed before building)

1. **W6-AC1 Consent.** A partner with no connection sees the Connect card on Today; Connect leads to a Zoho authorize URL carrying the four scopes, `access_type=offline` and a signed state; the callback with a valid code stores exactly one connection for that person with an encrypted refresh token (the plaintext never appears in the database or in any response) and the card says Connected; a second connect by the same person replaces the token rather than adding a connection; a tampered state is refused; a `service` person never sees the card. Not now hides the card for 30 days.
2. **W6-AC2 Capture through the API.** With a recorded Zoho Mail tenant (list, originalmessage, attachment) the source yields the same `RawMessage` as the IMAP and Gmail sources on the shared conformance fixture; two polls file a message to a project contact exactly once with its attachment as a child item; the live cursor advances only after capture; a 429 or lock-out pauses that connection and records `last_error` without losing the cursor; a connection whose refresh fails is marked `error` and shown on the Settings card.
3. **W6-AC3 Rules and privacy.** A message whose participants are all at the firm's domain is hidden by the Protected rule and never queued; a Blocked address on either list hides the message whatever else is on it; public mail domains never create an organisation proposal; lowering the privacy level to Subjects only strips bodies, attachments, text and chunks from that mailbox's messages and purges the originals; Disconnect revokes at Zoho, hides every message only that mailbox saw, purges their originals and keeps contacts and organisations; the audit log records each of these.
4. **W6-AC4 History.** A 2,000-message fixture mailbox back-fills newest first within the 180-day window, stops at the window and at the cap, creates no organisation proposals, queues only messages with a known counterparty, tags every item `history`, resumes after a crash from its day cursor with zero duplicates, and sets `history_done_at`; the Today card never counts history rows.
5. **W6-AC5 Status and memory.** A message with one candidate at or above 0.6 and a known counterparty is `ready`; Accept all files every ready row and writes a decision per row; a thread anyone has filed scores 1.0 for that project on the next message with `memory` evidence; a domain decided three times adds the `memory` signal; Not a project email teaches the memory to dismiss that thread; the classifier precision fixture (200 labelled messages) stays at or above 0.95 at the threshold.
6. **W6-AC6 Bulk.** Messages with `List-Unsubscribe`, `List-Id`, `Precedence: bulk` or a no-reply sender are `bulk`, hidden from the queue, the timeline and What came in, and counted; a person reclassifying one as human is remembered for that sender.
7. **W6-AC7 What came in.** The card shows the counts since the person's last seen time and, with a provider, one sentence per opportunity they hold in which every claim carries a chip that opens the record; a claim the drafter cannot cite is not shown; without a provider the counts show alone; Mark all as seen moves the time; an associate sees only the projects in their scope.
8. **W6-AC8 Who last spoke.** After polling, a contact with two-way exchanges carries `relationship.last_contact_by`, `last_contact_at` and `strongest_connection`, shown in the Write to… picker and the record panel; a Blocked or Protected message never contributes.
9. **W6-AC9 Send.** With a connected mailbox carrying the send scope, Send shows the confirm sheet, posts once, the route renders the draft, uploads the attachment, sends from the person's own address (a request with any other `fromAddress` is refused), writes the dispatch and `extracted.sent` with Zoho's message id, freezes the draft, and a second Send answers 409; without the scope the button is Mark as sent with the connect line; the sent message captured on the next poll files to the draft's project with the draft in its thread.
10. **W6-AC10 Files.** WorkDrive runs once in full then by the changes cursor; a moved file keeps its item with the new path; a deleted file's item is hidden; the cursor is persisted after every page; a 31-day gap falls back to a full listing.
11. **W6-AC11 House rules.** Every new route is audited; every message read passes `isVisible`; no secret or token reaches a browser response; the sitemap pages are byte-identical to `main`; the Hub pages stay `noindex`; every text node has `data-en`/`data-es`; axe finds no WCAG 2 A/AA violation on the new cards; the full Vault suite, typecheck and the Hub Playwright specs are green on every PR.

## 4. Smoke plan (written before the code)

| AC | tests |
|---|---|
| AC1 | `vault/test/mailbox.oauth.test.ts` (authorize URL and scopes, state signing and tampering, code exchange against a recorded Zoho token response, one connection per person, encryption round trip, no plaintext in `SELECT *`); `test/e2e/hub-mailbox.spec.mjs` (card for a partner, hidden for service, Not now, Connected state) |
| AC2 | `vault/test/mail.zoho-api.test.ts` (recorded tenant; the shared conformance fixture from `mail.imap.test.ts` run against the new source; cursor advance; 429 handling); `vault/test/mail.poll.connections.test.ts` (sources from the table, status and `last_error`) |
| AC3 | `vault/test/mail.rules.test.ts` (Protected, Blocked, public domains, privacy lowering, disconnect, audit rows); `test/e2e/hub-mailbox.spec.mjs` (Settings card, rules editor, disconnect) |
| AC4 | `vault/test/mail.history.test.ts` (2,000-message fixture, window, cap, crash and resume, zero duplicates, no proposals, tagged history) |
| AC5 | `vault/test/mail.classify.test.ts` (memory signal, thread 1.0, domain threshold, precision fixture unchanged), `vault/test/queue.ready.test.ts` (ready grouping, Accept all, decisions); `test/e2e/hub-queue.spec.mjs` (Ready group) |
| AC6 | `vault/test/mail.bulk.test.ts` (headers, no-reply, reclassification) |
| AC7 | `vault/test/activity.test.ts` (counts since, scope, history excluded, brief with the fake provider citing records, uncited claim dropped, seen); `test/e2e/hub-today.spec.mjs` (the card, chips open the panel, Mark all as seen) |
| AC8 | `vault/test/mail.relationship.test.ts`; `test/e2e/hub-draft.spec.mjs` (picker line) |
| AC9 | `vault/test/draft.send.test.ts` (recorded Zoho send, fromAddress guard, dispatch, 409, scope missing); `test/e2e/hub-draft.spec.mjs` (confirm sheet, Send, frozen) |
| AC10 | `vault/test/ingest.workdrive.test.ts` (changes cursor, move, delete, gap fallback) |
| AC11 | existing `auth`, `audit`, `public-pages` and axe checks; CI diff of sitemap URLs |

Evidence of done: the full Vault suite, the new smokes, the Hub specs green; screenshots of the Connect card, the Your mailbox card, the queue's Ready group, What came in with chips, and the Send confirm sheet, captured by the specs on realistic data; the decision log.

## 5. Risks and the rollback path

- **Zoho rate limit (30 a minute, lock-out of unknown length).** The source paces itself and fetches bodies lazily; history runs at night by the poll cron. If a lock-out proves long, history falls back to the IMAP source for the first pass (an app password the person creates once), which the poll already supports.
- **`/header` may omit `In-Reply-To`/`References`.** Threading reads the raw MIME (`/originalmessage`), which the existing parser already handles, so the sample's gap does not matter; verified in AC2's recording.
- **Consent fatigue.** One consent per person for the life of the token; the send scope is requested at the same time so there is never a second prompt.
- **A privacy lowering is destructive by design** (bodies and originals go). The audit row records it; the person can reconnect and the history re-runs. Rule 9 is kept: items are hidden, never deleted; only the original bytes are purged, as wave 4 did for uncited papers.
- **The overnight sentence states something wrong.** It can only state what it cites; an uncited claim is dropped (the drafter's invariant, tested in AC7). If it still misleads in practice, the card falls back to counts (Option D) with one flag.
- **Rollback.** Each PR is independent; a revert of PR 2 leaves the table and routes harmless; a revert of PR 1 leaves no card. Migration 007 adds tables and nullable columns only.

## 6. Out of scope (named so nobody expects them)

The inbox agent (Option B), thread notes (Option C), calendar capture, Microsoft and Google mailboxes beyond the existing Gmail source, journaling and eDiscovery, Zoho Books webhooks (polling is enough at the firm's volume), filing by vector similarity.

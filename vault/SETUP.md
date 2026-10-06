# Going live: the steps only the owner can do

Everything in this file is done in web dashboards, not in code. Do them in
the order given: the database first, then the keys, then Access, then the
checks. Budget about two hours. Nothing here touches the public site, DNS
records other than one proxy toggle, or email (MX) records.

Why the database URL goes into Render: the database lives in Supabase, but
the program that connects to it is the Vault API, and that runs on Render
(the `atc-vault-api` service in `render.yml`). A connection string is a
secret, so it is given to the service that uses it as an environment
variable, never written into the repository.

## 1. Database (Supabase, about 15 minutes)

1. Go to https://supabase.com → **New project**. Organisation: yours. Name
   `atc-vault`. Region: the one closest to Render's region for the site
   (see the Render dashboard; Render Frankfurt → Supabase `eu-central-1`,
   Render Oregon → `us-west-1`). Generate a strong database password and
   store it in the "Alpha Web" password manager vault.
2. Plan: **Pro** (USD 25/month). The free tier pauses after a week idle
   and the vault must not pause.
3. When the project is ready: **Project Settings → Database → Connection
   string → URI**. Choose **Session pooler** (port 5432) and copy the URI.
   Replace `[YOUR-PASSWORD]` with the password from step 1. This is
   `DATABASE_URL`. The API always encrypts the connection to a hosted
   database; `?sslmode=require` on the end is accepted but not needed.
5. Optional, recommended once the API is live: on the same Database page,
   under **SSL configuration**, download the Supabase root certificate.
   In Render, add it to `atc-vault-api` as a **Secret File** named
   `supabase-ca.crt` and set `DATABASE_SSL_CA=/etc/secrets/supabase-ca.crt`.
   The API then verifies the database's certificate instead of only
   encrypting the connection (its log says which it is doing).
4. Nothing else to configure: the API runs its own migrations on boot and
   enables the `vector` extension itself.

### 1.5 Originals in Supabase Storage (wave 5, about 10 minutes)

Every uploaded file, research finding and mined paper keeps its original bytes
in a private bucket in this same Supabase project, so the API and the cron jobs
share one store that survives a deploy. (Before wave 5 the originals sat on
Render's container disk and were lost at each deploy; the extracted text and the
search index were never affected. Files uploaded before this step must be
uploaded again.)

1. Supabase → the `atc-vault` project → **Storage → New bucket**. Name `vault`,
   leave **Public bucket** off, no file size limit beyond the plan's. Create.
2. **Project Settings → API**: copy the **Project URL** and, under *Project API
   keys*, the **service_role** key (click Reveal). The service key bypasses the
   bucket's policies, which is why it lives only in Render and never in a file
   served to a browser.
3. Render: on **each** of `atc-vault-api`, `atc-vault-research`,
   `atc-vault-miners`, `atc-vault-ingest-sync` and `atc-vault-mail-poll`,
   **Environment → Add**: `SUPABASE_URL` = the project URL,
   `SUPABASE_SERVICE_KEY` = the service_role key. The Blueprint sets
   `VAULT_STORAGE=supabase` and `VAULT_STORAGE_BUCKET=vault` itself on the
   next sync; add those two by hand as well if the sync does not ask.
4. Set the variables **before** merging the wave 5 storage pull request: the
   API refuses to start on a production server without a durable store, and a
   deploy that fails to start leaves the previous one running.
5. Check: after the deploy, the API log shows `storage: supabase bucket "vault"
   at https://…supabase.co` and, on the next line, `storage check: ok`. If the
   bucket is missing or the key is wrong the line says `storage check: FAILED`
   with what to fix, the Hub's status strip shows a red "file store down" alert
   on every page, and a country pack built meanwhile marks its sections "not
   filed" rather than drafting; press Refresh on the card once the store is
   fixed. Upload a file to a project; it appears under
   Storage → vault → originals in Supabase.

## 2. Deploy the API (Render, about 15 minutes)

The services are declared in `render.yml`, so Render creates them from the
file once the pull request is merged.

1. Merge pull request #15 into `main` (see step 6).
2. Render dashboard → **Blueprints → New Blueprint Instance** → pick this
   repository → Render lists `atc-vault-api` and the six cron jobs from
   `render.yml` → **Apply**. (The existing static site is unchanged.)
3. Render asks for every variable marked `sync: false`. Enter them from the
   list in step 3 below; you can save with placeholders and fill in later,
   but `DATABASE_URL` must be real or the service will not start.
4. When `atc-vault-api` is live, open its URL plus `/api/health`. You should
   see `{"ok":true,...,"migrations":1,"backend":"pg"}`. Note the service
   URL (something like `https://atc-vault-api.onrender.com`): Cloudflare
   needs it in step 4.
5. Render web services on the Starter plan have no Chromium, so headless
   re-runs and PDF rendering answer 503 until follow-up F5 (Docker runtime)
   is done. Everything else works.

## 3. Keys and integrations (about 45 minutes; do the first block now, the rest when convenient)

Every name below is listed with a comment in `vault/.env.example`. Enter
each one in Render → `atc-vault-api` → **Environment** (and the same
`DATABASE_URL` on each cron job; Render lets you copy variables).

**Needed on day one**

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Step 1.3 |
| `SITE_ORIGIN` | `https://www.alpha-technical-centre.com` |
| `ALLOWED_EMAIL_DOMAIN` | `alpha-technical-centre.com` (already in the blueprint) |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | Step 4 |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com → API keys → Create key. Set a monthly spend limit there (USD 100 is plenty to start). |
| `VOYAGE_API_KEY` | https://dash.voyageai.com → API keys. Used for embeddings and reranking. |
| `LLM_MODEL` | Leave as `claude-sonnet-5-5` unless you decide otherwise. |

**Mail capture (M10)**

| Variable | Where it comes from |
|---|---|
| `ZOHO_MAIL_IMAP_HOST` | `imappro.zoho.com` (Zoho Mail paid plans) or `imap.zoho.com` |
| `ZOHO_MAIL_IMAP_USER` | `info@alpha-technical-centre.com` |
| `ZOHO_MAIL_IMAP_PASSWORD` | Zoho Mail → Settings → Security → **App passwords** → generate one named "ATC Vault". First enable IMAP: Settings → Mail accounts → IMAP access. |
| `ZOHO_MAIL_IMAP_USER_2` / `_PASSWORD_2` … | The same for each partner mailbox you want captured (up to `_9`). |
| `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN` | Only if a Gmail mailbox should be captured. Google Cloud console → new project → OAuth consent screen (internal) → Credentials → OAuth client (Web) → then obtain a refresh token with the `gmail.readonly` scope via https://developers.google.com/oauthplayground using that client. |

**Documents and billing (M09, D11)**

| Variable | Where it comes from |
|---|---|
| `ZOHO_WORKDRIVE_*` | Zoho API console (https://api-console.zoho.com) → **Self Client** → generate a code with scopes `WorkDrive.files.READ, WorkDrive.teamfolders.READ` → exchange for a refresh token. Then map team folders to projects in `vault/master/workdrive-map.json`. |
| `ZOHO_BOOKS_CLIENT_ID`, `ZOHO_BOOKS_CLIENT_SECRET`, `ZOHO_BOOKS_REFRESH_TOKEN` | Same console, scopes `ZohoBooks.invoices.READ, ZohoBooks.purchaseorders.READ, ZohoBooks.expenses.READ`. Skip if invoicing is not in Zoho Books. |

**External APEX apps (D6)**

| Variable | Where it comes from |
|---|---|
| `APP_TOKENS` | Generate two secrets with `openssl rand -hex 24` and enter `apex-asset-intelligence:<secret1>,apex-3d-model:<secret2>`. Give each app its own secret (step 5). |
| `APEX_AI_BASE_URL`, `APEX_AI_TOKEN`, `APEX_3D_BASE_URL`, `APEX_3D_TOKEN` | `https://apex-app2.onrender.com` and `https://apex-3d-model.uk`; the tokens are two more `openssl rand -hex 24` secrets that the apps must check on their `/rerun` endpoint. |

**Fields and live risk (wave 3)**

| Variable | Where it comes from |
|---|---|
| `GEONAMES_USERNAME` | Free account at https://www.geonames.org/login → enable the free web services on the account page. Add field then searches GeoNames for oil and gas fields; without it the Hub says "GeoNames not available". |
| `WORLD_MONITOR_API_KEY` | World Monitor → API keys (a `wm_` key). Server-side only: country risk and conflict events in the brief and the globe. Without it the risk line is simply absent. |

**Research runs (wave 4)**

Creating a project with a country, attaching a field, or pressing Research on the project file queues a
research run: World Monitor's GDELT, company and SEC readers plus the Vault's own literature miners,
each finding filed as a public note under the project with its source, URL and a verbatim excerpt, and
operator, licence and production figures opened as proposals in the review queue. A run stops at
`RESEARCH_BUDGET_MINUTES` (default 15) or `RESEARCH_BUDGET_GBP` of model spend (default 3), whichever
comes first. `RESEARCH_ENABLED=false` switches it off. The `atc-vault-research` cron (every 15 minutes,
added by a Blueprint sync; a sync after the first never asks for keys, so link the cron to the `vault-storage`
environment group, which carries its `DATABASE_URL`, `WORLD_MONITOR_API_KEY` and `ANTHROPIC_API_KEY`) finishes any run a restart interrupted. Nothing is deleted by a run; a re-run
updates its own notes in place.

**The Global Energy Monitor field tracker (once per release, about 10 minutes)**

The Global Oil and Gas Extraction Tracker sits behind a download form, so it is imported by hand:
download the .xlsx from https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/download-data/,
then in `vault/` run `npx tsx scripts/import-gem.ts <the .xlsx>` (the release month is read from the
workbook's About sheet; add `--release "March 2026"` to override). That writes `vault/master/gem-fields.json`
(commit it); the next deploy seeds the units into `assets` at boot and Add field finds them first. The
licence is CC BY 4.0 and the attribution travels on every dossier filed from it. The March 2026 release
is committed; repeat for each new release.

**Optional**

`EIA_API_KEY` (https://www.eia.gov/opendata/register.php) and
`S2_API_KEY` (https://www.semanticscholar.org/product/api) raise the
miners' rate limits; both feeds work without them at lower rates.

## 4. Cloudflare Access for the staff surfaces (about 30 minutes)

Access sits in front of `/hub/*`, `/api/*` and `/mcp` and asks for a
one-time PIN sent to a company mailbox. The public site stays public.

1. **Make sure the site is proxied.** Cloudflare dashboard → the
   `alpha-technical-centre.com` zone → **DNS**. The `www` record must show
   the orange cloud (Proxied). If it is grey, click it to turn it orange.
   Do not touch any MX or TXT record.
2. **Zero Trust** (left menu, or https://one.dash.cloudflare.com). If it
   asks you to pick a team name, choose something like `alphatc`; the
   team domain becomes `alphatc.cloudflareaccess.com`. Free plan is fine
   (up to 50 users).
3. **Settings → Authentication → Login methods → Add new → One-time PIN.**
4. **Access → Applications → Add an application → Self-hosted.**
   Name `ATC Hub`. Session duration 24 hours.
   Application domain: `www.alpha-technical-centre.com`, path `hub`.
   Click **Add public hostname / domain** twice more and add the same
   domain with path `api` and with path `mcp`.
5. **Policy:** name `Staff`, action **Allow**, Include → *Emails ending in*
   → `@alpha-technical-centre.com`. Save.
6. Open the application's **Overview**. Copy the **Application Audience
   (AUD) Tag** → Render `CF_ACCESS_AUD`. Your team domain
   (`<team>.cloudflareaccess.com`) → Render `CF_ACCESS_TEAM_DOMAIN`.
7. **Route the API through Cloudflare.** Cloudflare dashboard → **Workers &
   Pages → Create → Create Worker**. Name `atc-api-proxy`. Replace the
   default code with the contents of `cloudflare/api-proxy.js` from the
   repository → Deploy. Then **Settings → Variables and Secrets → Add** →
   name `VAULT_API_ORIGIN`, value the Render service URL from step 2.4 →
   Deploy. Then **Settings → Domains & Routes → Add → Route**: zone
   `alpha-technical-centre.com`, route `www.alpha-technical-centre.com/api/*`;
   add a second route `www.alpha-technical-centre.com/mcp*`.
8. **Checks:**
   - Open https://www.alpha-technical-centre.com/about.html in a private
     window: loads without a login.
   - Open https://www.alpha-technical-centre.com/hub/ in a private window:
     Access asks for your company email and emails a PIN; after the PIN,
     the Today page loads and the sidebar shows your name.
   - Open https://www.alpha-technical-centre.com/api/me after logging in:
     JSON with your id and role `partner` (you are in `vault/master/people.json`;
     colleagues are created as associates the first time they log in and can
     be promoted to partner by editing that file).

## 6. The Vault in the Claude app (wave 5, about 20 minutes)

The Vault is an OAuth 2.1 server for its own connector, so each person signs in
as themselves through the usual Access login and every call is scoped and
audited under their name. Three Cloudflare changes, one Render variable, then
the connector in the Claude app. Custom connectors need a Pro, Max, Team or
Enterprise plan; on Team and Enterprise an Owner adds it and each person then
connects.

1. **Cloudflare Zero Trust → Access → Applications.** Edit **ATC Hub**:
   remove the `mcp` path, keep `hub` and `api`, and add the path
   `oauth/authorize` (hostname `www`). The consent page then signs people in
   under the same application tag the Vault already checks (`CF_ACCESS_AUD`).
   If you would rather keep the consent page as its own application, add its
   AUD tag to `CF_ACCESS_AUD` on Render, comma separated; otherwise the
   consent page answers "Sign in first". Then **Add an application →
   Self-hosted** once:
   - **ATC Connector**: domain `www.alpha-technical-centre.com` with the paths `mcp`, `oauth/token`,
     `oauth/register`, `.well-known/oauth-authorization-server` and
     `.well-known/oauth-protected-resource`; one policy, action **Bypass**,
     Include **Everyone**. The Vault checks its own tokens there, and nothing on
     those paths answers without one.
2. **Workers & Pages → `atc-api-proxy` → Settings → Domains & Routes → Add →
   Route**, twice: `www.alpha-technical-centre.com/oauth*` and
   `www.alpha-technical-centre.com/.well-known/oauth*`.
3. **Render → atc-vault-api → Environment**: `VAULT_PUBLIC_URL` =
   `https://www.alpha-technical-centre.com` (the Blueprint sets it on sync;
   add it by hand if the sync does not).
4. **Check**, in a private window: `https://www.alpha-technical-centre.com/.well-known/oauth-authorization-server`
   answers JSON with `issuer` and `token_endpoint`;
   `https://www.alpha-technical-centre.com/mcp` opened in the browser answers
   a JSON error with status 405 (it takes POST only) and no Access login.
5. **Claude app** (iPad or web): Settings → Connectors → **Add custom
   connector**. Name `ATC Vault`, URL
   `https://www.alpha-technical-centre.com/mcp`, OAuth client **Register
   automatically**, Authentication **Sign in now**. The Access login appears
   (one-time PIN to your company mailbox), then the Vault's consent page
   (Allow), then the connector shows as connected. Claude Code picks the same
   connector up under the same account.
6. **Use it**: in any conversation, "List my projects", "Give me the context
   of High Tech Electronica", "Search the Vault for the Guafita restart",
   "Draft an email to the holder about…", "File this summary into the
   project". Reads run without a prompt; writes ask first. **Settings →
   Connected apps** in the Hub lists the connections and revokes them.

## 7. Each person's mailbox, by consent (wave 6, about 15 minutes once)

Nobody hands over an app password. Each person connects their own Zoho mailbox from the Hub the first time they open it (a card on Today, or Settings → Your mailbox); the Vault keeps one refresh token per person, sealed, and reads and sends through the Zoho Mail API as them. You set up the one Zoho client the Vault uses.

1. **A token key.** In Render (dashboard.render.com) open the `vault-storage` environment group (Environment Groups in the left menu), add `VAULT_TOKEN_KEY` and press **Generate** for the value (any secret of 32 characters or more will do; `openssl rand -base64 32` on a Mac gives one too). Save. Both `atc-vault-api` and `atc-vault-mail-poll` must be in the group's linked services; if the API is not, add the same variable on the API service directly. Never paste the value anywhere else.
2. **The Zoho client.** https://api-console.zoho.com → **Add Client → Server-based Applications**. Client name `ATC Vault`, homepage `https://www.alpha-technical-centre.com`, authorized redirect URI `https://www.alpha-technical-centre.com/oauth/zoho/callback`. Create. Copy the **Client ID** and **Client Secret** into `ZOHO_MAIL_CLIENT_ID` and `ZOHO_MAIL_CLIENT_SECRET` on the API service and the mail-poll cron. If the firm's Zoho account lives in another data centre (the console address ends in `.eu`, `.in`, …), add `ZOHO_MAIL_ACCOUNTS_URL` with that accounts server, e.g. `https://accounts.zoho.eu`.
3. **The callback behind Access.** The Worker route `www.alpha-technical-centre.com/oauth*` (§6 step 2) already carries the callback to the Vault, but the Vault needs the person's sign-in with it: Zero Trust → Access → Applications → **ATC Hub** → **Add public hostname** `www` / `oauth/zoho/callback`. Without it the return from Zoho answers "Sign in first".
4. **Sessions.** Zero Trust → Access → Applications → the Hub application → **Session duration: 1 month**, and Settings → Authentication → **Global session timeout: 1 month**, so a device signs in once a month. Ask everyone to open the Hub from a normal tab or the Home Screen, not a Private tab, which forgets the login when it closes.
5. **Try it.** Open the Hub, press **Connect** on the card, approve on Zoho's page, and you are back on Today with "Mailbox connected". Settings → Your mailbox shows what is held, your Blocked list, the firm's Protected and Blocked lists (partners), a per-contact export and Disconnect.

Scopes asked for: `ZohoMail.accounts.READ`, `ZohoMail.folders.READ`, `ZohoMail.messages.READ`, `ZohoMail.messages.CREATE` (the last so a letter can leave from the person's own address). Zoho refresh tokens never expire unless revoked; the Vault stores one per person and replaces it on a reconnect.

**What happens after a connection.** The five-minute poll reads the Inbox and Sent folders of every connected mailbox through the Zoho Mail API (the IMAP app-password route is still there for `info@`, and a connection supersedes it for the same address). Each poll also brings in one slice of history, newest first, back to 180 days (Settings → Your mailbox → history window), at most 20,000 messages, so the past arrives quietly over the first day or two. History never proposes organisations and only waits in the queue when a known counterparty is on the message. Zoho allows 30 requests a minute per mailbox: a rate limit shows as an error on the Your mailbox card and clears at the next poll. On the first live connection, check the mail-poll log for `originalmessage`: the Vault accepts the raw message as JSON or as bytes, and a tenant that answers in an unexpected shape shows up there as a parse error on every message.

## 5. The APEX apps' developer (an email from you)

Send the developer the file `vault/src/adapters/README.md` (on GitHub once
merged: `https://github.com/hopkinsonchris-eng/Alpha-technical-centre/blob/main/vault/src/adapters/README.md`)
together with the three secrets from step 3 (`APEX_*_TOKEN` values and each
app's own `APP_TOKENS` secret), through the password manager, not email.
The README contains the ten-line push snippet, the `/rerun` endpoint, and
the snapshot fallback for Asset Intelligence if it cannot change yet.

Also ask for one static file per app: `GET /version.json` returning
`{"version": "4.2.0", "released_at": "2026-09-12"}` (no auth, no CORS
needed). The Vault reads it hourly and the Hub then shows the app's real
version instead of "Version unverified"; see
`docs/vault-hub/wave2/hub-sidecar.md`.

## 7.5 The country opening pack and the round watch (wave 7, about 5 minutes once)

The pack assembles itself when a project is created with a country, and the watch reads the regulators' round
pages weekly. Both draft only from stored public originals; nothing runs without the drafting key.

1. **The key on the crons.** The blueprint adds three cron jobs, `atc-vault-country-pack`, `atc-vault-country-pack-refresh`
   and `atc-vault-round-watch`. With Auto Sync on, the Blueprint creates them the moment the pull request merges, so
   look for them in the Dashboard before pressing Manual Sync (which has nothing left to apply and shows nothing).
   Render only asks for `sync: false` keys when a Blueprint is first created; a later sync creates the crons without
   them. So link each cron to the `vault-storage` environment group (its Environment tab → Link environment group),
   which carries `ANTHROPIC_API_KEY` and `DATABASE_URL`. If the Environment tab lists either key with an empty value,
   delete the empty entry so the group's value is used. The API service already has both.
2. **Optional keys.** `EIA_API_KEY` (free, eia.gov/opendata) fills the production section; without it that section says
   "not configured". `PACK_BUDGET_GBP` caps one build (default 2); `S2_API_KEY` and `OPENALEX_KEY` from §5 feed the
   literature section.
3. **Try it.** Open a project with a country (or create one): the Country pack card shows ten rows; press **Assemble the
   pack**; within the hour the rows fill with a headline sentence each and a freshness dot. Tap a row for the sentences,
   each with a chip that opens the original at the cited passage. The globe's country panel shows the same summary.
4. **Round dates.** Each Monday the watch files any regulator page that changed and proposes dated stages with the
   sentence that states them; they wait under Queues as "Round date" until someone presses **Confirm the date**.
   Confirmed deadlines appear on Today under "Deadlines in the next 90 days" and ring the country on the globe.
5. **Sources.** `vault/master/country-sources.json` lists every source with its licence and attribution line; add a
   country or a regulator page there by pull request. Mexico, Namibia, Guyana and Venezuela are seeded by hand and say so on the card.

## 8. The pull request

Pull request #15 is open. Review it on GitHub, then **Merge**. Render
deploys the static site automatically; the API and cron jobs appear when
you apply the blueprint (step 2). After merging, in Render → `atc-vault-api`
→ **Manual Deploy → Deploy latest commit** if it has not picked it up.

## 9. First week

- Add the other partners to `vault/master/people.json` (id, email, name,
  role `partner`, signature block) by pull request; associates need
  nothing.
- Backfill mail once: Render → `atc-vault-mail-poll` → **Shell** →
  `npx tsx src/jobs/mail-backfill.ts --since=2025-01-01`.
- Run the nightly jobs once by hand from the same Shell to see them work:
  `npx tsx src/jobs/nightly-staleness.ts`, `npx tsx src/jobs/miners.ts`.
- Connect Claude Code: `cloudflared access login https://www.alpha-technical-centre.com/mcp`
  then the `claude mcp add` line in `vault/README.md`.
- Watch **Cost & health** in the Hub for the first token bills.

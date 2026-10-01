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
added by a Blueprint sync, which asks for its `DATABASE_URL`, `WORLD_MONITOR_API_KEY` and `ANTHROPIC_API_KEY`;
enter the same values the web service has) finishes any run a restart interrupted. Nothing is deleted by a run; a re-run
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

## 6. The pull request

Pull request #15 is open. Review it on GitHub, then **Merge**. Render
deploys the static site automatically; the API and cron jobs appear when
you apply the blueprint (step 2). After merging, in Render → `atc-vault-api`
→ **Manual Deploy → Deploy latest commit** if it has not picked it up.

## 7. First week

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

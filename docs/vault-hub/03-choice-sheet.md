# Phase 2 — Gate 1: the Choice Sheet

**Status: DECIDED by Chris Hopkinson on 29 Sep 2026.** Answers recorded
verbatim below; the option table that follows is kept for the reasoning and
for the "changes downstream" notes should any decision be reversed later.

## Decisions record

| # | Decision | Answer (verbatim) |
|---|---|---|
| D1 | Where the Vault lives | "Monorepo, this repo (Recommended)" |
| D2 | Backend stack | "Node + Supabase (Recommended)" |
| D3 | Staff authentication | "Cloudflare Access, email PIN (Recommended)" |
| D4 | Confidentiality model | "Legal tag on every record (Recommended)" |
| D5 | Originals of files and email | "Vault stores immutable copies (Recommended)" |
| D6 | External APEX apps | "They write runs to the vault (Recommended)" |
| D7 | LLM and embedding providers | "Anthropic + Voyage, server-side (Recommended)" |
| D8 | Build strategy | "Three model tiers, contract first (Recommended)" |
| D9 | Wave 1 scope | "Vault core + latest versions (Recommended)" |
| D10 | Learning loop | "Structured lessons with review queue (Recommended)" |
| D11 | Billing source of truth | "Zoho Books (Recommended if in use)" |

Standing requirements added by Chris during Gate 1 (they shape the Markup, not
the options): "I want all of the correspondence, scientific/geological papers,
emails, legal documentation, billing etc etc all in the vault." and "If I need
to write a legal letter to a potential job partner all the information needed
to be able to write that letter should be in the vault or accessible from the
API. Dates that previous documents were sent, ATC letterhead etc." These are
recorded as requirement R1 (complete inventory) and R2 (letter-ready vault)
in `06-architecture.md` §0.

## Option table (for reference)

| # | Decision | Options | Recommended default and why | Changes downstream if reversed |
|---|---|---|---|---|
| D1 | **Where the Vault lives** | (a) Monorepo: this repo gains `vault/` (API service) and `hub/` (dashboard), deployed as extra Render services from `render.yml`. (b) Separate `atc-vault` repo and services. (c) Buy a platform (iManage, Glean, Foundry). | **(a) Monorepo.** Everything Chris already knows (one repo, Render auto-deploy, `style.css`) keeps working; the tools that must write runs live in the same tree; module builders see the whole contract. (c) is out of reach at four partners and would not index our tool runs anyway. | (b): module specs gain a cross-repo client package; CI split in two. |
| D2 | **Backend stack** | (a) Node 22 + TypeScript (Hono) API on Render, Postgres with pgvector on Supabase Pro, originals in Supabase Storage. (b) Same API, Render Postgres + Cloudflare R2. (c) Python FastAPI. | **(a).** One language across tools, client library and API means cheaper models switch context less; Supabase Pro (USD 25/month) bundles Postgres, pgvector, storage and backups with no idle pausing. | (b): storage adapter swaps, ~1 module. (c): M02, M08–M15 rewritten in Python; the JS client and schemas unchanged. |
| D3 | **Staff authentication** | (a) Cloudflare Access in front of `/hub/*` and the API, one-time PIN to `@alpha-technical-centre.com` mailboxes (Zoho), free for ≤50 users. (b) Supabase Auth with Google/Zoho OIDC. (c) Keep page-level passwords. | **(a).** DNS is already on Cloudflare; no identity provider to run; the API trusts the signed Access JWT. (c) is not security and is retired. | (b): M01 changes; every API handler reads a Supabase session instead of an Access JWT. |
| D4 | **Confidentiality model** | (a) OSDU-style legal tag on every record (client, contract, expiry, data type, classification `public / firm / client-nda`), derivatives inherit the union, retrieval scope mandatory. (b) Folder-level permissions only. | **(a).** It is the only model that makes "learning crosses projects, client data does not" a property of the system rather than a habit. | (b): M12 simplifies but cross-client leakage becomes a discipline problem; the drafting assistant cannot be trusted with mixed scopes. |
| D5 | **Where originals of files and email live** | (a) Vault stores an immutable copy of every original (upload, WorkDrive sync, email attachment) and records its origin. (b) Index in place: Zoho WorkDrive and mailboxes stay the store, Vault holds metadata and text only. | **(a).** Immutability, expiry enforcement and hashing need our own copy; WorkDrive remains the working space and is synced in. Storage at our volume is a few GB. | (b): M09 becomes a connector-only module; expiry cannot be enforced on originals. |
| D6 | **External APEX apps** (Asset Intelligence at apex-app2, 3D model at apex-3d-model.uk) | (a) They write run records to the Vault through the same HTTP contract as the in-repo tools (a thin adapter each) and appear in the catalog with their own versions. (b) Catalog links only, no run capture. | **(a).** Otherwise the two most-used tools are the two holes in the vault. Needs read access to those codebases (outside this repo). | (b): M05 drops two adapters; their runs stay invisible. |
| D7 | **LLM and embedding providers** | (a) Anthropic (Claude) for drafting, extraction, consolidation, called server-side only; Voyage for embeddings and rerank. (b) Add OpenAI/Gemini as fallbacks behind one provider interface. | **(a) with (b)'s interface.** Server-side only; the simulator's browser-held Anthropic key is retired. The provider interface costs nothing now and keeps options open. | None structural; M12/M13 gain a second adapter. |
| D8 | **Build strategy** | (a) Three model tiers with contract-first specs and smoke tests (see `07-build-plan.md`); waves 0–4. (b) One frontier model builds everything. | **(a).** The evidence in `02` says the split is 5–10× cheaper when specs are unambiguous and tests gate the work; Tier A still writes every contract and reviews every merge. | (b): `07` collapses to a single schedule; cost roughly 5–10× higher. |
| D9 | **Scope of wave 1 (what ships first)** | (a) Vault core + tool registry + client library + Opportunity Register and Reservoir Simulator writing runs + Hub "Today" page. (b) Start with email and document ingest. | **(a).** It removes the most damaging gap today (runs trapped in browsers, versions pinned by hand) in one wave and gives every later wave something to link to. | (b): reorder waves; the run record still comes first because documents cite runs. |
| D10 | **Learning loop** | (a) Structured lessons with evidence, weekly consolidation into a partner review queue, core index injected into every drafting context and Claude Code session. (b) Free-text "lessons learned" pages. | **(a).** Free-text pages are where lessons go to die (the research is unanimous). | (b): M15 becomes a markdown folder; no injection, no decay. |
| D11 | **Legal and billing records: source of truth for sync** | (a) Zoho Books (or whichever invoicing system is in use) synced by API for invoices, POs, expenses; NDAs and contracts from a WorkDrive `Legal/` folder; anything else by upload. (b) Everything by upload or WorkDrive folder only, no accounting API. | **(a) if Zoho Books is in use, else (b).** Invoices and contracts carry the dates the vault needs (NDA expiry becomes the legal-tag expiry; unpaid invoices show on the project page). Tell me which system holds invoicing today. | (b): M09 loses the Books adapter; billing facts are extracted from PDFs instead. |

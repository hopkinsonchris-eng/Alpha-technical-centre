# Phase 0 — Baseline (what exists today, verified in the repo at d8a4835)

| Surface | What it is | Where its data lives | Versioning | Access control |
|---|---|---|---|---|
| admin.html "Staff Portal" | Tool launcher + engineer day-rate config | localStorage `atc_admin_config` | none | client-side username/password, sessionStorage flag (not security) |
| opportunity-register.html | Global Opportunity Register, ranks by Alpha uplift, map | tries GET/POST /api/opportunities, falls back to localStorage (`state.mode='local'`) - on Render static there is no API, so every browser has its own private register | calculator pinned by `?v=2` on js/potential.js + js/analogues.js, bumped by hand | via portal |
| app.html "APEX Asset Intelligence v4" (933 KB) | Asset intelligence app, also hosted at apex-app2.onrender.com | /api/state PUT/GET, /api/me, /api/track (backend lives outside this repo) | "v4" in title; v=2.4 / v=3.5 tokens | server login (external) |
| reservoir-simulator.html "APEX Reservoir 3D" | Multiwell black-oil simulator | localStorage; calls api.anthropic.com directly with a key kept in localStorage | v2.2 in page | none beyond portal |
| financial-modelling.html | Quick-look economics | none persistent | "Version 1.0" | public |
| nodal-analysis-tool.html | IPR/VLP + ESP | none persistent | none | public |
| plan-your-job.html | Scope-of-Work generator | reads localStorage `atc_admin_config` | v1.0 | public |
| ela-studio/ | ELA scenario studio | ELAStore: /api/scenarios if backend, else localStorage `ela_scenarios_v1` | none | optional server login |
| ela-model-suite.html | New Law (Jan 2026) model suite | localStorage overrides | none | via portal |
| situation-room/ | Market/geo dashboard | live feeds, no persistence | none | AUTH_ENABLED=false |
| insights-data/ | radar-ledger.json, editions/, dossiers/, reading-list/, papers/ (gitignored) | git | git | git |
| .claude/skills/ | insight-radar, humaniser | git | git | n/a |
| test/ | node --test potential.test.mjs | git | | |
| APEX 3D reservoir model (apex-3d-model.uk) | External app, linked from tools.html; access keys issued by request to info@ mailbox | its own host, outside this repo | unknown from here | per-user access keys |

Consequences:
1. No shared record of runs. A partner's register or simulator run exists only in their browser. Nothing is "the latest run" for the firm.
2. No shared vault: letters, emails, spreadsheets, papers live in Zoho Mail / WorkDrive / personal machines; only insight-radar papers touch the repo and are gitignored.
3. "Latest tool version" is a manual convention (bump ?v). There is no manifest a dashboard could read.
4. Secrets in the browser: the simulator's Anthropic key in localStorage; the portal password in page source.
5. Precedents worth building on: ELAStore's local/server dual-mode pattern; the register's `/api/opportunities` contract; the radar ledger (a citation-graded JSON ledger is already a mini vault); provenance badges (analogue vs measured) in potential.js; node --test for calculator regression.

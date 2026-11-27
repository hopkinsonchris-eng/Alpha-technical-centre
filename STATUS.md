# Status

Updated 27 Nov 2026, 16:45 UTC. Live readings come from `get_project_context`: section "Index health" for indexing and, since #132, section "Search health" for search.

## Search (27 Nov 2026)

**Search works again, by word match. The meaning-based half works for small projects only.**

### Done (checked live)
- #132 Search health in `get_project_context`: chunk counts, sizes, database settings, running statements, query plans and the time each search stage took.
- #133 Search answers or fails clearly within about 20 seconds and leaves nothing running in the database. Checked at 16:26 UTC: Parker Creek ("Frost 2 sidetrack"), Fezzan ("Sharara field fire") and firm ("EPSA IV cost recovery") each returned cited hits in 8.3 to 9.0 s, marked `partial: true` (word matches only); three searches sent together all answered in 8.2 to 8.9 s. Search health at 16:37 showed no statement left running.
- #134 Scope is applied before distance. Checked at 16:37 UTC: Fezzan "who operates the Sharara oil field" returned the El Sharara field dossier in 7.2 s, not partial (word match 541 ms, embedding call 145 ms, meaning-based match 6,216 ms).

### What the live system says (16:13 and 16:37 UTC)
- 943,264 chunks; 935,788 are Parker Creek's, 7,302 the firm's, 114 Fezzan's.
- 197 Parker Creek spreadsheets (daily workover and completion reports) hold 922,432 of them; the largest two hold about 25,040 each.
- 1,733 Parker Creek files are stored more than once: 3,670 extra copies carrying 218,114 chunks.
- The chunks table is 6.27 GB (rows 729 MB, embeddings 5.30 GB, indexes 269 MB); the database is 6.37 GB.
- Postgres 17.6, pgvector 0.8.2, shared_buffers 256 MB, maintenance_work_mem 64 MB, statements cancelled by the database at 120 s.
- No vector index. Every meaning-based search computed the distance to every chunk it could reach.

### Open
- Parker Creek and firm scope: the meaning-based half still runs out of its 7 s and is stopped, so results are word matches only. Fezzan's meaning-based match takes 6.2 s of its 7 s, so it will sometimes come back partial.
- Results repeat a file once per stored copy and once per slice.
- Not built: an approximate vector index. At today's size it would be about 7 GB (a local build of 60,000 chunks took 5 min 20 s and 469 MB with 64 MB of build memory).
- WorkDrive sync still re-lists the whole folder each run and is left at 600 s. Not started.

### Waiting on the owner
- A yes to stop the meaning-based search reading every slice of the 197 large spreadsheets: keep every slice for word search, keep the embedding of the first 40 slices of each file, clear the rest. No file, record or text is removed. What stops being findable: a meaning-based match inside the later slices of those spreadsheets; a word match still finds them. Tested locally only.
- Whether the 3,670 duplicate copies should be hidden from search (not deleted).

### Model spend
- £0.00 for this work. Ledger: £61.72 in total, £0.00 today (16:37 UTC).

## Earlier: Parker Creek indexing (14 Nov 2026)

The sections below are as written on 14 Nov. Since then the scan queue has cleared: 4,091 of 4,588 readable files indexed, queue empty, 497 scans read to no text (27 Nov 16:13 UTC).

## Parker Creek indexing: cap £50 of model spend, from 14 Nov 2026 12:28 UTC

The cap is counted from the firm-wide ledger reading at the start: £60.91 in total since 1 Oct 2026 (of which indexing £56.72), spent before this work.

| Reading (UTC) | Indexed / readable | Waiting | Unsupported | Ledger total | Spend against cap |
|---|---|---|---|---|---|
| 14 Nov 12:28 | 2,198 / 2,203 (99.8%) | 5 | 4,128 | £60.91 | £0.00 |
| 14 Nov 12:50 | 2,199 / 2,203 (99.8%) | 4 | 4,128 | £60.91 | £0.00 |
| 14 Nov 13:25 | 2,201 / 2,323 (94.7%) | 122 (LAS requeued) | 4,008 | £60.91 | £0.00 |
| 14 Nov 14:27 | 2,517 / 2,517 (100%) | 0 (all LAS done) | 3,810 | £60.99 | £0.08 |
| 14 Nov 15:10 | 2,532 / 2,532 (100%) | 2,057 in the queue (scans) | 3,795 | £61.00 | £0.09 |
| 14 Nov 17:13 | 2,532 / 2,532 (100%) | 2,057 (no run finished since 15:15) | 3,795 | £61.00 | £0.09 |
| 14 Nov 19:59 | 2,594 / 2,594 (100%) | 1,995 scans in the queue; runs finish again (#129) | 3,733 | £61.01 | £0.10 |
| 14 Nov 21:05 | 2,726 / 2,776 (98.2%) | 1,812 scans in the queue; run #16543 indexed 122 in 39 min | 3,550 | £61.04 | £0.13 |

## Done (checked live)
- Search for Parker Creek returns cited hits at once ("Frost 2 sidetrack", "Frost #2 sidetrack initial oil rate bopd", "Frost 5-10 #2 gamma ray LAS", "KNIGHT 32-10 LAS well curves").
- Fezzan search returns hits ("Fezzan" finds "Field dossier: Fezzan"). Cause: research findings and dossiers had no original file and were never indexed (#119).
- Index health in `get_project_context` (#119, #120).
- LAS well logs indexed by header (#121, #122). All 318 done; "KNIGHT 32-10 4_2306720635.las" is found by search.
- Scans by OCR (#123): the first 15 indexed in run #16450 (14:22 to 14:48), 117 deferred for lack of OCR time.
- Cost: about £0.0003 a file for LAS and scans (the two small Haiku 5.5 calls per file). No model call for chunk context.

## Open
- Scans: about 1,995 left (TIFF, JPG, PNG), about 20 s each. From #124 to #129 every ingest run exited at start (an import cycle I introduced; code 13, unsettled top-level await) and nothing was indexed from 15:15 to 19:36. Fixed in #129, checked live: run #16532 finished and indexed 31. OCR time back to 20 minutes a run (#130), so the scans should clear within a day. Only the first page of a multi-page TIFF is read.
- WorkDrive sync re-lists the whole folder each run ("changes token expired; full listing") and now passes its 10-minute limit (#128), so new WorkDrive files are not picked up until that is fixed. Files already stored keep indexing. Not fixed.
- Still unsupported, not planned: LPT 456, LIC 347, DAT 137, IDX 136, BLB 76, PDS 57, ALI 56 (log-plot and mapping-project files), ZIP 195, MSG 88, DOC 43, ASC 26.
- One zero-byte PDF (APWH00199…PEX_MLT_COMBINED.pdf) was retried 51 times. It is marked empty from #120 on.

## Projection
- About £0.0003 a file. The 1,812 scans left come to about £0.55, far inside the £50 cap.
- About 130 files a run, a run about every 40 minutes: about 10 hours from 21:05 on 14 Nov.
- 50 scans OCRed to no text (or were over 25 MB): counted as needs OCR, not indexed.
- Counting the queued scans as readable, 2,726 of about 4,590 (59%) are indexed today. The 95% mark comes when the queue clears.

## Waiting on the owner
- Nothing.

## Making the repository private (read only, nothing changed)
What reads the repository today and would need access before it goes private:
- **Render**: every service in `render.yml` (the public site, the Vault API and its cron jobs) builds from this repository on each push. Render's GitHub connection must be allowed to see private repositories; if it was connected as "public only", builds stop.
- **GitHub Actions CI**: keeps working, but private repositories use the plan's Actions minutes (each run here is about 8 minutes, two per push).
- **Claude GitHub App**: already installed on the repository; keeps working.
- **Raw GitHub URLs**: none in the code fetch this repository. The only raw URL is `scripts/build-geo.mjs`, which fetches a different public repository (Natural Earth). Docs link to github.com pages of this repository (`HANDOVER.md`, `vault/SETUP.md`), which only people with access could then open.
- **Cloudflare**: the two Workers in `cloudflare/` do not read GitHub; they call the Vault API and the site host. Nothing to grant, unless they are deployed through Cloudflare's own Git connection; I could not see that from here.
- Could not check: the Render dashboard (which GitHub account and access it uses) and Cloudflare's dashboard.

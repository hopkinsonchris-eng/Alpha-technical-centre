# Status

Updated 28 Nov 2026, 14:00 UTC. Live readings come from `get_project_context`: section "Index health" for indexing and section "Search health" for search.

## Search (27 and 28 Nov 2026)

**Search works in every scope, word match and meaning-based together, in 2 to 6 seconds.**

### Done (checked live)
- #132 Search health in `get_project_context`: sizes, database settings, running statements, query plans and the time each search stage took.
- #133 Search answers or fails clearly within about 20 seconds and leaves nothing running in the database.
- #134 Scope is applied before distance.
- #136 (owner's yes, 28 Nov) Large spreadsheets keep every slice for word search and only their first 40 slices keep an embedding; one result per file and per set of identical copies. The ingest job cleared the old embeddings over three runs (13:15, 13:31 and 13:46 UTC) and built `chunks_embedded_idx` (valid, 0.2 MB). Nothing was deleted.
- Checked 13:53 to 13:58 UTC, none partial:
  - Parker Creek "letter to working interest owners proposing to sidetrack a well": the Frost 2 working-interest letter and two related files, 4.6 s.
  - Fezzan "who operates the Sharara oil field": the El Sharara field dossier, 2.1 s (7.2 s on 27 Nov).
  - Firm "what royalty does the government take on federal onshore leases": the BLM royalty note among the hits, 5.9 s.
  - Three at once (Parker Creek, Fezzan, firm): all answered with relevant hits in 3.1 to 5.5 s.
  - "Frost 2 sidetrack" returns `AFE 1000 Frost 2.pdf` once, not three times.

### What stops being findable
- A meaning-based match inside slices 41 onward of a spreadsheet or CSV with more than 100 slices. A word match still finds every row.

### Open
- Speed: 2 to 6 s, not the under one second seen locally. The meaning-based statement took 5.2 s for Parker Creek at 13:53; the embeddings it reads are scattered through a 5.3 GB table on a database with 256 MB of shared buffers. Not yet investigated further.
- A question with no close match returns nothing: "why was the Frost 2 well sidetracked" gave no hits (no word match, and no chunk within the distance ceiling of 0.6).
- The chunk counts in Search health timed out at their 8 s limit at 13:24 and 13:53, so the number of chunks that still carry an embedding has not been read; the evidence that clearing finished is the index and the searches above.
- Size: the database went from 6.37 GB to 6.80 GB during the clearing (chunk rows 729 MB to 1.02 GB, indexes 269 MB to 384 MB). The space freed inside the table is reused, not returned to disk.
- WorkDrive sync still re-lists the whole folder each run and is left at 600 s. Not started.

### Waiting on the owner
- Nothing.

### Model spend
- £0.00 for this work. Ledger: £61.72 in total, £0.00 today (28 Nov 13:53 UTC).

### What the live system said on 27 Nov, before #136 (16:13 and 16:37 UTC)
- 943,264 chunks; 935,788 are Parker Creek's, 7,302 the firm's, 114 Fezzan's.
- 197 Parker Creek spreadsheets (daily workover and completion reports) hold 922,432 of them; the largest two hold about 25,040 each.
- 1,733 Parker Creek files are stored more than once: 3,670 extra copies carrying 218,114 chunks.
- The chunks table is 6.27 GB (rows 729 MB, embeddings 5.30 GB, indexes 269 MB); the database is 6.37 GB.
- Postgres 17.6, pgvector 0.8.2, shared_buffers 256 MB, maintenance_work_mem 64 MB, statements cancelled by the database at 120 s.
- No vector index. Every meaning-based search computed the distance to every chunk it could reach.

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

# M09 — Document ingest and indexing

**Wave 3 · Tier B · Depends on: M02 · Size L**

## Purpose
Get every letter, report, spreadsheet, presentation, paper and note into the
Vault as an immutable original with extracted text, contextual chunks,
embeddings and full-text index.

## Read first
`../02-practice-scan.md` P11 (contextual retrieval), `vault-item.schema.json`, `../06-architecture.md` §3; Zoho WorkDrive API docs for team-folder listing and download.

## Deliverables
- `POST /api/ingest/upload` (multipart, one or many files, project id, optional legal tag) → Items.
- `vault/src/ingest/workdrive.ts`: scheduled sync of configured WorkDrive team folders (mapping folder → project in `vault/master/workdrive-map.json`), download new or changed files by modified time and hash, create Items with `origin.source: zoho-workdrive`.
- `vault/src/ingest/extract.ts`: text extraction for PDF (pdf text layer, OCR fallback via tesseract for scanned pages), DOCX, XLSX (each sheet as a table with cell references kept), PPTX, HTML, MD, EML; output `derived/<item-id>/text.md` with page or sheet anchors.
- `vault/src/ingest/chunk.ts`: chunks of ~600 tokens with 15% overlap; for each chunk an LLM-written 50–100 token context (document title, section, what the chunk is about) prepended before embedding and before the tsvector (Anthropic contextual-retrieval pattern, Batch API, prompt-cached document).
- `vault/src/ingest/embed.ts`: provider interface `embed(texts[]) → float[][]` with a Voyage implementation and a deterministic fake for tests; 1024 dimensions.
- Chunks carry `legal_tag`, `client_id`, `project_id`, `item_id`, `version` so the gateway can filter inside the query.
- Re-ingest on new item version; old version's chunks kept but marked.
- `vault/src/ingest/legal-finance.ts`: typed extraction for `nda`, `contract`, `licence`, `insurance`, `invoice`, `purchase-order`, `proposal`, `timesheet`, `expense` (parties, dates, amounts, currency, expiry, governing law, paid status) with evidence quotes; an NDA's expiry is proposed as the client's legal-tag expiry in the review queue; items in these types get `partners_only: true` unless the project says otherwise.
- `vault/src/ingest/zoho-books.ts` (only if D11 = a): sync invoices, purchase orders and expenses by modified time; each becomes an Item with the PDF as original and the structured record in `extracted`.

## Acceptance criteria
1. Uploading the fixture set (PDF with text, scanned PDF, DOCX, XLSX with 3 sheets, PPTX, an NDA, an invoice) yields one Item each with non-empty text and anchors; the NDA and invoice have parties, dates and amounts extracted with quotes, and are `partners_only`.
2. The same file uploaded twice yields one Item (hash dedupe); a changed file yields version 2.
3. Every chunk has a context prefix and a tsvector; count per document within ±10% of `tokens/600`.
4. WorkDrive sync on the test folder creates Items for new files and versions for modified files, none for unchanged.
5. Ingest of a 50-page PDF completes in < 60 s excluding LLM latency.

## Smoke tests
`vault/test/ingest.extract.test.mjs`, `ingest.chunk.test.mjs` (with the fake embedder), `ingest.workdrive.test.mjs` (recorded API responses).

## Out of scope
Email (M10), papers and feeds (M11), search ranking (M12).

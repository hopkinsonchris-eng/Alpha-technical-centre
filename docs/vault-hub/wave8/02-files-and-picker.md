# Wave 8 — the project's files, and a tool that can open one (Markup)

Tooler, 8 October 2026. Chris Hopkinson, the evening the Parker Creek folder started landing from WorkDrive: "I understand that all of this data is invested into Supabase. Is there a way of having a file picker that shows the Supabase structure so that users can navigate to a file and open it from there. How are the tools going to access data from the Hub?" Then, to the proposal below: "Do it."

## 1. Where the structure is (the fact the Markup rests on)

Supabase Storage holds bytes only, keyed by content hash (`originals/<2 hex>/<sha256>`); there are no folders in the bucket. The structure is in the Vault's `items` table: project, type, title, version, and for every WorkDrive file the folder it came from in `extracted.workdrive.path` ("Alpha technical / Parker Creek/Reserves VDR/Logs"). So the picker is built over the Vault, through the API, never over Supabase, and every read passes `canSee` (confidentiality is structural, AGENTS.md rule 4).

## 2. Practice scan (compressed)

| Who | What they do | Taken here |
|---|---|---|
| Petrel, Techlog, Kingdom | A project tree in the left pane; every loader starts from it, and the loaded file is recorded on the object it fed | The tree per project and the run citing `doc:<id>` with its version |
| Google Drive picker, OneDrive file picker | One picker component every app embeds; the app gets an id and a download URL, never the storage | `vault.pickItem` in the client library, returning the record; bytes through the originals route |
| GitHub, Dropbox | Breadcrumbs, a find box that filters the tree in place, a type filter | Find and type chips above the tree |
| Mac Finder, iPadOS Files | Folders collapsible, counts, the same control in every app's Open dialog | `<details>` folders with counts; the Hub tab and the tool dialog share one tree builder |

## 3. BEFORE → AFTER

| Surface | Before | After |
|---|---|---|
| Project page | Documents listed flat on the timeline and in the asset panel; nothing shows where a file came from | A **Files** tab, second after Timeline, with the count. A tree: WorkDrive folders as they are in the Team Folder, hand uploads under "Uploaded", mail under "Mail", the Vault's own notes under "Research", the rest under "Other". Folders collapsible with counts; the top folders open. A find box filtering by name as you type and type chips (PDF, Sheet, Image, Mail, Other). Each row: icon by kind, name, version badge from v2, date, size when known. Tap a row: the record panel with the viewer or the download, as it already works. Both languages. |
| `GET /api/projects/:id/files` (new) | none | `{ project_id, count, files: [{id, name, path, source, type, mime, size, version, created_at, authored_at}], generated_at }`, every row past `canSee`, hidden rows absent, 404 for a project outside scope. One call per project page; a project of 2,300 files answers in one body. |
| Client library `js/vault-client.js` | saves and reloads runs, resolves versions, Find, project picker | adds `files(projectId)`, `readOriginal(id, {version})` → `{bytes, mime, filename}`, `pickItem({project, types, accept})` → the chosen record or null in a dialog with the same tree, find box and type chips (inline styles, no `style.css`), and `pickFile(opts)` → `{file: File, item}` for tools that already take a `File`. Local mode: `files` answers `[]`, `pickItem` resolves null with a line saying the Vault is not reachable. |
| `js/vault-files.js` (new) | none | The tree builder both renderers use: `buildTree(files)` → folders with counts, `kindOf(file)`, `matches(file, term, kinds)`. |
| ELA Studio | "Import data" reads a spreadsheet from the device | "Open from Vault" beside it, in server mode with a project chosen: the picker (spreadsheets and CSV), the chosen original fed to the studio's own import, and the next saved run carries `inputs: [{ref: 'doc:<id>', kind: 'document', version}]`, so lineage and staleness know what the calculation read. |

Out of scope, named: writing files from a tool back into the Vault (runs already go through `saveRun`); renaming or moving files (WorkDrive is the source of truth for its folders); a tree on Today across projects.

## 4. Files

Vault: `src/api/files.routes.ts` (new). Hub: `hub/components/file-tree.js` (new), `hub/project.js`, `hub/project.html`, `hub/hub.css`. Site: `js/vault-files.js` (new), `js/vault-client.js`, `ela-studio/vault-bridge.js`. Tests: `vault/test/files.routes.test.ts` (new), `test/vault-files.test.mjs` (new), `test/vault-client.test.mjs`, `test/e2e/hub-files.spec.mjs` (new), `test/e2e/ela-studio-files.spec.mjs` (new). Docs: this file, the wave 7 decision log, `docs/vault-hub/modules/M04-vault-client-library.md` (usage).

## 5. Acceptance criteria

- **W8-AC9** `GET /api/projects/:id/files` lists every visible, unhidden item of the project with its folder path (the WorkDrive path, or null), source, type, mime, size, version and dates; a partners-only item is absent for a member; a hidden item is absent for everyone; a project the caller cannot see is 404; the audit row carries the project scope and the count.
- **W8-AC10** The project page has a Files tab with the count; the tree shows WorkDrive folders nested as in the path, "Uploaded" for hand uploads and "Mail" for captured mail, each folder with its count; typing in the find box keeps only the rows whose name contains the term and hides empty folders; a type chip keeps only that kind; a row tap opens the record panel for that document. Both languages.
- **W8-AC11** `js/vault-files.js` builds the same tree from the same list in Node: nested folders, counts, kinds, and the find and kind filters; an empty list builds an empty tree.
- **W8-AC12** `vault.files(project)` reads the route in server mode and answers `[]` in local mode; `vault.readOriginal(id)` fetches the originals route with the session cookie and returns the bytes, mime and filename; `vault.pickItem` resolves null in local mode without a request.
- **W8-AC13** In ELA Studio with the Vault reachable and a project chosen, "Open from Vault" opens the picker listing that project's spreadsheets and CSVs in their folders; choosing one applies it through the studio's import and shows the file name; the run saved next carries `{ref: 'doc:<id>', kind: 'document', version}` in its inputs. With the Vault unreachable the button is absent and the studio is unchanged.
- **W8-AC14** No request from any Hub or tool page goes to Supabase; the bucket, the service key and the storage keys never reach the browser (the files route returns none of them).

## 6. Smoke plan

| Criterion | Test |
|---|---|
| W8-AC9 | `files.routes.test.ts`: three WorkDrive items under two paths, one upload, one partners-only NDA, one hidden; the partner sees five with paths, the member four; an outsider gets 404; no `storage_key` in any row |
| W8-AC10 | `hub-files.spec.mjs`: the stubbed route with six files; tab count 6; folder labels and counts; find "tracer" leaves one row and one folder; the Sheet chip leaves the xlsx; the row tap opens `#record-panel` with the title; ES labels; evidence `w8-files-tab.png` |
| W8-AC11 | `vault-files.test.mjs` in Node |
| W8-AC12 | `vault-client.test.mjs` with the fetch stub: the route called with the project id, the originals route called with `credentials: 'same-origin'`, bytes and mime back, local mode answers |
| W8-AC13 | `ela-studio-files.spec.mjs`: stubbed files route and originals route (a CSV naming two classes); the button, the dialog rows, the choice, the class N changed, the saved run's inputs |
| W8-AC14 | the Playwright specs assert no request to `*.supabase.co`; the route test asserts the row keys |

Risks: a project of thousands of files renders thousands of rows; folders start collapsed below the top level so the DOM stays small, and the find box narrows before it widens. Rollback: revert the PR; the route is read-only.

# M03 — Tool registry and catalog

**Wave 1 · Tier C for parser and aggregator, Tier B for integration · Depends on: M00 · Size S**

## Purpose
Make every tool self-describing and make the `current` alias the only thing
any link resolves. Replaces the hand-bumped `?v=` tokens.

## Read first
`../schemas/tool-manifest.schema.json`; commit `d8a4835` (why the `?v` pin exists); `admin.html` and `tools.html` (current hard-coded links); https://keepachangelog.com/en/1.1.0/.

## Deliverables
- `tools/<id>/tool.json` for: `opportunity-register`, `apex-reservoir-3d` (reservoir-simulator.html), `ela-studio`, `ela-model-suite`, `financial-model`, `nodal-analysis`, `plan-your-job`, `situation-room`, `apex-asset-intelligence` (external), `apex-3d-model` (external), `insight-radar` (skill). Initial versions from the version strings already in the pages (`v2.2`, `v1.0`, `v4`), commit from `git log -1 --format=%h -- <file>`.
- `tools/<id>/CHANGELOG.md` seeded from `git log` for the tool's files.
- `vault/src/catalog.ts`: `buildCatalog(rootDir): Catalog` (validates every manifest, resolves aliases, parses changelogs into `{version, date, sections}`), `resolve(catalog, id): {entry, modules: string[], version, commit}`.
- `GET /api/catalog`, `GET /api/tools/:id/resolve`; a static `hub/catalog.json` emitted at build time as a fallback.
- `opportunity-register.html`: replace `?v=2` imports with the resolved module URLs (`?v=<version>` derived from the manifest) via M04 once available; until then a build script rewrites the token from `tool.json`.
- Deprecation: a manifest with `lifecycle: deprecated` and `aliases.current` pointing at another tool id makes `resolve` return that tool.

## Contract
```ts
export type Catalog = { tools: ToolManifest[]; built_at: string; commit: string };
export function buildCatalog(rootDir: string): Catalog;      // throws on any invalid manifest
export function resolve(catalog: Catalog, id: string): { entry: string; modules: string[]; version: string; commit: string };
export function parseChangelog(md: string): { version: string; date: string; sections: Record<string,string[]> }[];
```

## Acceptance criteria
1. `buildCatalog` throws naming the file and JSON path on any invalid manifest.
2. Changing `aliases.current` in a fixture changes `resolve()` output and nothing else (AC1).
3. `parseChangelog` handles Unreleased, Added/Changed/Deprecated/Removed/Fixed/Security, newest first.
4. Every tool linked from `admin.html` and `tools.html` today has a manifest.
5. The Register still loads the same `potential.js` version after the token rewrite (existing `test/potential.test.mjs` green).

## Smoke tests
`vault/test/catalog.test.mjs` with 3 valid and 3 invalid manifests; snapshot test of `hub/catalog.json`.

## Out of scope
The Hub page that displays the catalog (M06); run capture (M05).

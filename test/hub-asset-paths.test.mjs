// Every Hub page must reference its stylesheets and scripts by absolute path. The static host
// also serves /hub (no trailing slash) and /hub/project (no extension); at those addresses a
// relative "hub.css" resolves to /hub.css or works only by accident, and the page renders
// unstyled with its script missing. The Access App Launcher links to /hub without the slash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../hub');
const pages = readdirSync(HUB).filter((f) => f.endsWith('.html'));

test('hub pages exist', () => { assert.ok(pages.length >= 8, pages.join(', ')); });

for (const page of pages) {
  test(`${page}: stylesheets and scripts use absolute paths`, () => {
    const html = readFileSync(path.join(HUB, page), 'utf8');
    const refs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"|<script[^>]+src="([^"]+)"/g)].map((m) => m[1] || m[2]);
    assert.ok(refs.length >= 2, `${page} references no assets`);
    for (const r of refs) assert.ok(r.startsWith('/') || /^https?:/.test(r), `${page}: "${r}" is relative; use /hub/... or /...`);
  });
}

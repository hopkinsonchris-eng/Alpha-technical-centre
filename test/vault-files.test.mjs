/* Wave 8 PR 2 (docs/vault-hub/wave8/02-files-and-picker.md, W8-AC11): the tree builder the Hub's Files tab and the
 * client library's picker share. Pure functions, no DOM: node --test test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, kindOf, matches, splitPath, fmtSize, GROUPS } from '../js/vault-files.js';

const ROOT = 'Alpha technical / Parker Creek';
const f = (id, name, path, extra = {}) => ({ id, name, title: name, path, source: 'zoho-workdrive', type: 'report', mime: null, size: null, version: 1, created_at: '2026-10-07T17:34:46.357Z', authored_at: null, ...extra });
const FILES = [
  f('a', '06_8_2021_tracer.MAIN.pdf', `${ROOT}/Reserves VDR/Logs`, { mime: 'application/pdf', size: 1234 }),
  f('b', 'SHOW #124-8.tiff', `${ROOT}/Reserves VDR/Logs`, { mime: 'image/tiff' }),
  f('c', 'Reserves summary.xlsx', `${ROOT}/Reserves VDR`, { type: 'spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', version: 2 }),
  f('d', 'Frost 2 Openhole Logs.zip', `${ROOT}/Extracted_Petra`, { mime: 'application/zip', size: 60 * 1024 * 1024 }),
  f('e', 'production.xlsx', null, { source: 'upload', type: 'spreadsheet', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
  f('g', 'RE: Frost well LAS files', null, { source: 'zoho-mail', type: 'email', mime: 'message/rfc822' }),
];

test('W8-AC11: WorkDrive paths nest as folders with counts, a mapped folder name with " / " stays one folder, and the other sources sit in named groups after them', () => {
  const tree = buildTree(FILES);
  assert.equal(tree.count, 6);
  assert.deepEqual(tree.files, [], 'nothing sits at the root');
  assert.deepEqual(tree.folders.map((d) => [d.name, d.count, d.group]), [[ROOT, 4, null], ['Uploaded', 1, 'upload'], ['Mail', 1, 'mail']]);
  const root = tree.folders[0];
  assert.deepEqual(root.folders.map((d) => [d.name, d.count]), [['Extracted_Petra', 1], ['Reserves VDR', 3]], 'folders sorted by name');
  const vdr = root.folders[1];
  assert.deepEqual(vdr.files.map((x) => x.id), ['c'], 'a file directly in the folder');
  assert.deepEqual(vdr.folders[0].files.map((x) => x.id), ['a', 'b']);
  assert.equal(vdr.folders[0].path, `${ROOT}/Reserves VDR/Logs`);
  assert.deepEqual(tree.folders[1].files.map((x) => x.id), ['e']);
  assert.deepEqual(GROUPS.upload, { en: 'Uploaded', es: 'Subidos' });
  assert.deepEqual(splitPath(`${ROOT}/Reserves VDR/Logs`), [ROOT, 'Reserves VDR', 'Logs']);
  assert.deepEqual(buildTree([]), { name: '', path: '', group: null, folders: [], files: [], count: 0 });
});

test('W8-AC11: the kind comes from the mime, then the name, then the type; the find term and the kinds filter the list the tree is built from', () => {
  assert.deepEqual(FILES.map(kindOf), ['pdf', 'image', 'sheet', 'other', 'sheet', 'mail']);
  assert.equal(kindOf({ name: 'notes.docx', mime: null, type: 'report' }), 'doc');
  assert.equal(kindOf({ name: 'survey.las', mime: 'application/octet-stream', type: 'report' }), 'other');
  assert.equal(kindOf({ name: 'Letter', mime: null, type: 'letter' }), 'doc');
  assert.equal(kindOf({ name: 'x', mime: null, type: 'email' }), 'mail');
  assert.ok(matches(FILES[0], 'TRACER', null), 'case-insensitive on the name');
  assert.ok(!matches(FILES[0], 'tracer', new Set(['sheet'])));
  assert.ok(matches(FILES[2], '', new Set(['sheet'])));
  const narrowed = buildTree(FILES.filter((x) => matches(x, 'tracer', null)));
  assert.equal(narrowed.count, 1);
  assert.deepEqual(narrowed.folders.map((d) => d.name), [ROOT], 'empty folders are gone');
  assert.deepEqual(narrowed.folders[0].folders[0].folders[0].files.map((x) => x.id), ['a']);
  assert.equal(buildTree(FILES.filter((x) => matches(x, '', new Set(['sheet'])))).count, 2);
  assert.deepEqual([fmtSize(null), fmtSize(0), fmtSize(1234), fmtSize(60 * 1024 * 1024)], ['', '', '1.2 KB', '60 MB']);
});

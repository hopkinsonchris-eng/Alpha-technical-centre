// 12 Oct 2026: a World Monitor intel-timeline placeholder title ("GDELT 190 — in Libya") is filed under the headline its
// article address carries; real titles are kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headlineFromUrl, readableTitle } from '../src/research/findings.ts';

const AI = 'https://www.africaintelligence.com/north-africa/2026/10/06/new-setback-for-kuwaiti-group-al-kharafi-in-battle-with-libyan-sovereign-fund,110890783-art';

test('the headline is read from the article address', () => {
  assert.equal(headlineFromUrl(AI), 'New setback for kuwaiti group al kharafi in battle with libyan sovereign fund');
  assert.equal(headlineFromUrl('https://example.com/news/2026/libya-oil-output-rises-to-decade-high.html'), 'Libya oil output rises to decade high');
  assert.equal(headlineFromUrl('https://example.com/a/123456'), null, 'no words, no headline');
  assert.equal(headlineFromUrl('not a url'), null);
});

test('a placeholder title takes the headline; a real title is kept; no headline names the site', () => {
  assert.equal(readableTitle('GDELT 190 — in Libya', AI), 'New setback for kuwaiti group al kharafi in battle with libyan sovereign fund');
  assert.equal(readableTitle('NOC signs EPSA with Eni', AI), 'NOC signs EPSA with Eni');
  assert.equal(readableTitle('GDELT 12 - in Libya', 'https://www.reuters.com/p/9981'), 'Article on reuters.com');
  assert.equal(readableTitle('GDELT 12 — in Libya', null), 'GDELT 12 — in Libya');
});

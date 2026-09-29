import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { letterDocx, letterHtml, htmlToPdf, stripCitations, dateWords, type LetterInput } from '../src/render/letter.ts';
import { findChromium } from '../src/rerun/runner.ts';

const SEED = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json'), 'utf8'));

function letterFromSeed(lang: 'en' | 'es' = 'en'): LetterInput {
  const org = SEED.organisation, contact = SEED.contacts[0];
  return {
    language: lang, reference_no: 'ATC-2026-0151', their_reference: 'PDO-PR-2026-088', date: new Date('2026-09-29T00:00:00Z'),
    organisation: { name: org.name, registered_address: org.registered_address }, contact: { name: contact.name, role: contact.role, postal_address: contact.postal_address },
    subject: 'Proposed scope of a joint technical evaluation of extra-heavy oil development options',
    confidentiality_note: 'Confidential under the NDA of 14 February 2026 [doc:00000000-0000-4000-8000-000000000053]',
    paragraphs: [
      'Further to our clarification letter of 8 July 2026 [doc:00000000-0000-4000-8000-000000000056], we write to propose the scope of a joint technical evaluation.',
      'Our screening of eight analogue fields indicates primary recovery of 6% to 12% of STOIIP under cold production [run:00000000-0000-4000-8000-000000000002].',
    ],
    signatory: { name: 'Chris Hopkinson', signature_block: 'Chris Hopkinson\nManaging Partner\nAlpha Technical Centre' },
    previous_correspondence: SEED.dispatches.map((d: any) => ({ date: d.occurred_at.slice(0, 10), direction: d.direction, reference: d.reference_no ?? d.their_reference, subject: d.notes })),
  };
}

/** Read word/document.xml out of a DOCX buffer without a zip dependency. */
function docxText(buf: Buffer): string {
  const sig = Buffer.from('504b0304', 'hex');
  let off = 0; const parts: string[] = [];
  while ((off = buf.indexOf(sig, off)) >= 0) {
    const method = buf.readUInt16LE(off + 8), csize = buf.readUInt32LE(off + 18), nlen = buf.readUInt16LE(off + 26), xlen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nlen).toString();
    const data = buf.subarray(off + 30 + nlen + xlen, off + 30 + nlen + xlen + csize);
    if (name === 'word/document.xml' || name.startsWith('word/header') || name.startsWith('word/footer')) parts.push(method === 8 ? inflateRawSync(data).toString() : data.toString());
    off += 30 + nlen + xlen + csize;
  }
  return parts.join('\n');
}

test('citations are stripped from the sent copy and kept in the vault copy', () => {
  assert.equal(stripCitations('NPV10 fell [run:abc] to 92 [doc:def#p3].'), 'NPV10 fell to 92.');
  const html = letterHtml(letterFromSeed());
  assert.ok(!/\[run:|\[doc:/.test(html));
  const kept = letterHtml({ ...letterFromSeed(), keep_citations: true });
  assert.ok(/\[run:00000000/.test(kept));
});

test('dates in words, both languages', () => {
  assert.equal(dateWords(new Date('2026-09-29T00:00:00Z'), 'en'), '29 September 2026');
  assert.equal(dateWords(new Date('2026-09-29T00:00:00Z'), 'es'), '29 de septiembre de 2026');
});

test('AC15 rendering: DOCX and HTML carry the reference, the addressee and all six previous dispatches', async () => {
  const input = letterFromSeed();
  const html = letterHtml(input);
  const docx = await letterDocx(input);
  const xml = docxText(docx);
  for (const out of [html, xml]) {
    assert.ok(out.includes('ATC-2026-0151'), 'our reference');
    assert.ok(out.includes('PDO-PR-2026-088'), 'their reference');
    assert.ok(out.includes('Petrolera del Orinoco S.A.'));
    assert.ok(out.includes('María Fernández'));
    for (const d of SEED.dispatches) assert.ok(out.includes(d.reference_no ?? d.their_reference), `dispatch ${d.reference_no ?? d.their_reference}`);
    assert.ok(out.includes('Managing Partner'));
    assert.ok(out.includes('29 September 2026'));
  }
  assert.ok(xml.includes('Previous correspondence'));
  assert.ok(docx.length > 20_000, 'letterhead image embedded');
  const es = letterHtml(letterFromSeed('es'));
  assert.ok(es.includes('Nuestra ref.') && es.includes('Correspondencia previa') && es.includes('29 de septiembre de 2026'));
});

test('PDF is produced from the HTML in headless Chromium', { skip: !findChromium() && 'no Chromium' }, async () => {
  const pdf = await htmlToPdf(letterHtml(letterFromSeed()));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 10_000);
});

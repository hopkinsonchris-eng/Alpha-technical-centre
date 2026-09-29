/**
 * Generates the ATC letterhead DOCX (EN and ES) from the brand assets.
 * Run: npx tsx firm/assets/make-letterhead.ts   (writes letterhead-en.docx, letterhead-es.docx)
 */
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Packer, Paragraph, TextRun, Header, Footer, ImageRun, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType } from 'docx';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NAVY = '0B1F3A', GOLD = 'C9A84C', STEEL = '6B7A8D';
const logo = readFileSync(path.join(DIR, 'logo-lockup-light.png'));

function build(lang: 'en' | 'es') {
  const tagline = lang === 'en' ? 'Technical evaluation for upstream oil and gas in Latin America' : 'Evaluación técnica para el upstream de petróleo y gas en América Latina';
  const footer = lang === 'en'
    ? 'Alpha Technical Centre · a wholly-owned subsidiary of Alpha Energy Latin America · info@alpha-technical-centre.com · www.alpha-technical-centre.com'
    : 'Alpha Technical Centre · filial de Alpha Energy Latin America · info@alpha-technical-centre.com · www.alpha-technical-centre.com';
  const header = new Header({
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE, size: 0 }, bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD }, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 }, insideHorizontal: { style: BorderStyle.NONE, size: 0 }, insideVertical: { style: BorderStyle.NONE, size: 0 } },
        rows: [new TableRow({ children: [
          new TableCell({ width: { size: 45, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new ImageRun({ data: logo, transformation: { width: 220, height: 220 * 0.27 }, type: 'png' })] })] }),
          new TableCell({ width: { size: 55, type: WidthType.PERCENTAGE }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: tagline, font: 'Barlow', size: 18, color: STEEL })] })] }),
        ] })],
      }),
      new Paragraph({ text: '' }),
    ],
  });
  const foot = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } }, children: [new TextRun({ text: footer, font: 'Barlow', size: 16, color: NAVY })] })] });
  return new Document({
    creator: 'Alpha Technical Centre', title: `ATC letterhead (${lang})`,
    styles: { default: { document: { run: { font: 'Barlow', size: 22, color: NAVY } } } },
    sections: [{ properties: { page: { margin: { top: 1400, bottom: 1100, left: 1300, right: 1300 } } }, headers: { default: header }, footers: { default: foot }, children: [new Paragraph({ children: [new TextRun({ text: '{{body}}', font: 'Barlow' })] })] }],
  });
}

for (const lang of ['en', 'es'] as const) {
  const buf = await Packer.toBuffer(build(lang));
  writeFileSync(path.join(DIR, `letterhead-${lang}.docx`), buf);
  console.log(`letterhead-${lang}.docx ${buf.length} bytes`);
}

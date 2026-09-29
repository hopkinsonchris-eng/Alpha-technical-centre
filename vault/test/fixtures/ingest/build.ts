/** Binary fixtures for the M09 tests, generated at test time so no opaque binaries are committed. */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow } from 'docx';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

/** A text PDF: one string per page (long strings wrap). */
export async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    for (const para of text.split('\n')) {
      const words = para.split(' ');
      let line = '';
      const flush = () => { if (line) { page.drawText(line, { x: 50, y, size: 10, font }); y -= 13; line = ''; } };
      for (const w of words) {
        if (font.widthOfTextAtSize(`${line} ${w}`, 10) > 495) flush();
        line = line ? `${line} ${w}` : w;
      }
      flush();
      y -= 7;
    }
  }
  return doc.save();
}

/** A PDF whose pages are pictures of text: no text layer at all (a scan). */
export async function makeScannedPdf(lines: string[]): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(1240, 500);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 1240, 500);
  g.fillStyle = '#000'; g.font = '40px sans-serif';
  lines.forEach((l, i) => g.fillText(l, 50, 90 + i * 80));
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(canvas.toBuffer('image/png'));
  const page = doc.addPage([620, 250]);
  page.drawImage(img, { x: 0, y: 0, width: 620, height: 250 });
  return doc.save();
}

export async function makeDocx(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Carabobo Screening Report', heading: HeadingLevel.HEADING_1 }),
        new Paragraph('This report screens the Carabobo heavy oil area for a cold production redevelopment.'),
        new Paragraph({ text: 'Reservoir summary', heading: HeadingLevel.HEADING_2 }),
        new Paragraph('The Morichal member is a stacked channel sand with 3.2 Darcy permeability and 8.5 API oil.'),
        new Table({ rows: [
          new TableRow({ children: ['Well', 'Rate (bbl/d)'].map(t => new TableCell({ children: [new Paragraph(t)] })) }),
          new TableRow({ children: ['CB-12', '410'].map(t => new TableCell({ children: [new Paragraph(t)] })) }),
        ] }),
      ],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

/** Three sheets: Prices, Wells, Notes. */
export function makeXlsx(): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Year', 'Brent (USD/bbl)'], [2026, 74.5], [2027, 71], [2028, 69.25]]), 'Prices');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Well', 'Field', 'Rate (bbl/d)'], ['CB-12', 'Carabobo', 410], ['CB-15', 'Carabobo', 385]]), 'Wells');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Note'], ['Prices are a flat real deck | pipe test'], ['Rates are 2025 averages']]), 'Notes');
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/** A minimal PPTX: two slides and speaker notes on the second. */
export async function makePptx(): Promise<Uint8Array> {
  const zip = new JSZip();
  const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const slide = (lines: string[]) => `<?xml version="1.0" encoding="UTF-8"?><p:sld ${ns}><p:cSld><p:spTree>${lines.map(l => `<p:sp><p:txBody><a:p><a:r><a:t>${l}</a:t></a:r></a:p></p:txBody></p:sp>`).join('')}</p:spTree></p:cSld></p:sld>`;
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('ppt/presentation.xml', `<?xml version="1.0"?><p:presentation ${ns}/>`);
  zip.file('ppt/slides/slide1.xml', slide(['Carabobo redevelopment', 'Phase 1 delivers 12 kbbl/d', 'Capex &amp; opex assumptions']));
  zip.file('ppt/slides/slide2.xml', slide(['Fiscal terms', 'Royalty 33.3%']));
  zip.file('ppt/notesSlides/notesSlide2.xml', slide(['Mention the windfall clause', '2']));
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

const SENTENCES = [
  'The Morichal member is a stacked channel sand with high permeability and viscous oil.',
  'Cold production with sand relies on wormhole growth to sustain rates over several years.',
  'Fiscal terms combine a royalty, an income tax and a windfall levy above a price threshold.',
  'Operating costs per barrel are dominated by diluent supply and trucking of the produced crude.',
  'The screening compares steam assisted gravity drainage with cyclic steam stimulation on a common basis.',
  'Sensitivities on oil price, decline rate and capital cost are reported as a tornado chart.',
  'Well spacing of 400 metres balances recovery against interference between neighbouring producers.',
];

/** Deterministic prose: `n` paragraphs of 3-5 sentences, numbered so every paragraph is distinct. */
export function paragraphs(n: number, label = 'Section'): string[] {
  return Array.from({ length: n }, (_, i) => `${label} ${i + 1}. ` + Array.from({ length: 3 + (i % 3) }, (_, j) => SENTENCES[(i * 3 + j) % SENTENCES.length]).join(' '));
}

export const longPdf = (pages: number) => makePdf(Array.from({ length: pages }, (_, p) => paragraphs(6, `Page ${p + 1} paragraph`).join('\n')));

export const EML = [
  'From: =?UTF-8?Q?Mar=C3=ADa_Fern=C3=A1ndez?= <mfernandez@petroleradelorinoco.com>',
  'To: Chris Hopkinson <chris@alpha-technical-centre.com>',
  'Subject: Carabobo data room access',
  'Date: Tue, 03 Feb 2026 10:15:00 +0000',
  'Message-ID: <abc123@petroleradelorinoco.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="BOUND"',
  '',
  '--BOUND',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hola Chris,',
  '',
  'El acceso al cuarto de datos ser=C3=A1 habilitado el lunes.',
  '',
  '--BOUND',
  'Content-Type: application/pdf; name="nda.pdf"',
  'Content-Disposition: attachment; filename="nda.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQK',
  '--BOUND--',
  '',
].join('\n');

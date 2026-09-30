/**
 * Perupetro (Peru) statistics, published as Excel downloads with no API (M11).
 * The downloads to watch are listed in configuration (master/topics.json,
 * sources.perupetro.downloads). Each download becomes one feed-snapshot whose
 * original is the workbook; sheet names, header rows and row counts go in meta.
 * A changed workbook has different bytes and becomes a new item version.
 */
import * as XLSX from 'xlsx';
import type { FeedAdapter, FeedRecord } from './types.ts';
import { Http, HttpError, type AdapterOptions } from './util.ts';

export interface PerupetroDownload { id: string; url: string; label: string }
export interface PerupetroOptions extends AdapterOptions { downloads?: PerupetroDownload[] }

export function summariseWorkbook(bytes: Buffer): { sheets: { name: string; rows: number; header: string[] }[]; rows: number } {
  // SheetJS decorates the buffer it is given with parser state, so hand it a copy and keep the original bytes clean.
  const wb = XLSX.read(Buffer.from(bytes), { type: 'buffer', cellDates: true });
  const sheets = wb.SheetNames.map(name => {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: null });
    const headerIdx = grid.findIndex(r => r.filter(c => c != null && c !== '').length >= 2);
    const header = headerIdx >= 0 ? grid[headerIdx].map(c => String(c ?? '').trim()) : [];
    return { name, rows: Math.max(0, grid.length - (headerIdx + 1)), header };
  });
  return { sheets, rows: sheets.reduce((n, s) => n + s.rows, 0) };
}

export function createPerupetroAdapter(o: PerupetroOptions = {}): FeedAdapter {
  const http = new Http(1, o, { accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,*/*' });
  return {
    id: 'perupetro',
    schedule: 'monthly',
    rateLimit: { perSecond: 1 },
    async *fetch(_since: Date): AsyncIterable<FeedRecord> {
      for (const d of o.downloads ?? []) {
        let got;
        try { got = await http.bytes(d.url); }
        catch (e) { if (e instanceof HttpError && [403, 404].includes(e.status)) { o.onWarn?.(`perupetro ${d.id} not available: HTTP ${e.status}`); continue; } throw e; }
        const s = summariseWorkbook(got.bytes);
        const lm = got.headers.get('last-modified');
        yield {
          external_id: `perupetro:${d.id}`,
          url: d.url,
          title: d.label,
          authored_at: lm && !Number.isNaN(Date.parse(lm)) ? new Date(lm).toISOString() : null,
          authors: [],
          text: `${d.label}: ${s.sheets.length} sheets, ${s.rows} rows.`,
          file: got.bytes,
          mime: /\.xls$/i.test(d.url) ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          meta: { dataset: `perupetro:${d.id}`, rows: s.rows, sheets: s.sheets },
        };
      }
    },
  };
}

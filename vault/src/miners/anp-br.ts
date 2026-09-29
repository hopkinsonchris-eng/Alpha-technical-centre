/**
 * ANP Brazil monthly per-well production (M11). Each month is published as a
 * zip of CSVs (semicolon separated, decimal comma). The zip is fetched once,
 * kept as the immutable original, and its CSV entries are read through a
 * streaming parser so a large month never sits in memory decompressed and
 * parsed at once. The record's meta carries the roll-up (rows, wells, totals
 * by field). The URL pattern is configurable: ANP has moved these files before.
 */
import { parse } from 'csv-parse';
import type { FeedAdapter, FeedRecord } from './types.ts';
import { HttpError, Http, parseNum, readZip, systemClock, ym, type AdapterOptions } from './util.ts';

export interface AnpOptions extends AdapterOptions {
  /** `{month}` is replaced with YYYY-MM. */
  urlTemplate?: string;
  encoding?: BufferEncoding;
}

export const ANP_URL_TEMPLATE = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/arquivos-producao-de-petroleo-e-gas-natural/producao-mensal-por-poco-{month}.zip';

const normHeader = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export interface AnpSummary { rows: number; wells: number; oil_total: number; gas_total: number; by_field: Record<string, { oil: number; gas: number; wells: number }>; entries: string[] }

/** Read just enough of the entry to see whether the header line is semicolon or comma separated. */
async function sniffDelimiter(entry: { open(): NodeJS.ReadableStream & { destroy(): unknown } }): Promise<string> {
  const s = entry.open(); let head = '';
  for await (const chunk of s as AsyncIterable<Buffer>) { head += chunk.toString('latin1'); if (head.includes('\n') || head.length > 4096) break; }
  s.destroy();
  const line = head.split('\n')[0];
  return (line.match(/;/g)?.length ?? 0) >= (line.match(/,/g)?.length ?? 0) ? ';' : ',';
}

/** Stream every CSV in the zip and roll it up. Columns are found by name (accents and case ignored), not position. */
export async function summariseAnpZip(zip: Buffer, encoding: BufferEncoding = 'utf8'): Promise<AnpSummary> {
  const out: AnpSummary = { rows: 0, wells: 0, oil_total: 0, gas_total: 0, by_field: {}, entries: [] };
  const wells = new Set<string>();
  const fieldWells = new Map<string, Set<string>>();
  for (const entry of readZip(zip)) {
    if (!/\.csv$/i.test(entry.name)) continue;
    out.entries.push(entry.name);
    const delimiter = await sniffDelimiter(entry);
    let keys: { oil?: string; gas?: string; field?: string; well?: string } | undefined;
    const parser = entry.open().pipe(parse({
      columns: (h: string[]) => h.map(normHeader), delimiter, bom: true, skip_empty_lines: true, relax_column_count: true, encoding,
    }));
    for await (const r of parser as AsyncIterable<Record<string, string>>) {
      keys ??= (() => { const ks = Object.keys(r); return {
        oil: ks.find(k => /petroleo|oleo/.test(k)), gas: ks.find(k => /^gas/.test(k) || /gas_natural/.test(k)),
        field: ks.find(k => /^campo/.test(k)), well: ks.find(k => /^poco|^well/.test(k)),
      }; })();
      const oil = keys.oil ? parseNum(r[keys.oil]) ?? 0 : 0, gas = keys.gas ? parseNum(r[keys.gas]) ?? 0 : 0;
      const field = (keys.field && r[keys.field]) || 'UNKNOWN', well = (keys.well && r[keys.well]) || '';
      out.rows++; out.oil_total += oil; out.gas_total += gas;
      const f = (out.by_field[field] ??= { oil: 0, gas: 0, wells: 0 });
      f.oil += oil; f.gas += gas;
      if (well) { wells.add(`${field}|${well}`); (fieldWells.get(field) ?? fieldWells.set(field, new Set()).get(field)!).add(well); }
    }
  }
  out.wells = wells.size;
  for (const [f, s] of fieldWells) out.by_field[f].wells = s.size;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  out.oil_total = round(out.oil_total); out.gas_total = round(out.gas_total);
  for (const f of Object.values(out.by_field)) { f.oil = round(f.oil); f.gas = round(f.gas); }
  return out;
}

export function createAnpAdapter(o: AnpOptions = {}): FeedAdapter {
  const clock = o.clock ?? systemClock;
  const http = new Http(1, o, { accept: 'application/zip,*/*' });
  const template = o.urlTemplate ?? ANP_URL_TEMPLATE;

  return {
    id: 'anp-br',
    schedule: 'monthly',
    rateLimit: { perSecond: 1 },
    async *fetch(since: Date): AsyncIterable<FeedRecord> {
      const end = ym(new Date(clock.now()));
      let y = since.getUTCFullYear(), m = since.getUTCMonth() + 1;
      for (;; m++) {
        if (m > 12) { m = 1; y++; }
        const month = `${y}-${String(m).padStart(2, '0')}`;
        if (month > end) break;
        const url = template.replace('{month}', month);
        let zip: Buffer;
        try { zip = (await http.bytes(url)).bytes; }
        catch (e) {
          if (e instanceof HttpError && [403, 404].includes(e.status)) { o.onWarn?.(`anp-br ${month} not available: HTTP ${e.status}`); continue; }
          throw e;
        }
        const s = await summariseAnpZip(zip, o.encoding);
        yield {
          external_id: `anp-br:producao-mensal-por-poco:${month}`,
          url,
          title: `ANP monthly production by well, ${month}`,
          authored_at: `${month}-01T00:00:00.000Z`,
          authors: [],
          text: `ANP monthly production by well, ${month}: ${s.rows} well rows, ${s.wells} wells, ${Object.keys(s.by_field).length} fields.`,
          file: zip,
          mime: 'application/zip',
          meta: { dataset: 'anp-br:producao-mensal-por-poco', period: month, rows: s.rows, wells: s.wells, oil_total: s.oil_total, gas_total: s.gas_total, by_field: s.by_field, entries: s.entries },
        };
      }
    },
  };
}

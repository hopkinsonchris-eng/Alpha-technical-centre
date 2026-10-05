/**
 * Dated CSV adapter for the country pack (wave 7 PR4): one download, stored byte for byte, with the header checked
 * against the columns the registry expects (`options.expect_header`, matched without case, accents or surrounding
 * spaces), the delimiter sniffed from the header line (ANP uses `;`, Sodir and Argentina `,`), the encoding detected
 * (ANP's files are Windows-1252, read as latin1; the others UTF-8 with a BOM), and the rows counted with csv-parse so
 * quoted newlines (ANP's multi-line header cells) do not inflate the count.
 *
 * The source's own date comes from `options.freshness_column` when the file carries one (Sodir's `DatesyncNPD`, the
 * synchronisation date every FactPages table shows), else from the Last-Modified header. A header that no longer
 * matches is reported as unreachable with the bytes attached: the job must not draft from a reshaped file, but it may
 * still file what arrived so the change is on record.
 */
import { parse } from 'csv-parse/sync';
import type { CountrySource } from '../types.ts';
import { RefusedError, SourceHttp, describeError, fetchedAt, isoFrom, optionsOf, result, unreachable, type AdapterContext, type AdapterResult } from './shared.ts';

export interface CsvOptions {
  /** Column names that must be present (case, accents and outer spaces ignored; a prefix of the published name is enough). */
  expect_header?: string[];
  delimiter?: ',' | ';' | '\t' | '|';
  encoding?: 'utf8' | 'latin1';
  /** The column whose first value is the publisher's own date. */
  freshness_column?: string;
  title?: string;
  description?: string;
}

export const normaliseHeader = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function sniffDelimiter(firstLine: string): ',' | ';' | '\t' | '|' {
  const counts: [',' | ';' | '\t' | '|', number][] = [[';', 0], [',', 0], ['\t', 0], ['|', 0]].map(([d]) => [d as any, (firstLine.split(d as string).length - 1)]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** utf8 unless the bytes do not decode cleanly, then latin1 (Windows-1252 files such as ANP's). */
export function detectEncoding(bytes: Buffer): 'utf8' | 'latin1' {
  return bytes.toString('utf8').includes('\uFFFD') ? 'latin1' : 'utf8';
}

export const csvAdapter = async (source: CountrySource, ctx: AdapterContext = {}): Promise<AdapterResult> => {
  const at = fetchedAt(ctx);
  const fail = (reason: string, partial: Partial<AdapterResult> = {}) => unreachable(source, reason, ctx, { fetched_at: at, ...partial });
  const { options, error } = optionsOf(source);
  if (error) return fail(error);
  const o = options as CsvOptions;
  const http = new SourceHttp(source, ctx);
  let got: { bytes: Buffer; headers: Headers; url: string };
  try { got = await http.get(source.url, 'text/csv,text/plain;q=0.9,*/*;q=0.5'); }
  catch (e) { return fail(e instanceof RefusedError ? e.message : describeError(e)); }
  if (got.bytes.length === 0) return fail(`empty body from ${source.url}`);

  const encoding = o.encoding ?? detectEncoding(got.bytes);
  const text = got.bytes.toString(encoding).replace(/^﻿/, '');
  const delimiter = o.delimiter ?? sniffDelimiter(text.split(/\r?\n/, 1)[0] ?? '');
  let records: string[][];
  try { records = parse(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as string[][]; }
  catch (e) { return fail(`not a CSV: ${describeError(e)}`, { bytes: got.bytes, url: got.url }); }
  if (records.length === 0) return fail('the CSV has no header line', { bytes: got.bytes, url: got.url });
  const header = records[0].map(h => h.trim());
  const rows = records.length - 1;

  const lastModified = isoFrom(got.headers.get('last-modified'));
  const meta: Record<string, unknown> = { delimiter, encoding, header, columns: header.length, source_modified: lastModified, last_modified_header: lastModified };
  if (o.freshness_column) {
    const idx = header.findIndex(h => normaliseHeader(h) === normaliseHeader(o.freshness_column!));
    const v = idx >= 0 ? records[1]?.[idx] : undefined;
    const d = isoFrom(v);
    meta.freshness_column = o.freshness_column; meta.freshness_value = v ?? null;
    if (d) meta.source_modified = d;
  }
  const title = o.title ?? source.id, description = o.description ?? '';
  const base = { fetched_at: at, url: got.url, title, description, rows, bytes: got.bytes, mime: 'text/csv', meta };

  if (Array.isArray(o.expect_header) && o.expect_header.length) {
    const have = header.map(normaliseHeader);
    const missing = o.expect_header.filter(want => { const w = normaliseHeader(String(want)); return !have.some(h => h === w || h.startsWith(w)); });
    if (missing.length) return fail(`header check failed: missing ${missing.join(', ')}; header was: ${header.join(delimiter)}`, base);
  }
  return result(source, ctx, base);
};

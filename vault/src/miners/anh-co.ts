/**
 * ANH Colombia open data on Socrata (datos.gov.co), M11. Resources:
 *   fdvb-hsrf  oil production by field and month
 *   5dux-bfvx  gas production by field and month
 *   4dai-7crq  further ANH production series (may refuse row access; skipped with a warning)
 * The datasets carry `vigencia` (year, text) and `mes` (month), so the `$where`
 * bounds the year and the month is filtered after the fetch. One feed-snapshot
 * per resource per month. SOCRATA_APP_TOKEN is optional.
 */
import type { FeedAdapter, FeedRecord } from './types.ts';
import { HttpError, Http, groupByMonth, q, snapshotRecord, toMonth, type AdapterOptions } from './util.ts';

export interface AnhResource { id: string; label: string }
export interface AnhOptions extends AdapterOptions { base?: string; appToken?: string; pageSize?: number; maxPages?: number; resources?: AnhResource[] }

export const ANH_RESOURCES: AnhResource[] = [
  { id: 'fdvb-hsrf', label: 'ANH oil production by field (bbl)' },
  { id: '5dux-bfvx', label: 'ANH gas production by field (kpc)' },
  { id: '4dai-7crq', label: 'ANH production series 4dai-7crq' },
];

const monthOfRow = (r: any) => toMonth(r.vigencia, r.mes) ?? toMonth(r.fecha ?? r.fecha_produccion ?? r.periodo);

export function createAnhAdapter(o: AnhOptions = {}): FeedAdapter {
  const base = o.base ?? 'https://www.datos.gov.co';
  const token = o.appToken ?? process.env.SOCRATA_APP_TOKEN;
  const http = new Http(2, o, { accept: 'application/json', ...(token ? { 'x-app-token': token } : {}) });
  const pageSize = o.pageSize ?? 5000, maxPages = o.maxPages ?? 40;

  return {
    id: 'anh-co',
    schedule: 'monthly',
    rateLimit: { perSecond: 2 },
    async *fetch(since: Date): AsyncIterable<FeedRecord> {
      for (const res of o.resources ?? ANH_RESOURCES) {
        const rows: any[] = [];
        try {
          const where = q(`vigencia >= '${since.getUTCFullYear()}'`);
          for (let page = 0; page < maxPages; page++) {
            const batch = await http.json<any[]>(`${base}/resource/${res.id}.json?$where=${where}&$order=${q('vigencia, mes')}&$limit=${pageSize}&$offset=${page * pageSize}`);
            if (!Array.isArray(batch)) throw new Error(`unexpected Socrata response for ${res.id}`);
            rows.push(...batch);
            if (batch.length < pageSize) break;
          }
        } catch (e) {
          if (e instanceof HttpError && [400, 403, 404].includes(e.status)) { o.onWarn?.(`anh-co ${res.id} skipped: ${e.message}`); continue; }
          throw e;
        }
        for (const [month, monthRows] of groupByMonth(rows, monthOfRow, since)) {
          yield snapshotRecord({ dataset: `anh-co:${res.id}`, label: res.label, period: month, url: `${base}/resource/${res.id}.json`, rows: monthRows, meta: { resource: res.id } });
        }
      }
    },
  };
}

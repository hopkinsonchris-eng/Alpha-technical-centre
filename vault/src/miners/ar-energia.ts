/**
 * Argentina open energy data (datos.gob.ar, CKAN datastore), M11. The portal
 * enforces a hard request limit, so the adapter throttles to 4 req/s and pages
 * with limit/offset, newest first, stopping once a page falls before `since`.
 * One feed-snapshot per resource per month.
 */
import type { FeedAdapter, FeedRecord } from './types.ts';
import { Http, groupByMonth, q, snapshotRecord, toMonth, ym, type AdapterOptions } from './util.ts';

export interface ArResource { id: string; label: string; date_field: string }
export interface ArOptions extends AdapterOptions { base?: string; pageSize?: number; maxPages?: number; resources?: ArResource[] }

export const AR_RESOURCES: ArResource[] = [
  { id: 'c730496f-48df-525f-bb72-9b27f79f6d4a', label: 'Argentina oil and gas production and sales by company', date_field: 'indice_tiempo' },
];

export function createArEnergiaAdapter(o: ArOptions = {}): FeedAdapter {
  const base = o.base ?? 'https://datos.gob.ar';
  const http = new Http(4, o, { accept: 'application/json' });
  const pageSize = o.pageSize ?? 1000, maxPages = o.maxPages ?? 50;

  return {
    id: 'ar-energia',
    schedule: 'monthly',
    rateLimit: { perSecond: 4 },
    async *fetch(since: Date): AsyncIterable<FeedRecord> {
      const from = ym(since);
      for (const res of o.resources ?? AR_RESOURCES) {
        const rows: any[] = [];
        for (let page = 0; page < maxPages; page++) {
          const j = await http.json<{ success?: boolean; result?: { records?: any[] } }>(
            `${base}/api/3/action/datastore_search?resource_id=${q(res.id)}&limit=${pageSize}&offset=${page * pageSize}&sort=${q(`${res.date_field} desc`)}`);
          if (j.success === false) throw new Error(`CKAN refused resource ${res.id}`);
          const records = j.result?.records ?? [];
          rows.push(...records);
          const oldest = toMonth(records.at(-1)?.[res.date_field]);
          if (records.length < pageSize || (oldest && oldest < from)) break;
        }
        const clean = rows.map(({ _id, ...r }) => r);
        for (const [month, monthRows] of groupByMonth(clean, r => toMonth(r[res.date_field]), since)) {
          yield snapshotRecord({ dataset: `ar-energia:${res.id}`, label: res.label, period: month, url: `${base}/api/3/action/datastore_search?resource_id=${res.id}`, rows: monthRows, meta: { resource: res.id } });
        }
      }
    },
  };
}

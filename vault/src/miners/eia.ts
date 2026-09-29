/**
 * EIA Open Data API v2 (M11). A configured list of series routes (for example
 * petroleum/crd/crpdn) is read newest-first from `start`, then grouped by month
 * into feed-snapshots. EIA_API_KEY is required (free registration).
 */
import type { FeedAdapter, FeedRecord } from './types.ts';
import { Http, groupByMonth, q, snapshotRecord, toMonth, ym, type AdapterOptions } from './util.ts';

export interface EiaSeries { id: string; label: string; route: string; frequency?: 'monthly' | 'weekly' | 'daily' | 'annual'; facets?: Record<string, string[]> }
export interface EiaOptions extends AdapterOptions { apiKey?: string; base?: string; series?: EiaSeries[]; pageSize?: number; maxPages?: number }

export const EIA_SERIES: EiaSeries[] = [
  { id: 'us-crude-production', label: 'EIA US crude oil production by area', route: 'petroleum/crd/crpdn', frequency: 'monthly' },
  { id: 'wti-spot', label: 'EIA WTI spot price', route: 'petroleum/pri/spt', frequency: 'monthly', facets: { series: ['RWTC'] } },
];

const monthOf = (r: any) => toMonth(r.period) ?? (/^\d{4}$/.test(String(r.period)) ? `${r.period}-01` : null);

export function createEiaAdapter(o: EiaOptions = {}): FeedAdapter {
  const base = o.base ?? 'https://api.eia.gov';
  const http = new Http(5, o, { accept: 'application/json' });
  const pageSize = o.pageSize ?? 5000, maxPages = o.maxPages ?? 10;

  return {
    id: 'eia',
    schedule: 'weekly',
    rateLimit: { perSecond: 5 },
    async *fetch(since: Date): AsyncIterable<FeedRecord> {
      const apiKey = o.apiKey ?? process.env.EIA_API_KEY;
      if (!apiKey) throw new Error('EIA_API_KEY is not set');
      for (const s of o.series ?? EIA_SERIES) {
        const facets = Object.entries(s.facets ?? {}).flatMap(([k, vs]) => vs.map(v => `&facets[${k}][]=${q(v)}`)).join('');
        const rows: any[] = [];
        for (let page = 0; page < maxPages; page++) {
          const j = await http.json<{ response?: { data?: any[]; total?: string | number } }>(
            `${base}/v2/${s.route}/data/?api_key=${q(apiKey)}&frequency=${s.frequency ?? 'monthly'}&data[0]=value${facets}&start=${ym(since)}&sort[0][column]=period&sort[0][direction]=desc&offset=${page * pageSize}&length=${pageSize}`);
          const data = j.response?.data ?? [];
          rows.push(...data);
          if (data.length < pageSize) break;
        }
        for (const [month, monthRows] of groupByMonth(rows, monthOf, since)) {
          yield snapshotRecord({ dataset: `eia:${s.id}`, label: s.label, period: month, url: `${base}/v2/${s.route}/data/`, rows: monthRows, meta: { route: s.route } });
        }
      }
    },
  };
}

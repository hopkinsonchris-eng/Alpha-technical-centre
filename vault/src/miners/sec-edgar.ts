/**
 * SEC EDGAR XBRL company facts (M11). For each configured issuer
 * (master/topics.json, sec_issuers) fetch data.sec.gov/api/xbrl/companyfacts and
 * keep the us-gaap oil and gas reserves concepts (proved developed, undeveloped
 * and total reserves, standardized measure). One feed-snapshot per issuer whose
 * original is the extracted fact list. data.sec.gov requires a descriptive
 * User-Agent with a contact address (SEC_USER_AGENT) and allows 10 req/s.
 */
import type { FeedAdapter, FeedRecord } from './types.ts';
import { Http, HttpError, snapshotBytes, ymd, ym, type AdapterOptions } from './util.ts';

export interface SecIssuer { cik: string; name: string }
export interface SecOptions extends AdapterOptions { issuers?: SecIssuer[]; base?: string; userAgent?: string }

export const RESERVES_CONCEPT = /^(Proved(Developed|Undeveloped|DevelopedAndUndeveloped)?Reserves|StandardizedMeasureOfDiscountedFutureNetCashFlows?\w*Proved)/;

export interface ReserveFact { concept: string; label: string; unit: string; val: number; start?: string; end: string; fy?: number; fp?: string; form?: string; filed: string; accn?: string }

export function extractReserves(companyFacts: any): ReserveFact[] {
  const out: ReserveFact[] = [];
  const gaap = companyFacts?.facts?.['us-gaap'] ?? {};
  for (const [concept, body] of Object.entries<any>(gaap)) {
    if (!RESERVES_CONCEPT.test(concept)) continue;
    for (const [unit, entries] of Object.entries<any[]>(body.units ?? {})) {
      for (const e of entries) {
        if (typeof e.val !== 'number' || !e.end || !e.filed) continue;
        out.push({ concept, label: body.label ?? concept, unit, val: e.val, start: e.start, end: e.end, fy: e.fy, fp: e.fp, form: e.form, filed: e.filed, accn: e.accn });
      }
    }
  }
  return out.sort((a, b) => a.concept.localeCompare(b.concept) || a.end.localeCompare(b.end) || (a.accn ?? '').localeCompare(b.accn ?? ''));
}

export function createSecEdgarAdapter(o: SecOptions = {}): FeedAdapter {
  const base = o.base ?? 'https://data.sec.gov';
  const ua = o.userAgent ?? process.env.SEC_USER_AGENT ?? 'Alpha Technical Centre chris@alpha-technical-centre.com';
  const http = new Http(5, o, { 'user-agent': ua, accept: 'application/json' });

  return {
    id: 'sec-edgar',
    schedule: 'weekly',
    rateLimit: { perSecond: 5 },
    async *fetch(since: Date): AsyncIterable<FeedRecord> {
      for (const issuer of o.issuers ?? []) {
        const cik = issuer.cik.replace(/\D/g, '').padStart(10, '0');
        const url = `${base}/api/xbrl/companyfacts/CIK${cik}.json`;
        let facts: any;
        try { facts = await http.json(url); }
        catch (e) { if (e instanceof HttpError && e.status === 404) { o.onWarn?.(`sec-edgar CIK${cik} (${issuer.name}) has no company facts`); continue; } throw e; }
        const reserves = extractReserves(facts);
        if (!reserves.length) { o.onWarn?.(`sec-edgar ${issuer.name}: no us-gaap reserves facts`); continue; }
        const latest = reserves.reduce((m, f) => (f.filed > m ? f.filed : m), '');
        if (latest < ymd(since)) continue; // nothing filed in the window
        yield {
          external_id: `sec-edgar:CIK${cik}:reserves`,
          url,
          title: `${facts.entityName ?? issuer.name}: SEC proved reserves facts (XBRL)`,
          authored_at: `${latest}T00:00:00.000Z`,
          authors: [],
          text: `${facts.entityName ?? issuer.name} (CIK ${cik}): ${reserves.length} us-gaap reserves facts, latest filed ${latest}.`,
          file: snapshotBytes(reserves),
          mime: 'application/json',
          meta: { dataset: `sec-edgar:CIK${cik}`, cik, entity: facts.entityName ?? issuer.name, rows: reserves.length, latest_filed: latest, concepts: [...new Set(reserves.map(r => r.concept))], period: ym(new Date(latest)) },
        };
      }
    },
  };
}

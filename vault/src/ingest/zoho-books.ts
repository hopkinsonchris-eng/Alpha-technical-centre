/**
 * Zoho Books sync (M09, D11 = a): invoices, purchase orders and expenses, by modified time. Each record
 * becomes an Item (type invoice / purchase-order / expense, origin zoho-books) whose original is the
 * PDF Books renders (an expense's receipt, or the record as JSON when it has none) and whose
 * structured record lives in `extracted.zoho_books`, with the headline facts flattened next to it
 * (reference, amount, currency, issue_date, due_date, paid_status, parties). Ingest never overwrites those.
 *
 * Env: ZOHO_BOOKS_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _ORG_ID, optionally _ACCOUNTS_URL
 * (default https://accounts.zoho.com) and _API_URL (default https://www.zohoapis.com/books/v3).
 * Books items land in the project named by master/workdrive-map.json "books" (customer → project, else
 * project_id, else ZOHO_BOOKS_PROJECT_ID, else the internal "firm" project). All HTTP goes through the injected fetch.
 */
import type { Db } from '../db/client.ts';
import type { ItemSink } from './items-client.ts';
import { loadWorkdriveMap, type BooksMap, type SyncStats } from './workdrive.ts';
import { oauthFromEnv, ZohoAuth } from './zoho-auth.ts';

export type BooksKind = 'invoice' | 'purchase-order' | 'expense';

interface KindSpec { path: string; list: string; one: string; id: string; number: string; party: string; partyId: string; date: string; due?: string; label: string }
const KINDS: Record<BooksKind, KindSpec> = {
  invoice: { path: 'invoices', list: 'invoices', one: 'invoice', id: 'invoice_id', number: 'invoice_number', party: 'customer_name', partyId: 'customer_id', date: 'date', due: 'due_date', label: 'Invoice' },
  'purchase-order': { path: 'purchaseorders', list: 'purchaseorders', one: 'purchaseorder', id: 'purchaseorder_id', number: 'purchaseorder_number', party: 'vendor_name', partyId: 'vendor_id', date: 'date', due: 'delivery_date', label: 'Purchase order' },
  expense: { path: 'expenses', list: 'expenses', one: 'expense', id: 'expense_id', number: 'reference_number', party: 'vendor_name', partyId: 'vendor_id', date: 'date', label: 'Expense' },
};
export const BOOKS_KINDS = Object.keys(KINDS) as BooksKind[];

export interface BooksConfig { auth: ZohoAuth; apiUrl: string; orgId: string }
export function booksConfig(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): BooksConfig | null {
  const oauth = oauthFromEnv('ZOHO_BOOKS', env);
  if (!oauth || !env.ZOHO_BOOKS_ORG_ID) return null;
  return { auth: new ZohoAuth(oauth, fetchImpl), apiUrl: (env.ZOHO_BOOKS_API_URL ?? 'https://www.zohoapis.com/books/v3').replace(/\/$/, ''), orgId: env.ZOHO_BOOKS_ORG_ID };
}

export interface BooksOptions {
  fetchImpl?: typeof fetch; config?: BooksConfig | null; kinds?: BooksKind[]; map?: BooksMap;
  /** Override where a record is filed. */
  projectFor?: (kind: BooksKind, record: any) => string;
  now?: () => Date;
}

const paidStatus = (kind: BooksKind, status: string | undefined): 'paid' | 'unpaid' | 'partial' | undefined => {
  const s = (status ?? '').toLowerCase();
  if (kind === 'invoice') return s === 'paid' ? 'paid' : s === 'partially_paid' ? 'partial' : ['sent', 'overdue', 'unpaid', 'viewed', 'draft'].includes(s) ? 'unpaid' : undefined;
  if (kind === 'expense') return s === 'reimbursed' ? 'paid' : undefined;
  return undefined;
};

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'record';

async function getJson(cfg: BooksConfig, fetchImpl: typeof fetch, url: string): Promise<any> {
  const res = await fetchImpl(url, { headers: await cfg.auth.headers({ accept: 'application/json' }) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || (j.code !== undefined && j.code !== 0)) throw new Error(`books ${url.split('?')[0].replace(cfg.apiUrl, '')} failed (${res.status}${j.message ? `: ${j.message}` : ''})`);
  return j;
}

async function getPdf(cfg: BooksConfig, fetchImpl: typeof fetch, url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const res = await fetchImpl(url, { headers: await cfg.auth.headers({ accept: 'application/pdf' }) });
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.length ? { bytes, mime: res.headers.get('content-type')?.split(';')[0] || 'application/pdf' } : null;
}

export async function syncBooks(db: Db, sink: ItemSink, opts: BooksOptions = {}): Promise<SyncStats & { by_kind: Record<string, { created: number; versioned: number; unchanged: number }> }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cfg = opts.config === undefined ? booksConfig(process.env, fetchImpl) : opts.config;
  const stats: SyncStats & { by_kind: Record<string, { created: number; versioned: number; unchanged: number }> } =
    { listed: 0, created: 0, versioned: 0, unchanged: 0, skipped: 0, failed: 0, errors: [], items: [], by_kind: {} };
  if (!cfg) { stats.errors.push('ZOHO_BOOKS_* is not configured'); return stats; }
  const books: BooksMap = opts.map ?? (() => { try { return loadWorkdriveMap().books ?? {}; } catch { return {}; } })();
  const projectFor = opts.projectFor ?? ((_k: BooksKind, r: any) => books.customer_projects?.[r.customer_name ?? r.vendor_name ?? ''] ?? books.project_id ?? process.env.ZOHO_BOOKS_PROJECT_ID ?? 'firm');
  const startedAt = (opts.now?.() ?? new Date()).toISOString();

  for (const kind of opts.kinds ?? BOOKS_KINDS) {
    const spec = KINDS[kind];
    const kstats = stats.by_kind[kind] = { created: 0, versioned: 0, unchanged: 0 };
    const cursorKey = `zoho-books:${kind}`;
    const cursor = (await db.query<{ value: any }>('SELECT value FROM settings WHERE key = $1', [cursorKey])).rows[0]?.value?.last_modified_time as string | undefined;
    const records: any[] = [];
    try {
      for (let page = 1; ; page++) {
        const q = new URLSearchParams({ organization_id: cfg.orgId, sort_column: 'last_modified_time', sort_order: 'A', per_page: '200', page: String(page) });
        if (cursor) q.set('last_modified_time', cursor);
        const j = await getJson(cfg, fetchImpl, `${cfg.apiUrl}/${spec.path}?${q}`);
        records.push(...(j[spec.list] ?? []));
        if (!j.page_context?.has_more_page) break;
      }
    } catch (e) { stats.failed++; stats.errors.push((e as Error).message); continue; }
    records.sort((a, b) => String(a.last_modified_time ?? '').localeCompare(String(b.last_modified_time ?? '')));
    stats.listed += records.length;
    let newest = cursor, blocked = false; // the cursor never moves past a record that failed, so the next run retries it

    for (const rec of records) {
      const id = String(rec[spec.id]);
      const modified = String(rec.last_modified_time ?? '');
      try {
        const projectId = projectFor(kind, rec);
        const externalId = `${kind}:${id}`;
        const known = (await db.query<{ id: string; extracted: any }>(
          `SELECT id, extracted FROM items WHERE origin->>'source' = 'zoho-books' AND external_id = $1 AND project_id = $2`, [externalId, projectId])).rows[0];
        if (known && modified && String(known.extracted?.zoho_books?.last_modified_time ?? '') >= modified) { stats.unchanged++; kstats.unchanged++; if (!blocked) newest = maxTime(newest, modified); continue; }

        const detail = (await getJson(cfg, fetchImpl, `${cfg.apiUrl}/${spec.path}/${encodeURIComponent(id)}?organization_id=${encodeURIComponent(cfg.orgId)}`))[spec.one] ?? rec;
        const number = String(detail[spec.number] ?? rec[spec.number] ?? id);
        const party = String(detail[spec.party] ?? rec[spec.party] ?? '') || null;
        const pdfUrl = kind === 'expense' ? `${cfg.apiUrl}/expenses/${encodeURIComponent(id)}/receipt?organization_id=${encodeURIComponent(cfg.orgId)}`
          : `${cfg.apiUrl}/${spec.path}/${encodeURIComponent(id)}?organization_id=${encodeURIComponent(cfg.orgId)}&accept=pdf`;
        const pdf = await getPdf(cfg, fetchImpl, pdfUrl);
        const filename = pdf ? `${safeName(`${kind}-${number}`)}.${/pdf/.test(pdf.mime) ? 'pdf' : pdf.mime.startsWith('image/') ? pdf.mime.slice(6) : 'bin'}` : `${safeName(`${kind}-${number}`)}.json`;
        const bytes = pdf?.bytes ?? new TextEncoder().encode(JSON.stringify(detail, null, 2));
        const status = String(detail.status ?? rec.status ?? '');
        const total = Number(detail.total ?? rec.total);
        const orgRow = party ? (await db.query<{ id: string }>('SELECT id FROM organisations WHERE lower(name) = lower($1) LIMIT 1', [party])).rows[0] : undefined;
        const paid = paidStatus(kind, status);
        const structured = {
          kind, id, number, party, party_id: detail[spec.partyId] ?? rec[spec.partyId] ?? null, date: detail[spec.date] ?? rec[spec.date] ?? null,
          due_date: spec.due ? (detail[spec.due] ?? rec[spec.due] ?? null) : null, total: Number.isFinite(total) ? total : null,
          currency: detail.currency_code ?? rec.currency_code ?? null, status, balance: detail.balance ?? rec.balance ?? null,
          last_modified_time: modified || null, record: detail,
        };
        const meta: Record<string, unknown> = {
          type: kind, title: `${spec.label} ${number}${party ? `, ${party}` : ''}`, project_id: projectId, authored_at: structured.date ? new Date(`${structured.date}T00:00:00Z`).toISOString() : null,
          origin: { source: 'zoho-books', external_id: externalId, fetched_at: startedAt }, filing: { method: 'tool', confidence: 1, confirmed_by: null },
          ...(orgRow ? { organisation_ids: [orgRow.id] } : {}),
          extracted: {
            filename, partners_only: true, zoho_books: structured, reference: number, ...(party ? { parties: [party] } : {}),
            ...(structured.total !== null ? { amount: structured.total } : {}), ...(structured.currency ? { currency: structured.currency } : {}),
            ...(structured.date ? { issue_date: structured.date } : {}), ...(structured.due_date ? { due_date: structured.due_date } : {}), ...(paid ? { paid_status: paid } : {}),
          },
        };
        const r = await sink({ meta, bytes, mime: pdf?.mime ?? 'application/json', filename });
        if (r.deduplicated) {
          stats.unchanged++; kstats.unchanged++;
          if (known) await db.query(`UPDATE items SET extracted = extracted || jsonb_build_object('zoho_books', coalesce(extracted->'zoho_books', '{}'::jsonb) || $2::jsonb) WHERE id = $1`, [known.id, JSON.stringify({ last_modified_time: modified })]);
        } else {
          if (r.version === 1) { stats.created++; kstats.created++; } else { stats.versioned++; kstats.versioned++; }
          stats.items.push({ id: r.id, version: r.version });
        }
        if (!blocked) newest = maxTime(newest, modified);
      } catch (e) { blocked = true; stats.failed++; stats.errors.push(`${kind} ${id}: ${(e as Error).message}`); }
    }
    if (newest && newest !== cursor) {
      await db.query(`INSERT INTO settings (key, value, updated_by) VALUES ($1, $2::jsonb, 'ingest-sync') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = 'ingest-sync', updated_at = now()`,
        [cursorKey, JSON.stringify({ last_modified_time: newest })]);
    }
  }
  return stats;
}

const maxTime = (a: string | undefined, b: string) => (!b ? a : !a || b > a ? b : a);

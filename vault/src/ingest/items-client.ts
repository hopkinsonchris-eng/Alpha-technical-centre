/**
 * The one way M09 creates Items: POST /api/items, in process. Uploads, WorkDrive and Zoho Books all go
 * through the same handler as an external client, so hashing, dedupe, versioning, legal-tag resolution and
 * scope checks live in one place (src/api/items.routes.ts) and are not duplicated here.
 */
import type { Db } from '../db/client.ts';

export interface NewItem {
  /** VaultItem metadata: type, title, project_id, origin, and optionally legal_tag, authored_at, extracted, filing, organisation_ids. */
  meta: Record<string, unknown>;
  bytes: Uint8Array;
  mime: string;
  filename: string;
}
export interface SinkResult { id: string; version: number; deduplicated: boolean }
export type ItemSink = (n: NewItem) => Promise<SinkResult>;
export interface Requester { request(input: string, init?: RequestInit): Response | Promise<Response> }

export class ItemSinkError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** A sink that POSTs multipart to /api/items on `app`, carrying `headers` (the caller's Access token) so the caller's scope applies. */
export function appSink(app: Requester, headers: HeadersInit = {}): ItemSink {
  return async ({ meta, bytes, mime, filename }) => {
    const fd = new FormData();
    fd.append('item', JSON.stringify(meta));
    fd.append('original', new Blob([bytes as BlobPart], { type: mime || 'application/octet-stream' }), filename);
    const res = await app.request('/api/items', { method: 'POST', body: fd, headers });
    const body: any = await res.json().catch(() => ({}));
    if (res.status !== 200 && res.status !== 201) throw new ItemSinkError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? `POST /api/items failed (${res.status})`);
    return { id: body.id, version: body.version, deduplicated: !!body.deduplicated };
  };
}

/** Sync jobs have no browser session: they act as the service account (INGEST_SERVICE_EMAIL, default info@…). */
export async function serviceSink(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<ItemSink> {
  const { createApp } = await import('../app.ts'); // late import: app.ts mounts the routes that import this module
  const domain = env.ALLOWED_EMAIL_DOMAIN ?? 'alpha-technical-centre.com';
  const app = await createApp({ db, auth: { allowedEmailDomain: domain, devUserEmail: env.INGEST_SERVICE_EMAIL ?? `info@${domain}` } });
  return appSink(app);
}

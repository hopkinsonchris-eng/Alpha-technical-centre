// Shared seeding for the wave 7 PR5 country pack tests (docs/vault-hub/wave7/05-markup.md §4, AC18 to AC20).
// Originals are seeded directly as items (project 'firm', lt-public, extracted.kind 'country-source') because the
// fetch (builder J) is built in parallel; the drafter reads only what is stored, so this is the same input it gets live.
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.VAULT_STORAGE_DIR ??= mkdtempSync(path.join(os.tmpdir(), 'vault-pack-'));
delete process.env.CF_ACCESS_TEAM_DOMAIN;
delete process.env.WORLD_MONITOR_API_KEY;
process.env.NODE_ENV = 'test';

import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import type { SectionId } from '../src/country/types.ts';

export const DOMAIN = 'alpha-technical-centre.com';
export const hashOf = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex');

/** People, the firm project, the public and firm tags; nothing else. */
export async function baseDb(): Promise<Db> {
  const db = await openDb(undefined); await migrate(db);
  await db.query(`INSERT INTO people (id,email,name,role) VALUES ('chris','chris@${DOMAIN}','Chris','partner'),('ana','ana@${DOMAIN}','Ana','associate')`);
  await db.query("INSERT INTO legal_tags (id,classification,data_type,originator) VALUES ('lt-public','public','public','public'),('lt-firm','firm','first-party','ATC')");
  await db.query("INSERT INTO projects (id,name,default_legal_tag) VALUES ('firm','Firm','lt-firm')");
  return db;
}

export interface SeededOriginal { id: string; url: string; source_id: string; sha256: string; text: string; fetched_at: string }

/** One stored original for a section: an immutable item under project 'firm', lt-public, the way the fetch files it. */
export async function seedOriginal(db: Db, o: { country: string; section: SectionId; source_id: string; url: string; text: string; title?: string; fetched_at?: string; version?: number }): Promise<SeededOriginal> {
  const id = randomUUID();
  const fetched_at = o.fetched_at ?? '2026-10-01T06:00:00Z';
  const sha = createHash('sha256').update(o.text).digest('hex');
  await db.query(
    `INSERT INTO items (id, type, title, created_at, authored_at, authors, project_id, legal_tag, origin, external_id, mime, content_hash, version, filing, extracted, tags)
     VALUES ($1,'feed-snapshot',$2,$3,$3,'{}','firm','lt-public',$4::jsonb,$5,'text/html',$6,$7,'{"method":"tool"}'::jsonb,$8::jsonb,$9::text[])`,
    [id, o.title ?? `${o.source_id} (${o.country})`, fetched_at, JSON.stringify({ source: 'country-pack', external_id: o.url, url: o.url, fetched_at }), o.url, `sha256:${sha}`, o.version ?? 1,
     JSON.stringify({ kind: 'country-source', pack: { country: o.country, section: o.section, source_id: o.source_id }, text: o.text, manifest: { url: o.url, fetched_at, sha256: sha } }), [`pack:${o.country}`, `section:${o.section}`]]);
  return { id, url: o.url, source_id: o.source_id, sha256: sha, text: o.text, fetched_at };
}

/** The registry-shaped source entry the job hands the drafter for a stored original. */
export const sourceOf = (o: SeededOriginal, extra: Partial<{ licence: string; attribution: string; note: string }> = {}) =>
  ({ id: o.source_id, url: o.url, licence: extra.licence ?? 'public', attribution: extra.attribution ?? `${o.source_id} (public)`, fetched_at: o.fetched_at, item_id: o.id, sha256: o.sha256, reachable: true, ...(extra.note ? { note: extra.note } : {}) });

/** A source whose fetch failed: no item, not reachable. */
export const unreachable = (source_id: string, url: string) => ({ id: source_id, url, licence: 'public', attribution: `${source_id} (public)`, fetched_at: null, item_id: null, sha256: null, reachable: false, note: 'unreachable since 2026-10-01' });

/** A client project under an NDA tag, with one confidential document, so a test can assert it never reaches a pack prompt. */
export async function seedClient(db: Db, country: string, projectId = 'p-client', status: 'active' | 'prospect' | 'archived' | 'closed' = 'active'): Promise<{ ndaItem: string }> {
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ($1,'Client Co','client',$2) ON CONFLICT DO NOTHING", [`org-${projectId}`, country]);
  await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ($1,'client-nda','second-party',$2,'Client Co') ON CONFLICT DO NOTHING", [`lt-${projectId}-nda`, `org-${projectId}`]);
  await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag,members,country,status) VALUES ($1,$2,$3,$4,'{chris,ana}',$5,$6)", [projectId, `org-${projectId}`, `${projectId} farm-in`, `lt-${projectId}-nda`, country, status]);
  const ndaItem = randomUUID();
  await db.query(
    `INSERT INTO items (id, type, title, created_at, authors, client_id, project_id, legal_tag, origin, content_hash, version, extracted)
     VALUES ($1,'report','CLIENT SECRET reserves report',now(),'{chris}',$2,$3,$4,'{"source":"upload"}'::jsonb,$5,1,$6::jsonb)`,
    [ndaItem, `org-${projectId}`, projectId, `lt-${projectId}-nda`, hashOf(ndaItem), JSON.stringify({ kind: 'report', text: 'CLIENT SECRET: 2P reserves 123.4 MMbbl at Block Z.' })]);
  return { ndaItem };
}

/** The ten section ids in order, for tests that build a whole pack. */
export const TEN: SectionId[] = ['legal', 'licensing', 'fiscal', 'companies', 'service', 'regulator', 'production', 'risk', 'literature', 'questions'];

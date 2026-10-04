/**
 * What the firm keeps of a connected mailbox (wave 6, D61, P54, P58). A person may lower their privacy level
 * at any time and the change is retroactive (Affinity): Subjects only strips bodies and attachments, Nothing hides
 * the messages; Disconnect hides every message only that mailbox saw. Rule 9 holds throughout: items are hidden,
 * never deleted; only the original bytes are purged, and only when no other item shares them.
 */
import type { Db } from '../../db/client.ts';
import type { Storage } from '../../storage.ts';

export type Privacy = 'all' | 'subjects' | 'none';
export const PRIVACY_LEVELS: Privacy[] = ['all', 'subjects', 'none'];

export interface PrivacyResult { messages: number; attachments: number; hidden: number; originals_purged: number; chunks_removed: number }

/** Message items captured from this mailbox (top level), and their attachment children. */
async function itemsOfMailbox(db: Db, address: string, onlyThisMailbox: boolean): Promise<{ messages: string[]; children: string[] }> {
  const messages = (await db.query<{ id: string }>(
    `SELECT id FROM items WHERE parent_id IS NULL AND origin->>'source' = 'zoho-mail' AND lower(extracted->>'mailbox') = lower($1)
       ${onlyThisMailbox ? `AND coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(extracted->'seen_by') = 'array' THEN extracted->'seen_by' ELSE '[]'::jsonb END), 0) <= 1` : ''}`, [address])).rows.map(r => r.id);
  const children = messages.length ? (await db.query<{ id: string }>('SELECT id FROM items WHERE parent_id = ANY($1::uuid[])', [messages])).rows.map(r => r.id) : [];
  return { messages, children };
}

/** Remove the original bytes of these items unless another item still points at the same content-addressed key. */
async function purgeOriginals(db: Db, storage: Storage | null, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = (await db.query<{ id: string; storage_key: string | null }>('SELECT id, storage_key FROM items WHERE id = ANY($1::uuid[]) AND storage_key IS NOT NULL', [ids])).rows;
  let n = 0;
  for (const r of rows) {
    const shared = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM items WHERE storage_key = $1 AND id <> ALL($2::uuid[])', [r.storage_key, ids])).rows[0].n;
    if (shared > 0) continue;
    if (storage) await storage.delete(r.storage_key!);
    await db.query("UPDATE items SET extracted = jsonb_set(extracted, '{ingest}', coalesce(extracted->'ingest', '{}'::jsonb) || '{\"status\":\"no_original\"}'::jsonb) WHERE id = $1", [r.id]);
    n++;
  }
  return n;
}

async function removeChunks(db: Db, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const before = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM chunks WHERE item_id = ANY($1::uuid[])', [ids])).rows[0].n;
  await db.query('DELETE FROM chunks WHERE item_id = ANY($1::uuid[])', [ids]);
  await db.query("UPDATE items SET extracted = extracted - 'text' - 'chunks' - 'text_chars' WHERE id = ANY($1::uuid[])", [ids]);
  return before;
}

async function hide(db: Db, ids: string[], reason: string): Promise<number> {
  if (!ids.length) return 0;
  await db.query(`UPDATE items SET hidden = true, extracted = extracted || jsonb_build_object('hidden_reason', $2::text) WHERE id = ANY($1::uuid[]) AND NOT hidden`, [ids, reason]);
  await db.query(`UPDATE filing_queue SET status = 'dismissed', resolved_by = 'privacy', resolved_at = now() WHERE item_id = ANY($1::uuid[]) AND status = 'open'`, [ids]);
  return ids.length;
}

/** Apply a privacy level to everything already captured from the mailbox. 'all' is not retroactive: nothing comes back by itself. */
export async function applyPrivacy(db: Db, storage: Storage | null, address: string, level: Privacy): Promise<PrivacyResult> {
  const { messages, children } = await itemsOfMailbox(db, address, false);
  const out: PrivacyResult = { messages: messages.length, attachments: children.length, hidden: 0, originals_purged: 0, chunks_removed: 0 };
  if (level === 'all' || !messages.length) return out;
  const all = [...messages, ...children];
  out.chunks_removed = await removeChunks(db, all);
  out.originals_purged = await purgeOriginals(db, storage, all);
  if (level === 'subjects') {
    out.hidden = await hide(db, children, 'privacy:subjects');
    await db.query(`UPDATE items SET extracted = extracted || '{"privacy":"subjects"}'::jsonb WHERE id = ANY($1::uuid[])`, [messages]);
  } else {
    out.hidden = await hide(db, all, 'privacy:none');
    await db.query(`UPDATE items SET extracted = extracted || '{"privacy":"none"}'::jsonb WHERE id = ANY($1::uuid[])`, [messages]);
  }
  return out;
}

/** Disconnect: hide every message only this mailbox saw (another person's copy stays theirs), purge the originals. Contacts and organisations stay. */
export async function withdrawMailbox(db: Db, storage: Storage | null, address: string): Promise<PrivacyResult> {
  const { messages, children } = await itemsOfMailbox(db, address, true);
  const all = [...messages, ...children];
  const out: PrivacyResult = { messages: messages.length, attachments: children.length, hidden: 0, originals_purged: 0, chunks_removed: 0 };
  if (!all.length) return out;
  out.chunks_removed = await removeChunks(db, all);
  out.originals_purged = await purgeOriginals(db, storage, all);
  out.hidden = await hide(db, all, 'disconnected');
  return out;
}

/** What the mailbox holds, for the Settings card. */
export async function mailboxCounts(db: Db, address: string): Promise<{ messages: number; filed: number; waiting: number; hidden_internal: number; hidden_bulk: number }> {
  const r = (await db.query<any>(
    `SELECT count(*) FILTER (WHERE NOT hidden)::int AS messages,
            count(*) FILTER (WHERE NOT hidden AND project_id <> 'firm')::int AS filed,
            count(*) FILTER (WHERE NOT hidden AND EXISTS (SELECT 1 FROM filing_queue q WHERE q.item_id = i.id AND q.status = 'open'))::int AS waiting,
            count(*) FILTER (WHERE hidden AND extracted->>'hidden_reason' = 'protected')::int AS hidden_internal,
            count(*) FILTER (WHERE hidden AND extracted->>'category' = 'bulk')::int AS hidden_bulk
       FROM items i WHERE parent_id IS NULL AND origin->>'source' = 'zoho-mail' AND lower(extracted->>'mailbox') = lower($1)`, [address])).rows[0];
  return { messages: r.messages, filed: r.filed, waiting: r.waiting, hidden_internal: r.hidden_internal, hidden_bulk: r.hidden_bulk };
}

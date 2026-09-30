/**
 * Audit log (M02). Every handler that touches the vault writes exactly one
 * append-only audit_events row (the table refuses UPDATE and DELETE).
 */
import type { Db } from './db/client.ts';

/**
 * Append one audit event.
 * @param personId  Person id of the caller (or a service name such as 'mail-capture')
 * @param action    dotted verb, e.g. 'run.create', 'item.read'
 * @param scope     scope string the request ran under (project:<id> | client:<id> | firm | public), or null
 * @param refs      records touched, as typed refs (run:<uuid>, doc:<uuid>, org:<id>, ...)
 * @param detail    small free-form JSON (status, counts, filters); never record content
 */
export async function audit(db: Db, personId: string, action: string, scope: string | null, refs: string[] = [], detail: Record<string, unknown> = {}): Promise<void> {
  await db.query(
    'INSERT INTO audit_events (person_id, action, scope, refs, detail) VALUES ($1,$2,$3,$4::text[],$5::jsonb)',
    [personId, action, scope, refs, JSON.stringify(detail)],
  );
}

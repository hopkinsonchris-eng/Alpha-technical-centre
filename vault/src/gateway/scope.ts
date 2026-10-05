/**
 * Retrieval scope (M12, Tier A). The single door through which any model or
 * page reads chunks. `buildPredicate` produces SQL terms that are applied
 * INSIDE the query (never as a post-filter), so a chunk outside the caller's
 * scope can never be ranked, let alone returned.
 *
 * Scope grammar: project:<id> | client:<id> | firm | public.
 *   public          → public chunks only
 *   firm            → public + every firm-tagged chunk in the Vault
 *   client:<id>     → public + firm-tagged chunks of that client's projects and of
 *                     the firm's internal project + that client's client-nda chunks
 *   project:<id>    → public + firm-tagged chunks of that project and of the firm's
 *                     internal project + the client's client-nda chunks, restricted
 *                     for associates to projects they are members of
 * Always: current chunks only, unexpired tags only, partners-only chunks only
 * for partners, multi-client (conflict) tags never.
 *
 * Wave 7 (S18, S30): a firm-tagged record filed in one client's project is firm
 * knowledge in firm scope, but it is not another client's context. Project and
 * client scope therefore admit firm-tagged chunks by project, not firm-wide; the
 * firm's own project (lessons, reference sets, papers) stays visible everywhere.
 */
import type { Person } from '../auth.ts';

export interface ResolvedScope { kind: 'public' | 'firm' | 'client' | 'project'; client_id?: string; project_id?: string; label: string }
export interface ProjectInfo { id: string; client_id: string | null; members: string[] }
export interface Predicate { sql: string; params: unknown[] }

/** The firm's internal project: firm-wide records (lessons, reference sets, papers) live here and are context for every project. */
export const FIRM_PROJECT = 'firm';

export class ScopeError extends Error { constructor(public status: 400 | 403, msg: string) { super(msg); } }

export function resolveScope(raw: string | undefined, person: Person, projects: Map<string, ProjectInfo>): ResolvedScope {
  if (!raw) throw new ScopeError(400, 'scope is required: project:<id> | client:<id> | firm | public');
  const [kind, id] = raw.split(':', 2);
  switch (kind) {
    case 'public': return { kind: 'public', label: 'public' };
    case 'firm': return { kind: 'firm', label: 'firm' };
    case 'client': {
      if (!id) throw new ScopeError(400, 'scope client:<id> needs an id');
      if (person.role !== 'partner') {
        const ok = [...projects.values()].some(p => p.client_id === id && p.members.includes(person.id));
        if (!ok) throw new ScopeError(403, `not a member of any project for client ${id}`);
      }
      return { kind: 'client', client_id: id, label: `client:${id}` };
    }
    case 'project': {
      if (!id) throw new ScopeError(400, 'scope project:<id> needs an id');
      const p = projects.get(id);
      if (!p) throw new ScopeError(403, `project ${id} is not visible`);
      if (person.role !== 'partner' && !p.members.includes(person.id)) throw new ScopeError(403, `not a member of project ${id}`);
      return { kind: 'project', project_id: id, client_id: p.client_id ?? undefined, label: `project:${id}` };
    }
    default: throw new ScopeError(400, `unknown scope kind "${kind}"`);
  }
}

/**
 * SQL terms over chunks `c` joined to legal_tags `lt` (c.legal_tag = lt.id).
 * `start` is the index of the first positional parameter.
 */
export function buildPredicate(scope: ResolvedScope, person: Person, now: Date, projects: Map<string, ProjectInfo>, start = 1): Predicate {
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${start + params.length - 1}`; };
  const terms: string[] = ['c.current', `(c.expires_at IS NULL OR c.expires_at >= ${p(now.toISOString().slice(0, 10))}::date)`, `(lt.expires_at IS NULL OR lt.expires_at >= ${p(now.toISOString().slice(0, 10))}::date)`, "lt.client_id IS NULL OR lt.client_id NOT LIKE '%+%'"];
  if (person.role !== 'partner') terms.push('NOT c.partners_only', 'NOT lt.partners_only');
  const isPublic = "lt.classification = 'public'";
  const isFirm = "lt.classification = 'firm'";
  switch (scope.kind) {
    case 'public': terms.push(isPublic); break;
    case 'firm': terms.push(`(${isPublic} OR ${isFirm})`); break;
    case 'client':
    case 'project': {
      const cid = scope.client_id;
      // Firm-tagged chunks: this project's (or this client's projects') plus the firm's own, never another project's.
      const own = scope.kind === 'project' ? [scope.project_id!] : [...projects.values()].filter(x => x.client_id === cid).map(x => x.id);
      const firmHere = `(${isFirm} AND c.project_id = ANY(${p([...new Set([FIRM_PROJECT, ...own])])}::text[]))`;
      if (!cid) { terms.push(`(${isPublic} OR ${firmHere})`); break; }
      let nda = `(lt.classification = 'client-nda' AND lt.client_id = ${p(cid)} AND c.client_id = ${p(cid)})`;
      if (person.role !== 'partner') {
        const mine = [...projects.values()].filter(x => x.client_id === cid && x.members.includes(person.id)).map(x => x.id);
        nda = `(${nda} AND c.project_id = ANY(${p(mine)}::text[]))`;
      }
      terms.push(`(${isPublic} OR ${firmHere} OR ${nda})`);
      break;
    }
  }
  return { sql: terms.map(t => `(${t})`).join(' AND '), params };
}

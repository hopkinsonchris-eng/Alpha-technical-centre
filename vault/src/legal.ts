/**
 * Legal tags and scope (M00).
 *
 * A legal tag is the confidentiality and contract envelope on every vault
 * record. Two rules are enforced here and nowhere else:
 *   1. unionTags: a derived record's tag is the union of its parents' tags —
 *      the most restrictive classification wins, the earliest expiry wins,
 *      and partners-only is sticky.
 *   2. isVisible: nothing is visible outside its scope or past its expiry.
 */

export type Classification = 'public' | 'firm' | 'client-nda';
export type DataType = 'public' | 'first-party' | 'second-party' | 'third-party' | 'transferred';

export interface LegalTag {
  id: string;
  classification: Classification;
  data_type: DataType;
  client_id?: string | null;
  contract_id?: string | null;
  country_of_origin?: string[];
  originator: string;
  expires_at?: string | null; // YYYY-MM-DD
  personal_data?: boolean;
  export_restricted?: boolean;
  partners_only?: boolean;
  notes?: string;
}

export interface Scope {
  project_id?: string;
  client_id?: string;
  include_firm: boolean;
  include_public: boolean;
  /** Set when the caller is a partner; partners_only records are hidden otherwise. */
  is_partner?: boolean;
}

const RANK: Record<Classification, number> = { public: 0, firm: 1, 'client-nda': 2 };
const DATA_RANK: Record<DataType, number> = {
  public: 0, 'first-party': 1, transferred: 2, 'second-party': 3, 'third-party': 4,
};

export function mostRestrictive(a: Classification, b: Classification): Classification {
  return RANK[a] >= RANK[b] ? a : b;
}

function minDate(a?: string | null, b?: string | null): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a <= b ? a : b;
}

/**
 * Union of tags. Commutative, associative, idempotent.
 * Throws on an empty list: a derived record must have at least one parent tag.
 */
export function unionTags(tags: LegalTag[]): LegalTag {
  if (!tags.length) throw new Error('unionTags: at least one tag is required');
  const sorted = [...tags].sort((x, y) => x.id.localeCompare(y.id));
  let classification: Classification = 'public';
  let dataType: DataType = 'public';
  let expires: string | null = null;
  const clients = new Set<string>();
  const contracts = new Set<string>();
  const countries = new Set<string>();
  const originators = new Set<string>();
  let personal = false, exportRestricted = false, partnersOnly = false;
  for (const t of sorted) {
    classification = mostRestrictive(classification, t.classification);
    if (DATA_RANK[t.data_type] > DATA_RANK[dataType]) dataType = t.data_type;
    expires = minDate(expires, t.expires_at ?? null);
    if (t.client_id) clients.add(t.client_id);
    if (t.contract_id) contracts.add(t.contract_id);
    for (const c of t.country_of_origin ?? []) countries.add(c);
    originators.add(t.originator);
    personal ||= !!t.personal_data;
    exportRestricted ||= !!t.export_restricted;
    partnersOnly ||= !!t.partners_only;
  }
  const clientList = [...clients].sort();
  const conflict = clientList.length > 1;
  const idParts = sorted.map(t => t.id.replace(/^lt-/, ''));
  const id = sorted.length === 1 ? sorted[0].id : `lt-union-${dedupe(idParts).join('+')}`.slice(0, 64);
  const tag: LegalTag = {
    id,
    classification,
    data_type: dataType,
    client_id: conflict ? clientList.join('+') : (clientList[0] ?? null),
    contract_id: contracts.size ? [...contracts].sort().join('+') : null,
    country_of_origin: [...countries].sort(),
    originator: [...originators].sort().join('+'),
    expires_at: expires,
    personal_data: personal,
    export_restricted: exportRestricted,
    partners_only: partnersOnly,
  };
  if (conflict) {
    tag.classification = 'client-nda';
    tag.notes = `conflict: derived from records of more than one client (${clientList.join(', ')})`;
  }
  return tag;
}

function dedupe(xs: string[]): string[] { return [...new Set(xs)]; }

export function isExpired(tag: LegalTag, now: Date): boolean {
  if (!tag.expires_at) return false;
  const today = now.toISOString().slice(0, 10);
  return tag.expires_at < today;
}

/**
 * Visibility of a record carrying `tag` inside `scope` at `now`.
 * A project scope means: that client's NDA records, plus firm and public when
 * the scope includes them. Multi-client (conflict) tags are visible in no
 * single-client scope.
 */
export function isVisible(tag: LegalTag, scope: Scope, now: Date): boolean {
  if (isExpired(tag, now)) return false;
  if (tag.partners_only && !scope.is_partner) return false;
  switch (tag.classification) {
    case 'public':
      return scope.include_public || scope.include_firm || !!scope.client_id || !!scope.project_id;
    case 'firm':
      return scope.include_firm || !!scope.client_id || !!scope.project_id;
    case 'client-nda': {
      if (!tag.client_id) return false;
      if (tag.client_id.includes('+')) return false; // conflict tag: no single scope may see it
      return !!scope.client_id && scope.client_id === tag.client_id;
    }
  }
}

/** Scope grammar used by the API: project:<id> | client:<id> | firm | public. */
export function parseScope(s: string, resolveProjectClient: (projectId: string) => string | undefined): Scope {
  const [kind, id] = s.split(':', 2);
  switch (kind) {
    case 'public': return { include_public: true, include_firm: false };
    case 'firm': return { include_public: true, include_firm: true };
    case 'client':
      if (!id) throw new Error('scope client:<id> requires an id');
      return { include_public: true, include_firm: true, client_id: id };
    case 'project': {
      if (!id) throw new Error('scope project:<id> requires an id');
      const client = resolveProjectClient(id);
      return { include_public: true, include_firm: true, project_id: id, client_id: client };
    }
    default: throw new Error(`unknown scope kind "${kind}"`);
  }
}

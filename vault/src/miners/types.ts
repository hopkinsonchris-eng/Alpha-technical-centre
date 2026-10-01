/**
 * M11 feed adapter contract (Tier C, fixed). Every adapter is one file in this
 * directory, takes an injectable `fetch` and clock so tests never touch the
 * network, and yields FeedRecords. The orchestrator (run.ts) turns records into
 * Vault Items; adapters never write to the Vault themselves.
 */
export interface TopicSpec {
  id: string;
  /** Search string handed to the literature APIs. */
  query: string;
  /** A record with text must mention at least one of these to be kept. */
  keywords: string[];
  /** A record mentioning any of these (title or text) is dropped. */
  negative: string[];
  /** Wave 4 research topics: a record is kept only when a keyword appears as a whole phrase in the title or text
   *  (abstract or not) and, when `context` is given, one of those words appears too. Firm topics leave this unset. */
  strict?: boolean;
  context?: string[];
}

export interface FeedRecord {
  /** Stable id within the source (paper id, DOI, `<adapter>:<dataset>:<period>`). A change of payload under the same id becomes a new item version. */
  external_id: string;
  url: string;
  title: string;
  /** ISO 8601 date-time of the original publication or data period, or null when unknown. */
  authored_at: string | null;
  authors: string[];
  /** Abstract (papers) or a one-line description (snapshots). */
  text?: string;
  /** Raw fetched payload for snapshots (JSON, CSV zip, XLSX). Stored as the immutable original. */
  file?: Buffer;
  mime?: string;
  /** Adapter-specific facts. Well-known keys: doi, topic_id, rows, venue. */
  meta: Record<string, unknown>;
}

export interface FeedAdapter {
  id: string;                                   // 'semantic-scholar' | 'crossref' | 'openalex' | 'anh-co' | 'anp-br' | 'ar-energia' | 'perupetro' | 'sec-edgar' | 'eia'
  schedule: 'weekly' | 'monthly';
  fetch(since: Date, topics: TopicSpec[]): AsyncIterable<FeedRecord>;   // FeedRecord = {external_id, url, title, authored_at, authors, text?, file?: Buffer, mime?, meta}
  rateLimit: { perSecond: number };
}

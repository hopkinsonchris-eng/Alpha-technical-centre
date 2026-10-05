/**
 * The licence-round watch (wave 7 PR6; docs/vault-hub/wave7/05-markup.md §1.9, 04-step-changes.md P2, practice P63).
 * Contracts shared by the Vault builder and the Hub builder: the stages, the proposal the queue shows, the
 * confirmed event the Hub lists, and the API shapes. Nothing here touches the network or the database.
 */

export const STAGES = [
  { id: 'announced',     en: 'Round announced',          es: 'Ronda anunciada' },
  { id: 'data_package',  en: 'Data package available',   es: 'Paquete de datos disponible' },
  { id: 'qualification', en: 'Qualification',            es: 'Calificación' },
  { id: 'bids_open',     en: 'Bids open',                es: 'Apertura de ofertas' },
  { id: 'bid_deadline',  en: 'Bid deadline',             es: 'Plazo de ofertas' },
  { id: 'award',         en: 'Award',                    es: 'Adjudicación' },
  { id: 'signature',     en: 'Signature',                es: 'Firma' },
  { id: 'other',         en: 'Other dated step',         es: 'Otro paso con fecha' },
] as const;
export type StageId = typeof STAGES[number]['id'];
export const STAGE_IDS: StageId[] = STAGES.map(s => s.id);

/** What the extraction proposes from one changed page: a dated stage with the sentence that states it. */
export interface RoundProposal {
  country: string;
  round: string;
  stage: StageId;
  event_date: string | null;     // YYYY-MM-DD when the page gives one
  title: string;
  quote: string;                 // verbatim from the fetched text; the proposal is refused when it is not found in the text
  source_item: string | null;    // the stored original's item id
  source_url: string;
  read_at: string;               // ISO
}

/** A row of round_events as the API returns it. */
export interface RoundEvent extends RoundProposal {
  id: string;
  status: 'proposed' | 'confirmed' | 'dismissed' | 'superseded';
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  /** Days from `now` to event_date; negative when past; null without a date. */
  days: number | null;
}

/** `GET /api/rounds?country=&status=&within=` */
export interface RoundsView {
  countries: { country: string; name: string; open: boolean; events: RoundEvent[] }[];
  deadlines: RoundEvent[];       // confirmed events with a date within `within` days (default 90), soonest first, for the countries asked
  proposed: number;              // proposals waiting in the queue
}

/** The watch job's summary, one row in `jobs` named 'round-watch'. */
export interface RoundWatchSummary {
  pages: number; unchanged: number; changed: number; unreachable: { source_id: string; since: string }[];
  proposals: number; refused_quotes: number; spend_gbp: number;
}

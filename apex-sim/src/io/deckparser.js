// ===========================================================================
// apex-sim · io/deckparser
// ---------------------------------------------------------------------------
// ECLIPSE-style deck parser: tokenizes keyword sections (RUNSPEC/GRID/PROPS/REGIONS/SOLUTION/SCHEDULE), expands repeats (N*v), handles INCLUDE.
// ===========================================================================

/**
 * Parse an ECLIPSE .DATA deck into structured keyword tables.
 * @param {string} text @returns {{sections:object, keywords:object}}
 */
export function parseDeck(text) {
  // TODO: section-aware tokenizer; handle '/', comments '--', 'N*value' repeats,
  // INCLUDE, and the subset of keywords needed for the benchmarks.
  void text;
  return { sections: {}, keywords: {} };
}

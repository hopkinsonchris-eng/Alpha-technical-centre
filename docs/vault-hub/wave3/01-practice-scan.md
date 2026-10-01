# Wave 3 — Phase 1 Practice Scan: the field hierarchy, document contextualisation and live risk

Brief (Chris, 1 Oct 2026): a tap on a country should offer to create a project there; a project
should hold fields; a document uploaded to a project that names fields should make the system
propose adding them, find their locations, search for anything known about them and file it into
the project; the country brief should eventually draw on the World Monitor API.

## What exists today (verified in the repo)

- `assets` master table (basin / field / reservoir / well / block / country, with `parent_id`
  and `country`), seeded with 27 basins and 36 fields (Colombia-weighted) from `vault/master/`;
  `projects.asset_ids` exists. **Nothing in the Hub reads or writes either**, and ingest never
  links a document to an asset. The register tool holds country → opportunity only; it has no
  field level.
- Public-data miners (M11) exist for ANH Colombia, ANP Brazil, Argentina, Perupetro, EIA, SEC,
  Crossref, OpenAlex, Semantic Scholar: they run on a schedule by topic, not per field.
- The register's "World Monitor" events are a simulation with a banner saying so.

## The practices that matter

| # | Practice | Who does it | Why it is good | Cost here |
|---|---|---|---|---|
| P23 | **Master-data hierarchy as the spine: Country → Basin → Field → Well, created in that order, every record cites at least one.** | OSDU (Organisation → Field → Well → Wellbore), Petrel reference project | The hierarchy already exists in the Vault; making the Hub create and show it turns "project in Venezuela" into "project holding Barinas and Apure under the Barinas-Apure basin". https://aws.amazon.com/blogs/industries/osdu-data-platform-on-aws-ingestion-series-1-overview-of-data-types-for-osdutm-data-platform/ | Low: routes to create assets and attach them to projects; a Fields card on the project page; the globe shows field points. |
| P24 | **Contextualisation: a file is not "in" until it points at an asset. Entity matching proposes the links, a person confirms, and confirmations train the matcher.** | Cognite Data Fusion (entity matching, P&ID annotation) | This is exactly "upload a document that names fields, then ask whether to add them". Proposals, never silent writes, with a confidence and the quote that triggered them. https://docs.cognite.com/cdf/integration/concepts/contextualization | Medium: an extraction step on ingest (names of fields, blocks, basins, operators with the quoting sentence) → review-queue rows → one-tap accept per field. |
| P25 | **A public gazetteer of fields with coordinates, ownership, status and production, downloadable and citable.** | Global Energy Monitor, Global Oil & Gas Extraction Tracker (GOGET, March 2026 release, CC BY): unit name, country, coordinates, status, discovery/FID/start years, owners, reserves, production, wiki URL | Gives "find their locations" a real source for most producing fields worldwide, with a wiki page per field that is itself a starting dossier. https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/download-data/ | Low–medium: one import into `assets` (kind field, props from GOGET, `source_url` the wiki page) refreshed with each release; fuzzy name match per country. |
| P26 | **A second gazetteer for the long tail.** | GeoNames feature code L.OILF (free API), Wikidata Q211748 "oil field" via SPARQL | Fields GOGET lacks (small, old, onshore Latin American and African fields) are often in GeoNames or Wikidata with coordinates. https://www.geonames.org/export/codes.html · https://www.wikidata.org/wiki/Q211748 | Low: two lookups behind the same "locate this field" button; each hit shows its source and is confirmed by a person. |
| P27 | **Per-asset research on demand: when an asset is attached, run the public miners for that asset and file the results as items citing their source.** | Cognite contextualisation, the existing M11 miners, Elicit-style fact extraction (already in `paper-facts.ts`) | Turns "search for any information related to that field" into a job: regulator production rows (ANH, ANP…), papers naming the field, GEM wiki, filed into the project with provenance and legal tag `lt-public`. | Medium: a `research-asset` job that fans out to the miners with the field name and country; results land in the project timeline as public items. |
| P28 | **Live country and asset risk from a licensed feed with an API, cited like any other source.** | World Monitor (Pro licence; REST with OpenAPI 3.1, SDKs, MCP tools `get_country_risk`, `get_chokepoint_status`, `get_maritime_activity`) | Replaces the register's simulated events with real ones in the brief and on the globe's attention colours. https://www.worldmonitor.app/ | Low–medium once a key exists: an adapter in the Vault (server side, key never in the browser) feeding the brief's "Situation" and the register's risk events; needs the licence and the key from Chris. |
| P29 | **Create-from-the-map: tapping an empty place offers to create the thing that belongs there, pre-filled with what the map knows.** | Every GIS editing tool (ArcGIS, QGIS), Wood Mackenzie Lens discovery | "Do you want to create a project here" with country and coordinates already filled; later, "do you want to add the field under the cursor". https://www.woodmac.com/lens/upstream/ | Low: a prompt in the country panel and a tap-to-place step on the globe that fills lat/lon. |

## Not adopted

- Letting the model geolocate fields from its own memory: unverifiable; every coordinate must come from a gazetteer or a document and carry its source.
- Writing extracted fields straight into the project without a person's tap: Cognite's own lesson is that proposals with confirmation beat silent writes.

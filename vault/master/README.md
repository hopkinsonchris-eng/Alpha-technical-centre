# Master data

Stable ids every vault record hangs off (OSDU master-data pattern). Ids never
change; names may. Loaded into the `assets` and `people` tables on deploy.

- `basins.json`, `fields.json`: Latin America seed, hand-entered from regulator
  and operator public lists; each row carries `source_url`. Add rows by PR.
- `wells.json`: hand-entered exceptions only; the M11 ANH miner populates wells.
- `people.json`: partners and service accounts. Add the other three partners
  here with their signature blocks (names and emails to be supplied by Chris).
- `topics.json` (M11) and `workdrive-map.json` (M09) are added by those modules.

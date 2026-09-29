/** Four client projects with contacts, assets and legal tags, added to the AC15 seed (which brings a fifth, orinoco-partnership). */
import type { Db } from '../../../src/db/client.ts';

export const PROJECTS = ['llanos-waterflood', 'middle-magdalena', 'ecopetrol-fiscal-review', 'talara-brownfield'] as const;
export type ProjectId = typeof PROJECTS[number];

const ORGS = [
  { id: 'frontera-energy', name: 'Frontera Energy Corp.', domain: 'fronteraenergy.com' },
  { id: 'ecopetrol', name: 'Ecopetrol S.A.', domain: 'ecopetrol.com.co' },
  { id: 'costa-norte-petroleos', name: 'Costa Norte Petróleos S.A.C.', domain: 'costanortepetroleos.com.pe' },
];
const CONTACTS: Array<[string, string, string, string[]]> = [   // id, org, name, emails
  ['jorge-ruiz', 'frontera-energy', 'Jorge Ruiz', ['jruiz@fronteraenergy.com']],
  ['sofia-marin', 'frontera-energy', 'Sofía Marín', ['smarin@fronteraenergy.com']],
  ['camila-vargas', 'ecopetrol', 'Camila Vargas', ['cvargas@ecopetrol.com.co']],
  ['pablo-torres', 'ecopetrol', 'Pablo Torres', ['ptorres@ecopetrol.com.co']],
  ['laura-mendez', 'ecopetrol', 'Laura Méndez', ['lmendez@ecopetrol.com.co']],
  ['rosa-quispe', 'costa-norte-petroleos', 'Rosa Quispe', ['rquispe@costanortepetroleos.com.pe']],
  ['miguel-chavez', 'costa-norte-petroleos', 'Miguel Chávez', ['mchavez@costanortepetroleos.com.pe']],
];
const PROJECT_ROWS: Array<{ id: ProjectId; org: string; name: string; assets: string[]; contacts: string[] }> = [
  { id: 'llanos-waterflood', org: 'frontera-energy', name: 'Llanos Basin waterflood screening', assets: ['field:llanos:cubiro', 'field:llanos:castilla'], contacts: ['jorge-ruiz', 'sofia-marin'] },
  { id: 'middle-magdalena', org: 'ecopetrol', name: 'Middle Magdalena infill screening', assets: ['field:magdalena-media:la-cira-infantas', 'field:magdalena-media:casabe'], contacts: ['camila-vargas', 'pablo-torres'] },
  { id: 'ecopetrol-fiscal-review', org: 'ecopetrol', name: 'Ecopetrol fiscal terms and royalty review', assets: [], contacts: ['pablo-torres', 'laura-mendez'] },
  { id: 'talara-brownfield', org: 'costa-norte-petroleos', name: 'Talara brownfield redevelopment', assets: ['field:talara:lote-x'], contacts: ['rosa-quispe', 'miguel-chavez'] },
];

export async function seedMailProjects(db: Db): Promise<void> {
  for (const o of ORGS) await db.query(`INSERT INTO organisations (id, name, kind, identifiers) VALUES ($1,$2,'client',$3::jsonb) ON CONFLICT DO NOTHING`, [o.id, o.name, JSON.stringify({ domains: [o.domain] })]);
  for (const [id, org, name, emails] of CONTACTS) await db.query(`INSERT INTO contacts (id, organisation_id, name, emails) VALUES ($1,$2,$3,$4::text[]) ON CONFLICT DO NOTHING`, [id, org, name, emails]);
  for (const p of PROJECT_ROWS) {
    const tag = `lt-${p.org}-nda-2026`;
    await db.query(`INSERT INTO legal_tags (id, classification, data_type, client_id, originator, expires_at) VALUES ($1,'client-nda','second-party',$2,$3,'2028-12-31') ON CONFLICT DO NOTHING`, [tag, p.org, p.org]);
    await db.query(`INSERT INTO projects (id, client_id, name, status, default_legal_tag, asset_ids) VALUES ($1,$2,$3,'active',$4,$5::text[]) ON CONFLICT DO NOTHING`, [p.id, p.org, p.name, tag, p.assets]);
    for (const c of p.contacts) await db.query('INSERT INTO project_contacts (project_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.id, c]);
  }
}

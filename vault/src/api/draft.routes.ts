/**
 * Drafting, rendering and the scoped LLM proxy (M13).
 *   POST /api/draft    {kind, project_id, brief, organisation_id?, thread_id?, language?, run_id?} → DraftResult; saved as a note item citing its sources;
 *                      503 not_configured without a drafting provider (wave 7, S19), never a silent template
 *   POST /api/render   {draft_id | letter} → {html} or a DOCX/PDF download (?format=docx|pdf|html)
 *   POST /api/llm      {purpose, scope, messages[]} → {text, usage}; used by tools instead of browser keys; 501 without a provider
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, bad, jsonBody, loadAccess, notFound, route, scopeLabel, requireWritableProject, assertVisible } from './common.ts';
import { draft as runDraft, NoProviderError, type DraftKind, type DraftRequest } from '../llm/draft.ts';
import { openProvider, type LlmProvider } from '../llm/provider.ts';
import { letterDocx, letterHtml, htmlToPdf, type LetterInput } from '../render/letter.ts';
import type { SearchDeps } from '../gateway/search.ts';
import { resolveScope, ScopeError, type ProjectInfo } from '../gateway/scope.ts';

export interface DraftDeps { provider?: LlmProvider | null; search?: SearchDeps }
let deps: DraftDeps = {};
export function configureDraft(d: DraftDeps) { deps = { ...deps, ...d }; }
const provider = () => (deps.provider === undefined ? openProvider() : deps.provider);

const KINDS: DraftKind[] = ['email', 'letter', 'report-section', 'calc-note'];

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/draft', 'draft.create', async (x) => {
    const b = await jsonBody(x.c);
    if (!KINDS.includes(b.kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`, '/kind');
    if (typeof b.project_id !== 'string' || !b.project_id) throw bad('project_id is required', '/project_id');
    if (typeof b.brief !== 'string' || b.brief.trim().length < 8) throw bad('brief is required', '/brief');
    const req: DraftRequest = { kind: b.kind, project_id: b.project_id, brief: b.brief.trim(), organisation_id: b.organisation_id, thread_id: b.thread_id, language: b.language === 'es' ? 'es' : 'en', tone: typeof b.tone === 'string' ? b.tone.slice(0, 40) : undefined, previous: typeof b.previous === 'string' ? b.previous.slice(0, 12000) : undefined, run_id: b.run_id };
    const acc = await loadAccess(x.db, x.person, x.now);
    const project = requireWritableProject(acc, req.project_id);
    x.a.scope = scopeLabel(project.id);
    let result;
    try { result = await runDraft(x.db, x.person, req, provider(), deps.search ?? {}, x.now); }
    catch (e: any) {
      if (e instanceof ScopeError) throw new ApiError(e.status, e.status === 403 ? 'forbidden' : 'invalid', e.message);
      if (e instanceof NoProviderError) throw new ApiError(e.status, e.code, e.message);
      throw e;
    }
    // Save the draft as a note so it participates in staleness and the timeline.
    const id = randomUUID();
    const title = `${req.kind === 'letter' ? 'Letter draft' : req.kind === 'email' ? 'Email draft' : req.kind === 'calc-note' ? 'Calc note draft' : 'Report section draft'}: ${req.brief.slice(0, 80)}`;
    await x.db.query(`INSERT INTO items (id, type, title, created_at, authors, client_id, project_id, organisation_ids, legal_tag, origin, content_hash, version, extracted)
                      VALUES ($1,'note',$2,$3,$4::text[],$5,$6,$7::text[],$8,$9::jsonb,$10,1,$11::jsonb)`,
      [id, title, x.now.toISOString(), [x.person.id], project.client_id ?? null, project.id, req.organisation_id ? [req.organisation_id] : [], project.default_legal_tag,
       JSON.stringify({ source: 'assistant', external_id: `draft:${id}` }), 'sha256:' + Buffer.from(id.replace(/-/g, '').padEnd(64, '0')).toString('hex').slice(0, 64),
       JSON.stringify({ kind: 'draft', draft_kind: req.kind, brief: req.brief, language: req.language, tone: req.tone ?? null, organisation_id: req.organisation_id ?? null, draft: result.draft, paragraphs: result.paragraphs, citations: result.citations, sources: result.sources, warnings: result.warnings, questions: result.questions, who_to_ask: result.who_to_ask, model: result.model ?? null, explanation_source: 'llm' })]);
    for (const ref of result.citations) await x.db.query('INSERT INTO item_cites (item_id, ref) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, ref]);
    if (result.usage) await x.db.query("INSERT INTO audit_events (person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out) VALUES ($1,'llm.draft',$2,$3::text[],$4::jsonb,$5,$6,$7)",
      [x.person.id, x.a.scope, [`doc:${id}`], JSON.stringify({ model: result.model, kind: req.kind }), result.usage.input, result.usage.cached, result.usage.output]);
    x.a.refs = [`doc:${id}`, ...result.citations];
    x.a.detail = { kind: req.kind, citations: result.citations.length, questions: result.questions.length, provider: result.model ?? null };
    const { context, ...rest } = result;
    return { status: 201, body: { id, ...rest, context: { organisation: context.organisation ? { id: context.organisation.id, name: context.organisation.name } : null, contacts: context.contacts ?? [], dispatches: context.dispatches ?? [], contracts: (context.contracts ?? []).map(c => ({ id: c.id, type: c.type, title: c.title, expiry: c.extracted?.expiry ?? null })), runs: context.runs.map(r => ({ id: r.id, title: r.title, job: r.job, tool_version: r.tool_version, status: r.status, stale: r.stale, asset_ids: r.asset_ids ?? [], created_at: r.created_at, outputs: r.outputs ?? {}, newer_document: r.newer_document ?? null })), lessons: context.lessons, sub_queries: context.sub_queries, letterhead: context.letterhead ?? null } } };
  });

  route(app, 'POST', '/api/render', 'draft.render', async (x) => {
    const b = await jsonBody(x.c);
    const format = (x.c.req.query('format') ?? b.format ?? 'html') as 'html' | 'docx' | 'pdf';
    let input: LetterInput;
    if (b.draft_id) {
      const row = (await x.db.query<any>('SELECT id, project_id, legal_tag, extracted, organisation_ids FROM items WHERE id = $1 AND NOT hidden', [b.draft_id])).rows[0];
      if (!row || row.extracted?.kind !== 'draft') throw notFound(`draft ${b.draft_id} not found`);
      const acc = await loadAccess(x.db, x.person, x.now);
      assertVisible(acc, row.legal_tag, row.project_id, `draft ${b.draft_id}`);
      const ex = row.extracted;
      const orgId = ex.organisation_id ?? row.organisation_ids?.[0];
      const org = orgId ? (await x.db.query<any>('SELECT * FROM organisations WHERE id = $1', [orgId])).rows[0] : null;
      const contact = orgId ? (await x.db.query<any>('SELECT * FROM contacts WHERE organisation_id = $1 ORDER BY name LIMIT 1', [orgId])).rows[0] : null;
      const dispatches = orgId ? (await x.db.query<any>('SELECT d.direction, d.occurred_at, d.reference_no, d.their_reference, i.title FROM dispatches d JOIN items i ON i.id = d.item_id WHERE d.organisation_id = $1 ORDER BY d.occurred_at', [orgId])).rows : [];
      const signer = (await x.db.query<any>('SELECT name, signature_block FROM people WHERE id = $1', [x.person.id])).rows[0];
      let reference_no = ex.reference_no;
      if (!reference_no) {
        const y = x.now.getUTCFullYear();
        const r = await x.db.query<{ last_no: number }>('INSERT INTO reference_counters (year, last_no) VALUES ($1, 1) ON CONFLICT (year) DO UPDATE SET last_no = reference_counters.last_no + 1 RETURNING last_no', [y]);
        reference_no = `ATC-${y}-${String(r.rows[0].last_no).padStart(4, '0')}`;
        await x.db.query("UPDATE items SET extracted = jsonb_set(extracted, '{reference_no}', to_jsonb($2::text)), reference_no = $2 WHERE id = $1", [row.id, reference_no]);
      }
      input = { language: ex.language ?? 'en', reference_no, their_reference: b.their_reference ?? null, date: x.now, organisation: org ? { name: org.name, registered_address: org.registered_address } : { name: b.organisation_name ?? '—' },
        contact: contact ? { name: contact.name, role: contact.role, postal_address: contact.postal_address } : null, subject: b.subject ?? null, confidentiality_note: b.confidentiality_note ?? null,
        paragraphs: (ex.paragraphs as string[]).filter((p, i) => !/^\[QUESTION FOR YOU/.test(p) && ex.review?.decisions?.[i] !== 'drop'), signatory: { name: signer?.name ?? x.person.name, signature_block: signer?.signature_block ?? null },
        previous_correspondence: dispatches.map((d: any) => ({ date: (d.occurred_at instanceof Date ? d.occurred_at.toISOString() : String(d.occurred_at)).slice(0, 10), direction: d.direction, reference: d.reference_no ?? d.their_reference ?? null, subject: d.title })), keep_citations: !!b.keep_citations };
      x.a.refs = [`doc:${row.id}`]; x.a.scope = scopeLabel(row.project_id);
    } else if (b.letter) {
      input = { ...b.letter, date: b.letter.date ? new Date(b.letter.date) : x.now };
      x.a.scope = 'firm';
    } else throw bad('draft_id or letter is required', '/draft_id');
    x.a.detail = { format, reference_no: input.reference_no };
    const html = letterHtml(input);
    if (format === 'html') return { body: { html, reference_no: input.reference_no } };
    const bytes = format === 'docx' ? await letterDocx(input) : await htmlToPdf(html).catch((e: any) => { throw new ApiError(e.status ?? 500, e.code ?? 'error', e.message); });
    const type = format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
    return { body: new Response(new Uint8Array(bytes), { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${input.reference_no}.${format}"` } }) };
  });

  route(app, 'POST', '/api/llm', 'llm.proxy', async (x) => {
    const b = await jsonBody(x.c);
    const p = provider();
    if (!p) throw new ApiError(501, 'not_implemented', 'the Vault assistant is not connected (no LLM provider configured)');
    const projects = new Map<string, ProjectInfo>((await x.db.query<any>('SELECT id, client_id, members FROM projects')).rows.map(r => [r.id, { id: r.id, client_id: r.client_id, members: r.members ?? [] }]));
    let scope; try { scope = resolveScope(b.scope, x.person, projects); } catch (e: any) { if (e instanceof ScopeError) throw new ApiError(e.status, e.status === 403 ? 'forbidden' : 'invalid', e.message); throw e; }
    if (!Array.isArray(b.messages) || !b.messages.length) throw bad('messages[] is required', '/messages');
    const purpose = String(b.purpose ?? 'tool');
    const system = `You assist a partner of Alpha Technical Centre inside the tool "${purpose}". Scope: ${scope.label}. Answer only from the data the tool sent; say plainly when the data is insufficient. Never mention other clients. British English unless the user writes in Spanish.`;
    const r = await p.complete({ system, messages: b.messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') })), maxTokens: Math.min(Number(b.max_tokens ?? 800), 2000) });
    await x.db.query("INSERT INTO audit_events (person_id, action, scope, detail, tokens_in, tokens_cached, tokens_out) VALUES ($1,'llm.tool',$2,$3::jsonb,$4,$5,$6)", [x.person.id, scope.label, JSON.stringify({ purpose, model: r.model }), r.usage.input, r.usage.cached, r.usage.output]);
    x.a.scope = scope.label; x.a.detail = { purpose, model: r.model };
    return { body: { text: r.text, usage: r.usage, model: r.model } };
  });
}

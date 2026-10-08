/**
 * Ask this project (wave 8 PR 4, docs/vault-hub/wave8/03-indexing-and-ask.md, W8-AC17).
 *   POST /api/projects/:id/ask {question, language?}
 *   → { project_id, question, language, answer: [paragraph…], questions, citations, sources: [{ref, id, name, type, date, cited}],
 *       passages, warnings, usage, model }
 * The passages come through the gateway in the project's scope as the caller sees it; the reply passes the drafting
 * assistant's citation checker; one `project.ask` audit row carries the refs, and the model call lands in the cost
 * ledger (`llm.ask`) under the spend guard. 503 not_configured without a provider, 400 for an empty question,
 * 404 for a project outside the caller's scope. Read-only against the Vault: nothing is written to items.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, bad, canSee, jsonBody, loadAccess, notFound, route, scopeLabel, sha256Hex, type Access } from './common.ts';
import { openProvider, type LlmProvider } from '../llm/provider.ts';
import { searchDeps, ScopeError, type SearchDeps } from '../gateway/index.ts';
import { askProject } from '../llm/ask.ts';

export interface AskDeps { provider?: LlmProvider | null; search?: SearchDeps }
let deps: AskDeps = {};
/** Tests inject a FakeProvider and a search without an embedder; production reads the environment. */
export function configureAsk(d: AskDeps): void { deps = { ...deps, ...d }; }
const provider = () => (deps.provider === undefined ? openProvider() : deps.provider);
const search = () => (deps.search === undefined ? searchDeps() : deps.search);

const MAX_QUESTION = 2000;

function visibleProject(acc: Access, id: string) {
  const p = acc.projects.get(id);
  if (!p || !canSee(acc, p.default_legal_tag, p.id)) throw notFound(`project "${id}" not found`);
  return p;
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/projects/:id/ask', 'project.ask', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = visibleProject(acc, x.c.req.param('id')!);
    x.a.scope = scopeLabel(p.id); x.a.refs = [`project:${p.id}`];
    const b = await jsonBody(x.c);
    const question = typeof b?.question === 'string' ? b.question.trim() : '';
    if (!question) throw bad('question is required', '/question');
    if (question.length > MAX_QUESTION) throw bad(`question must be at most ${MAX_QUESTION} characters`, '/question');
    const language: 'en' | 'es' = b.language === 'es' ? 'es' : 'en';
    x.a.detail = { question_hash: 'sha256:' + sha256Hex(question.toLowerCase().replace(/\s+/g, ' ')), language };
    const prov = provider();
    if (!prov) throw new ApiError(503, 'not_configured', 'The drafting assistant is not connected. Ask Chris.');
    let r;
    try { r = await askProject({ db: x.db, person: x.person, project: { id: p.id, name: p.name }, question, language, provider: prov, search: search(), now: x.now }); }
    catch (e) { if (e instanceof ScopeError) throw new ApiError(e.status, e.status === 403 ? 'forbidden' : 'invalid', e.message); throw e; }
    if (r.usage) await x.db.query("INSERT INTO audit_events (person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out) VALUES ($1,'llm.ask',$2,$3::text[],$4::jsonb,$5,$6,$7)",
      [x.person.id, scopeLabel(p.id), [`project:${p.id}`, ...r.citations], JSON.stringify({ model: r.model ?? null, language, passages: r.passages }), r.usage.input, r.usage.cached, r.usage.output]);
    x.a.refs = [...x.a.refs, ...r.citations];
    x.a.detail = { ...x.a.detail, passages: r.passages, citations: r.citations.length, questions: r.questions.length, model: r.model ?? null };
    return { body: { project_id: p.id, question, language, ...r } };
  });
}

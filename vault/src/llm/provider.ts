/**
 * LLM provider interface (Tier A). Every model call in the vault goes through
 * here so that keys stay on the server, usage is recorded, and tests run with
 * a deterministic fake. M13 adds prompt caching and the drafting prompts.
 */
export interface LlmMessage { role: 'user' | 'assistant'; content: string }
export interface LlmUsage { input: number; cached: number; output: number }
export interface LlmResult { text: string; usage: LlmUsage; model: string; provider: string }
export interface LlmRequest { system: string; messages: LlmMessage[]; maxTokens?: number; temperature?: number; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
export interface LlmProvider { name: string; model: string; complete(req: LlmRequest): Promise<LlmResult>; search?(req: WebSearchRequest): Promise<WebSearchResult> }

/* ── wave 4: web search through the Messages API's server-side tool ─── */
export interface WebSearchRequest { system: string; prompt: string; maxUses: number; maxTokens?: number }
export interface WebCitation { url: string; title: string | null; cited_text: string; sentence: string }
export interface WebSearchHit { url: string; title: string | null; page_age: string | null }
export interface WebSearchResult { text: string; usage: LlmUsage; model: string; searches: number; citations: WebCitation[]; results: WebSearchHit[]; error?: string; /** the API's stop_reason, so a cut-off answer is named */ stop?: string }

/** Reads the search results, the cited sentences and the search count out of a Messages API response. */
export function readWebSearch(j: any, model: string): WebSearchResult {
  const citations: WebCitation[] = [], results: WebSearchHit[] = [];
  let text = '', error: string | undefined;
  for (const c of j?.content ?? []) {
    if (c?.type === 'text') {
      text += c.text ?? '';
      for (const ci of c.citations ?? []) if (ci?.type === 'web_search_result_location' && ci.url) citations.push({ url: String(ci.url), title: ci.title ? String(ci.title) : null, cited_text: String(ci.cited_text ?? ''), sentence: String(c.text ?? '').trim() });
    } else if (c?.type === 'web_search_tool_result') {
      if (Array.isArray(c.content)) {
        for (const r of c.content) if (r?.type === 'web_search_result' && r.url) results.push({ url: String(r.url), title: r.title ? String(r.title) : null, page_age: r.page_age ? String(r.page_age) : null });
      } else if (c.content?.type === 'web_search_tool_result_error') error = `web search error: ${c.content.error_code ?? 'unknown'}`;
    }
  }
  const u = j?.usage ?? {};
  return { text, usage: { input: u.input_tokens ?? 0, cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 }, model: j?.model ?? model, searches: Number(u.server_tool_use?.web_search_requests ?? 0), citations, results, ...(error ? { error } : {}), ...(j?.stop_reason ? { stop: String(j.stop_reason) } : {}) };
}

/** Deterministic provider for tests: echoes a compact summary of the last user message. */
export class FakeProvider implements LlmProvider {
  name = 'fake'; model = 'fake-1';
  constructor(private readonly reply?: (req: LlmRequest) => string, private readonly searchReply?: (req: WebSearchRequest) => Partial<WebSearchResult> | Error) {}
  async search(req: WebSearchRequest): Promise<WebSearchResult> {
    if (!this.searchReply) return { text: 'Nothing found.', usage: { input: 50, cached: 0, output: 5 }, model: this.model, searches: 1, citations: [], results: [] };
    const r = this.searchReply(req);
    if (r instanceof Error) throw r;
    return { text: '', usage: { input: 500, cached: 0, output: 120 }, model: this.model, searches: 1, citations: [], results: [], ...r };
  }
  async complete(req: LlmRequest): Promise<LlmResult> {
    const last = req.messages.at(-1)?.content ?? '';
    const text = this.reply ? this.reply(req) : `FAKE: ${last.slice(0, 200)}`;
    return { text, usage: { input: Math.ceil((req.system.length + last.length) / 4), cached: 0, output: Math.ceil(text.length / 4) }, model: this.model, provider: this.name };
  }
}

/** Anthropic Messages API, server-side only. */
export class AnthropicProvider implements LlmProvider {
  name = 'anthropic';
  constructor(private readonly apiKey: string, public readonly model = process.env.LLM_MODEL ?? 'claude-sonnet-5-5', private readonly fetchImpl: typeof fetch = fetch) {}
  async complete(req: LlmRequest): Promise<LlmResult> {
    const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      // No sampling parameters: the current models (Sonnet 5.5, Opus 5.5 and later) reject `temperature` with a 400.
      // Thinking is on by default on those models and its tokens count against max_tokens, so short extractive calls
      // run at low effort and longer drafting calls at medium; `effort` on the request overrides either.
      body: JSON.stringify({ model: this.model, max_tokens: req.maxTokens ?? 1024,
        output_config: { effort: req.effort ?? ((req.maxTokens ?? 1024) <= 500 ? 'low' : 'medium') },
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }], messages: req.messages }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j: any = await res.json();
    const text = (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    const u = j.usage ?? {};
    return { text, usage: { input: u.input_tokens ?? 0, cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0 }, model: j.model ?? this.model, provider: this.name };
  }

  /**
   * Wave 4: one search turn through the server-side web search tool (web_search_20260209, dynamic filtering).
   * The API cites what it found; `readWebSearch` keeps the citations and the search count. A `pause_turn` is
   * resumed once with the assistant content sent back unchanged. An organisation with web search switched off
   * answers 400: that is reported as an error on the source, not thrown as a crash of the run.
   */
  async search(req: WebSearchRequest): Promise<WebSearchResult> {
    const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: req.maxUses }];
    const messages: any[] = [{ role: 'user', content: req.prompt }];
    const body = (msgs: any[]) => JSON.stringify({ model: this.model, max_tokens: req.maxTokens ?? 4000, output_config: { effort: 'medium' }, system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }], messages: msgs, tools });
    const call = async (msgs: any[]) => {
      const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, body: body(msgs) });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return res.json() as Promise<any>;
    };
    let j = await call(messages);
    let out = readWebSearch(j, this.model);
    if (j?.stop_reason === 'pause_turn') {
      const j2 = await call([...messages, { role: 'assistant', content: j.content }]);
      const more = readWebSearch(j2, this.model);
      out = { ...more, text: out.text + more.text, usage: { input: out.usage.input + more.usage.input, cached: out.usage.cached + more.usage.cached, output: out.usage.output + more.usage.output }, searches: out.searches + more.searches, citations: [...out.citations, ...more.citations], results: [...out.results, ...more.results], ...(out.error && !more.error ? { error: out.error } : {}) };
    }
    return out;
  }
}

/** null means "no assistant configured": callers degrade (template text, 501). */
export function openProvider(env = process.env): LlmProvider | null {
  if (env.LLM_PROVIDER === 'fake') return new FakeProvider();
  if (env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY);
  return null;
}

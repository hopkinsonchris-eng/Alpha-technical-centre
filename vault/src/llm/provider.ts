/**
 * LLM provider interface (Tier A). Every model call in the vault goes through
 * here so that keys stay on the server, usage is recorded, and tests run with
 * a deterministic fake. M13 adds prompt caching and the drafting prompts.
 */
export interface LlmMessage { role: 'user' | 'assistant'; content: string }
export interface LlmUsage { input: number; cached: number; output: number }
export interface LlmResult { text: string; usage: LlmUsage; model: string; provider: string }
export interface LlmRequest { system: string; messages: LlmMessage[]; maxTokens?: number; temperature?: number; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
export interface LlmProvider { name: string; model: string; complete(req: LlmRequest): Promise<LlmResult> }

/** Deterministic provider for tests: echoes a compact summary of the last user message. */
export class FakeProvider implements LlmProvider {
  name = 'fake'; model = 'fake-1';
  constructor(private readonly reply?: (req: LlmRequest) => string) {}
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
}

/** null means "no assistant configured": callers degrade (template text, 501). */
export function openProvider(env = process.env): LlmProvider | null {
  if (env.LLM_PROVIDER === 'fake') return new FakeProvider();
  if (env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY);
  return null;
}

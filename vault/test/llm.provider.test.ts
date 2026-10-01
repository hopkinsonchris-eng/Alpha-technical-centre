// The Anthropic provider's request shape. The current models reject `temperature`
// (400 "temperature is deprecated for this model"), seen live on the country brief
// on 1 Oct 2026; thinking is on by default and counts against max_tokens, so the
// provider sends an effort level instead and reads only the text blocks back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider } from '../src/llm/provider.ts';

function fakeFetch(calls: any[]) {
  return (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({
      model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Hello ' }, { type: 'text', text: 'there.' }],
      usage: { input_tokens: 120, cache_read_input_tokens: 80, output_tokens: 9 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

test('no temperature is sent; effort follows the size of the call and can be overridden; only text blocks are read', async () => {
  const calls: any[] = [];
  const p = new AnthropicProvider('sk-test', 'claude-sonnet-5-5', fakeFetch(calls));
  const r = await p.complete({ system: 'S', messages: [{ role: 'user', content: 'U' }], maxTokens: 220, temperature: 0 });
  assert.equal(r.text, 'Hello there.');
  assert.deepEqual(r.usage, { input: 120, cached: 80, output: 9 });
  assert.equal(r.model, 'claude-sonnet-5-5');
  assert.ok(!('temperature' in calls[0]), 'temperature must not be sent');
  assert.equal(calls[0].max_tokens, 220);
  assert.deepEqual(calls[0].output_config, { effort: 'low' });
  assert.equal(calls[0].system[0].cache_control.type, 'ephemeral');

  await p.complete({ system: 'S', messages: [{ role: 'user', content: 'U' }], maxTokens: 1800 });
  assert.deepEqual(calls[1].output_config, { effort: 'medium' });
  await p.complete({ system: 'S', messages: [{ role: 'user', content: 'U' }], maxTokens: 1800, effort: 'high' });
  assert.deepEqual(calls[2].output_config, { effort: 'high' });
});

test('a non-2xx answer surfaces the status and the body', async () => {
  const bad = (async () => new Response('{"type":"error","error":{"type":"invalid_request_error","message":"nope"}}', { status: 400 })) as unknown as typeof fetch;
  const p = new AnthropicProvider('sk-test', 'claude-sonnet-5-5', bad);
  await assert.rejects(p.complete({ system: 'S', messages: [{ role: 'user', content: 'U' }] }), /anthropic 400: .*nope/);
});

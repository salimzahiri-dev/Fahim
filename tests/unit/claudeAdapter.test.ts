import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../providers/model/claudeAdapter';

describe('Claude adapter', () => {
  it('maps the neutral request to the wire format and back', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          content: [
            { type: 'thinking', thinking: 'ignored' },
            { type: 'text', text: 'Bonjour' },
            { type: 'tool_use', id: 'toolu_1', name: 'check_answer', input: { answer: '375' } },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 120, output_tokens: 30 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const adapter = new ClaudeAdapter({ apiKey: 'test-key', fetchImpl });
    const response = await adapter.respond({
      systemPrompt: 'system',
      model: 'some-model',
      maxTokens: 500,
      tools: [
        {
          name: 'check_answer',
          description: 'd',
          inputSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false },
        },
      ],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'salut' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_0', name: 'check_answer', input: { answer: '1' } }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'toolu_0', content: 'nope', isError: true }] },
      ],
    });

    expect(captured!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(captured!.init.body as string);
    expect(body.model).toBe('some-model');
    expect(body.system).toBe('system');
    expect(body.tools[0]).toEqual({
      name: 'check_answer',
      description: 'd',
      input_schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false },
    });
    expect(body.messages[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 'toolu_0', content: 'nope', is_error: true });

    expect(response.stopReason).toBe('tool_use');
    expect(response.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(response.content).toEqual([
      { type: 'text', text: 'Bonjour' },
      { type: 'tool_use', id: 'toolu_1', name: 'check_answer', input: { answer: '375' } },
    ]);
  });

  it('omits tools when none are offered and hides the response body on failure', async () => {
    let body: Record<string, unknown> = {};
    const okFetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ content: [], stop_reason: 'end_turn' }), { status: 200 });
    }) as unknown as typeof fetch;
    await new ClaudeAdapter({ apiKey: 'k', fetchImpl: okFetch }).respond({
      systemPrompt: 's', model: 'm', maxTokens: 10, tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }],
    });
    expect('tools' in body).toBe(false);

    const badFetch = (async () => new Response('secret detail', { status: 401 })) as unknown as typeof fetch;
    await expect(
      new ClaudeAdapter({ apiKey: 'k', fetchImpl: badFetch }).respond({ systemPrompt: 's', model: 'm', maxTokens: 10, tools: [], messages: [] }),
    ).rejects.toThrow('Model request failed with HTTP 401');
  });
});

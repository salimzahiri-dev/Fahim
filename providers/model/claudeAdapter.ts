import type {
  ContentBlock,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  TextBlock,
  ToolUseBlock,
} from './ModelProvider';

/**
 * Claude adapter. Talks to the Messages API over plain HTTPS so the project
 * carries no vendor SDK. This is the only file that knows the Claude wire format.
 */

export interface ClaudeAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

type WireBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

function toWire(block: ContentBlock): WireBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError ? { is_error: true } : {}),
      };
  }
}

function mapStopReason(reason: unknown): ModelResponse['stopReason'] {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'end';
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens') return 'max_tokens';
  return 'other';
}

export class ClaudeAdapter implements ModelProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClaudeAdapterOptions) {
    if (!options.apiKey) throw new Error('ClaudeAdapter: missing API key');
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async respond(request: ModelRequest): Promise<ModelResponse> {
    const body = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.systemPrompt,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content.map(toWire) })),
      ...(request.tools.length > 0
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }
        : {}),
    };

    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // The body may echo request content, so only the status goes in the error.
      throw new Error(`Model request failed with HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      content?: Array<Record<string, unknown>>;
      stop_reason?: unknown;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const content: Array<TextBlock | ToolUseBlock> = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
      // Other block types (for example thinking) are not part of the neutral contract.
    }

    return {
      content,
      stopReason: mapStopReason(data.stop_reason),
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
    };
  }
}

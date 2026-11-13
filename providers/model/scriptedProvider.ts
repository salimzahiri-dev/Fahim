import type { ModelProvider, ModelRequest, ModelResponse } from './ModelProvider';

/**
 * Deterministic provider for tests: replies come from a script, and every
 * request is recorded so tests can assert on what the model was shown.
 */
export type ScriptStep = ModelResponse | ((request: ModelRequest) => ModelResponse);

export class ScriptedProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];
  private readonly steps: ScriptStep[];

  constructor(steps: ScriptStep[]) {
    this.steps = [...steps];
  }

  async respond(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const step = this.steps.shift();
    if (!step) return say('(fin du script)');
    return typeof step === 'function' ? step(request) : step;
  }
}

export function say(text: string): ModelResponse {
  return { content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 } };
}

export function callTool(name: string, input: Record<string, unknown>, id = `tool_${name}`): ModelResponse {
  return {
    content: [{ type: 'tool_use', id, name, input }],
    stopReason: 'tool_use',
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

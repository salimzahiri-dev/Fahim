/**
 * Vendor-neutral contract between the session engine and any language model.
 * Business code (/core, /modules) imports only this file, never a vendor SDK,
 * so switching model vendor means writing one new adapter.
 */

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required: string[];
  additionalProperties: false;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ModelRequest {
  systemPrompt: string;
  messages: Message[];
  tools: ToolDefinition[];
  /** Read from configuration by the caller. */
  model: string;
  maxTokens: number;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResponse {
  content: Array<TextBlock | ToolUseBlock>;
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'other';
  usage: ModelUsage;
}

export interface ModelProvider {
  respond(request: ModelRequest): Promise<ModelResponse>;
}

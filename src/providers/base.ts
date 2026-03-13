/**
 * Base LLM provider interface
 */

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCallRequest[];
  finishReason: string;
  usage: Record<string, number>;
  /** Reasoning content (DeepSeek-R1, Kimi, etc.) */
  reasoningContent: string | null;
}

export function hasToolCalls(resp: LLMResponse): boolean {
  return resp.toolCalls.length > 0;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string | unknown;
  [key: string]: unknown;
}

export type ToolDefinition = Record<string, unknown>;

/** Abstract LLM provider interface */
export abstract class LLMProvider {
  protected apiKey: string | null;
  protected apiBase: string | null;

  constructor(apiKey?: string | null, apiBase?: string | null) {
    this.apiKey = apiKey ?? null;
    this.apiBase = apiBase ?? null;
  }

  abstract chat(
    messages: Message[],
    opts?: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<LLMResponse>;

  abstract getDefaultModel(): string;
}

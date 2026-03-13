/**
 * OpenAI-compatible LLM provider
 *
 * Uses the OpenAI SDK for all providers (most expose OpenAI-compatible APIs).
 * For direct Anthropic access without a gateway, uses the Anthropic Messages API.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { logger } from "../utils/logger";
import { LLMProvider, LLMResponse, Message, ToolCallRequest, ToolDefinition } from "./base";
import { findByModel, findGateway, ProviderSpec } from "./registry";

export class LiteLLMProvider extends LLMProvider {
  private defaultModel: string;
  private extraHeaders: Record<string, string>;
  private gateway: ProviderSpec | undefined;
  private providerName: string | undefined;
  private _client: OpenAI | null = null;

  constructor(opts: {
    apiKey?: string | null;
    apiBase?: string | null;
    defaultModel?: string;
    extraHeaders?: Record<string, string>;
    providerName?: string | null;
  }) {
    super(opts.apiKey, opts.apiBase);
    this.defaultModel = opts.defaultModel ?? "claude-opus-4-5";
    this.extraHeaders = opts.extraHeaders ?? {};
    this.providerName = opts.providerName ?? undefined;

    // Detect gateway / local deployment
    this.gateway = findGateway(this.providerName, opts.apiKey, opts.apiBase ?? undefined);

    // Set up env vars for compatibility
    if (opts.apiKey) {
      this._setupEnv(opts.apiKey, opts.apiBase ?? undefined);
    }
  }

  private _setupEnv(apiKey: string, apiBase?: string): void {
    const spec = this.gateway ?? findByModel(this.defaultModel);
    if (!spec) return;

    if (this.gateway) {
      process.env[spec.envKey] = apiKey;
    } else {
      process.env[spec.envKey] ??= apiKey;
    }

    const effectiveBase = apiBase ?? spec.defaultApiBase;
    for (const [envName, envVal] of spec.envExtras) {
      const resolved = envVal
        .replace("{api_key}", apiKey)
        .replace("{api_base}", effectiveBase);
      process.env[envName] ??= resolved;
    }
  }

  private _getClient(): OpenAI {
    if (this._client) return this._client;

    const baseURL = this._resolveBaseURL();
    const defaultHeaders: Record<string, string> = { ...this.extraHeaders };

    // Anthropic native mode: use the OpenAI-compatible endpoint via SDK
    // with the anthropic-version header
    if (this.providerName === "anthropic" && !baseURL) {
      this._client = new OpenAI({
        apiKey: this.apiKey ?? "placeholder",
        baseURL: "https://api.anthropic.com/v1",
        defaultHeaders: {
          "anthropic-version": "2023-06-01",
          "x-api-key": this.apiKey ?? "",
          ...defaultHeaders,
        },
      });
    } else {
      this._client = new OpenAI({
        apiKey: this.apiKey ?? process.env.OPENAI_API_KEY ?? "placeholder",
        baseURL: baseURL ?? undefined,
        defaultHeaders,
      });
    }

    return this._client;
  }

  private _resolveBaseURL(): string | null {
    if (this.apiBase) return this.apiBase;
    if (this.gateway?.defaultApiBase) return this.gateway.defaultApiBase;
    // Standard providers that need a specific base URL
    const spec = this.gateway ?? findByModel(this.defaultModel);
    if (spec?.defaultApiBase) return spec.defaultApiBase;
    return null;
  }

  private _resolveModel(model: string): string {
    if (this.gateway) {
      let m = model;
      if (this.gateway.stripModelPrefix) {
        m = m.split("/").at(-1) ?? m;
      }
      const prefix = this.gateway.litellmPrefix;
      if (prefix && !m.startsWith(`${prefix}/`)) {
        m = `${prefix}/${m}`;
      }
      return m;
    }

    const spec = findByModel(model);
    if (spec?.litellmPrefix) {
      if (!spec.skipPrefixes.some((p) => model.startsWith(p))) {
        return `${spec.litellmPrefix}/${model}`;
      }
    }

    return model;
  }

  private _applyModelOverrides(model: string, kwargs: Record<string, unknown>): void {
    const modelLower = model.toLowerCase();
    const spec = this.gateway ?? findByModel(model);
    if (!spec) return;
    for (const [pattern, overrides] of spec.modelOverrides) {
      if (modelLower.includes(pattern)) {
        Object.assign(kwargs, overrides);
        return;
      }
    }
  }

  async chat(
    messages: Message[],
    opts: {
      tools?: ToolDefinition[];
      model?: string;
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<LLMResponse> {
    const rawModel = opts.model ?? this.defaultModel;
    const resolvedModel = this._resolveModel(rawModel);

    const kwargs: Record<string, unknown> = {
      temperature: opts.temperature ?? 0.7,
    };
    this._applyModelOverrides(resolvedModel, kwargs);

    const client = this._getClient();

    try {
      // Newer OpenAI models (o-series, gpt-4.1, gpt-5+) require max_completion_tokens;
      // older models use max_tokens. Detect based on model name.
      const needsCompletionTokens =
        /^(o1|o1-|o2|o3|o3-|o4|o4-|gpt-4\.1|gpt-5)/i.test(resolvedModel);
      const tokenParam = needsCompletionTokens
        ? { max_completion_tokens: opts.maxTokens ?? 4096 }
        : { max_tokens: opts.maxTokens ?? 4096 };

      const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model: resolvedModel,
        messages: messages as ChatCompletionMessageParam[],
        ...tokenParam,
        temperature: needsCompletionTokens ? undefined : ((kwargs["temperature"] as number) ?? 0.7),
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;

      if (opts.tools && opts.tools.length > 0) {
        params.tools = opts.tools as unknown as ChatCompletionTool[];
        params.tool_choice = "auto";
      }

      const response = await client.chat.completions.create(params);
      return this._parseResponse(response);
    } catch (e) {
      logger.error({ err: e }, "LLM chat error");
      return {
        content: `Error calling LLM: ${String(e)}`,
        toolCalls: [],
        finishReason: "error",
        usage: {},
        reasoningContent: null,
      };
    }
  }

  private _parseResponse(response: OpenAI.Chat.ChatCompletion): LLMResponse {
    const choice = response.choices[0];
    const message = choice.message;

    const toolCalls: ToolCallRequest[] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let args: Record<string, unknown> = {};
        if (tc.function.arguments) {
          try {
            args = JSON.parse(tc.function.arguments);
          } catch {
            args = { raw: tc.function.arguments };
          }
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: args,
        });
      }
    }

    const usage: Record<string, number> = {};
    if (response.usage) {
      usage.promptTokens = response.usage.prompt_tokens;
      usage.completionTokens = response.usage.completion_tokens;
      usage.totalTokens = response.usage.total_tokens;
    }

    // Some providers return reasoning_content as a non-standard field
    const reasoningContent =
      (message as unknown as Record<string, unknown>)["reasoning_content"] as string | null ?? null;

    return {
      content: message.content,
      toolCalls,
      finishReason: choice.finish_reason ?? "stop",
      usage,
      reasoningContent,
    };
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }
}

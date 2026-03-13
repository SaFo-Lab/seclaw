/**
 * Provider Registry
 *
 * Single source of truth for LLM provider metadata.
 * Order matters — controls match priority and fallback. Gateways first.
 */

export interface ProviderSpec {
  /** Config field name, e.g. "dashscope" */
  name: string;
  /** Model-name keywords for matching (lowercase) */
  keywords: readonly string[];
  /** LiteLLM / OpenAI env var key */
  envKey: string;
  /** Shown in `seclaw status` */
  displayName: string;
  /** Prefix applied to model, e.g. "dashscope" → "dashscope/{model}" */
  litellmPrefix: string;
  /** Don't prefix if model already starts with these */
  skipPrefixes: readonly string[];
  /** Extra env vars as [envName, template] pairs */
  envExtras: readonly [string, string][];
  /** Routes any model (OpenRouter, AiHubMix) */
  isGateway: boolean;
  /** Local deployment (vLLM, Ollama) */
  isLocal: boolean;
  /** Match by api_key prefix, e.g. "sk-or-" */
  detectByKeyPrefix: string;
  /** Match substring in api_base URL */
  detectByBaseKeyword: string;
  /** Fallback base URL */
  defaultApiBase: string;
  /** Strip "provider/" before re-prefixing */
  stripModelPrefix: boolean;
  /** Per-model param overrides: [pattern, overrides][] */
  modelOverrides: readonly [string, Record<string, unknown>][];
}

function spec(s: ProviderSpec): ProviderSpec {
  return s;
}

// ---------------------------------------------------------------------------
// PROVIDERS — the registry. Order = priority. Gateways first.
// ---------------------------------------------------------------------------

export const PROVIDERS: readonly ProviderSpec[] = [
  // === Gateways ============================================================

  spec({
    name: "openrouter",
    keywords: ["openrouter"],
    envKey: "OPENROUTER_API_KEY",
    displayName: "OpenRouter",
    litellmPrefix: "openrouter",
    skipPrefixes: [],
    envExtras: [],
    isGateway: true,
    isLocal: false,
    detectByKeyPrefix: "sk-or-",
    detectByBaseKeyword: "openrouter",
    defaultApiBase: "https://openrouter.ai/api/v1",
    stripModelPrefix: false,
    modelOverrides: [],
  }),

  spec({
    name: "aihubmix",
    keywords: ["aihubmix"],
    envKey: "OPENAI_API_KEY",
    displayName: "AiHubMix",
    litellmPrefix: "openai",
    skipPrefixes: [],
    envExtras: [],
    isGateway: true,
    isLocal: false,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "aihubmix",
    defaultApiBase: "https://aihubmix.com/v1",
    stripModelPrefix: true,
    modelOverrides: [],
  }),

  // === Standard providers ==================================================

  spec({
    name: "anthropic",
    keywords: ["anthropic", "claude"],
    envKey: "ANTHROPIC_API_KEY",
    displayName: "Anthropic",
    litellmPrefix: "",
    skipPrefixes: [],
    envExtras: [],
    isGateway: false,
    isLocal: false,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "",
    defaultApiBase: "",
    stripModelPrefix: false,
    modelOverrides: [],
  }),

  spec({
    name: "openai",
    keywords: ["openai", "gpt"],
    envKey: "OPENAI_API_KEY",
    displayName: "OpenAI",
    litellmPrefix: "",
    skipPrefixes: [],
    envExtras: [],
    isGateway: false,
    isLocal: false,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "",
    defaultApiBase: "",
    stripModelPrefix: false,
    modelOverrides: [],
  }),

  spec({
    name: "deepseek",
    keywords: ["deepseek"],
    envKey: "DEEPSEEK_API_KEY",
    displayName: "DeepSeek",
    litellmPrefix: "deepseek",
    skipPrefixes: ["deepseek/"],
    envExtras: [],
    isGateway: false,
    isLocal: false,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "",
    defaultApiBase: "",
    stripModelPrefix: false,
    modelOverrides: [],
  }),

  spec({
    name: "gemini",
    keywords: ["gemini"],
    envKey: "GEMINI_API_KEY",
    displayName: "Gemini",
    litellmPrefix: "gemini",
    skipPrefixes: ["gemini/"],
    envExtras: [],
    isGateway: false,
    isLocal: false,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "",
    defaultApiBase: "",
    stripModelPrefix: false,
    modelOverrides: [],
  }),

  spec({
    name: "zhipu",
    keywords: ["zhipu", "glm", "zai"],
    envKey: "ZAI_API_KEY",
    displayName: "Zhipu AI",
    litellmPrefix: "zai",
    skipPrefixes: ["zhipu/", "zai/", "openrouter/", "hosted_vllm/"],
    envExtras: [["ZHIPUAI_API_KEY", "{api_key}"]],
    isGateway: false,
    isLocal: false,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "",
    defaultApiBase: "",
    stripModelPrefix: false,
    modelOverrides: [],
  }),

  spec({
    name: "dashscope",
    keywords: ["qwen", "dashscope"],
    envKey: "DASHSCOPE_API_KEY",
    displayName: "DashScope",
    litellmPrefix: "dashscope",
    skipPrefixes: ["dashscope/", "openrouter/"],
    envExtras: [],
    isGateway: false,
    isLocal: false,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "",
    defaultApiBase: "",
    stripModelPrefix: false,
    modelOverrides: [],
  }),

  spec({
    name: "moonshot",
    keywords: ["moonshot", "kimi"],
    envKey: "MOONSHOT_API_KEY",
    displayName: "Moonshot",
    litellmPrefix: "moonshot",
    skipPrefixes: ["moonshot/", "openrouter/"],
    envExtras: [["MOONSHOT_API_BASE", "{api_base}"]],
    isGateway: false,
    isLocal: false,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "",
    defaultApiBase: "https://api.moonshot.ai/v1",
    stripModelPrefix: false,
    modelOverrides: [["kimi-k2.5", { temperature: 1.0 }]],
  }),

  spec({
    name: "minimax",
    keywords: ["minimax"],
    envKey: "MINIMAX_API_KEY",
    displayName: "MiniMax",
    litellmPrefix: "minimax",
    skipPrefixes: ["minimax/", "openrouter/"],
    envExtras: [],
    isGateway: false,
    isLocal: false,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "",
    defaultApiBase: "https://api.minimax.io/v1",
    stripModelPrefix: false,
    modelOverrides: [],
  }),

  // === Local deployment ====================================================

  spec({
    name: "vllm",
    keywords: ["vllm"],
    envKey: "HOSTED_VLLM_API_KEY",
    displayName: "vLLM/Local",
    litellmPrefix: "hosted_vllm",
    skipPrefixes: [],
    envExtras: [],
    isGateway: false,
    isLocal: true,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "",
    defaultApiBase: "",
    stripModelPrefix: false,
    modelOverrides: [],
  }),

  // === Auxiliary ===========================================================

  spec({
    name: "groq",
    keywords: ["groq"],
    envKey: "GROQ_API_KEY",
    displayName: "Groq",
    litellmPrefix: "groq",
    skipPrefixes: ["groq/"],
    envExtras: [],
    isGateway: false,
    isLocal: false,
    detectByKeyPrefix: "",
    detectByBaseKeyword: "",
    defaultApiBase: "",
    stripModelPrefix: false,
    modelOverrides: [],
  }),
] as const;

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Match a standard provider by model-name keyword. Skips gateways/local. */
export function findByModel(model: string): ProviderSpec | undefined {
  const modelLower = model.toLowerCase();
  for (const s of PROVIDERS) {
    if (s.isGateway || s.isLocal) continue;
    if (s.keywords.some((kw) => modelLower.includes(kw))) return s;
  }
  return undefined;
}

/** Detect gateway/local provider. */
export function findGateway(
  providerName?: string | null,
  apiKey?: string | null,
  apiBase?: string | null
): ProviderSpec | undefined {
  // 1. Direct match by config key
  if (providerName) {
    const s = findByName(providerName);
    if (s && (s.isGateway || s.isLocal)) return s;
  }

  // 2. Auto-detect
  for (const s of PROVIDERS) {
    if (s.detectByKeyPrefix && apiKey?.startsWith(s.detectByKeyPrefix)) return s;
    if (s.detectByBaseKeyword && apiBase?.includes(s.detectByBaseKeyword)) return s;
  }

  return undefined;
}

/** Find a provider spec by config field name, e.g. "dashscope" */
export function findByName(name: string): ProviderSpec | undefined {
  return PROVIDERS.find((s) => s.name === name);
}

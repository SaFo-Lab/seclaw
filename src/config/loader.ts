/**
 * Configuration loading utilities
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Config, ConfigSchema, ProviderConfig } from "./schema";
import { PROVIDERS, findByName } from "../providers/registry";

export function getConfigPath(): string {
  return path.join(os.homedir(), ".seclaw", "config.json");
}

export function getDataDir(): string {
  return ensureDir(path.join(os.homedir(), ".seclaw"));
}

/** Load configuration from file or create default. */
export function loadConfig(configPath?: string): Config {
  const p = configPath ?? getConfigPath();

  if (fs.existsSync(p)) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      const migrated = migrateConfig(raw);
      return ConfigSchema.parse(convertKeys(migrated));
    } catch (e) {
      console.warn(`Warning: Failed to load config from ${p}: ${e}`);
      console.warn("Using default configuration.");
    }
  }

  return ConfigSchema.parse({});
}

/** Save configuration to file. */
export function saveConfig(config: Config, configPath?: string): void {
  const p = configPath ?? getConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const data = convertToCamel(config as unknown as Record<string, unknown>);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function migrateConfig(data: Record<string, unknown>): Record<string, unknown> {
  const tools = (data["tools"] ?? {}) as Record<string, unknown>;
  const execCfg = (tools["exec"] ?? {}) as Record<string, unknown>;
  if ("restrictToWorkspace" in execCfg && !("restrictToWorkspace" in tools)) {
    tools["restrictToWorkspace"] = execCfg["restrictToWorkspace"];
    delete execCfg["restrictToWorkspace"];
  }

  const security = (data["security"] ?? {}) as Record<string, unknown>;
  if (
    "promptInjectionDetectionEnabled" in security
    && !("outputValidationEnabled" in security)
  ) {
    security["outputValidationEnabled"] = security["promptInjectionDetectionEnabled"];
  }

  return data;
}

/** Convert camelCase keys to snake_case-like camelCase for Zod. */
export function convertKeys(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(convertKeys);
  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      result[camelToLowerCamel(k)] = convertKeys(v);
    }
    return result;
  }
  return data;
}

/** Convert snake_case or other forms to camelCase for JSON output. */
export function convertToCamel(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(convertToCamel);
  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      result[snakeToCamel(k)] = convertToCamel(v);
    }
    return result;
  }
  return data;
}

export function camelToLowerCamel(name: string): string {
  // Input may already be camelCase or snake_case - normalise to camelCase
  if (name.includes("_")) return snakeToCamel(name);
  // Already camelCase — lower-case first char just in case
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export function camelToSnake(name: string): string {
  return name.replace(/([A-Z])/g, "_$1").toLowerCase();
}

export function snakeToCamel(name: string): string {
  const parts = name.split("_");
  return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

function ensureDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// ─── Provider helpers (placed here to avoid circular imports) ─────────────────

/** Match provider config and its registry name. */
export function matchProvider(
  config: Config,
  model?: string
): [ProviderConfig | null, string | null] {
  const modelLower = (model ?? config.agents.defaults.model).toLowerCase();

  for (const spec of PROVIDERS) {
    const p = (config.providers as Record<string, ProviderConfig>)[spec.name];
    if (p && spec.keywords.some((kw) => modelLower.includes(kw)) && p.apiKey) {
      return [p, spec.name];
    }
  }

  for (const spec of PROVIDERS) {
    const p = (config.providers as Record<string, ProviderConfig>)[spec.name];
    if (p && p.apiKey) return [p, spec.name];
  }

  return [null, null];
}

export function getProvider(config: Config, model?: string): ProviderConfig | null {
  return matchProvider(config, model)[0];
}

export function getProviderName(config: Config, model?: string): string | null {
  return matchProvider(config, model)[1];
}

export function getApiKey(config: Config, model?: string): string | null {
  return getProvider(config, model)?.apiKey ?? null;
}

export function getApiBase(config: Config, model?: string): string | null {
  const [p, name] = matchProvider(config, model);
  if (p?.apiBase) return p.apiBase;
  if (name) {
    const spec = findByName(name);
    if (spec?.isGateway && spec.defaultApiBase) return spec.defaultApiBase;
  }
  return null;
}

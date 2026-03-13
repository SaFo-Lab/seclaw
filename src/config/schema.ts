/**
 * Configuration schema
 * Uses Zod for validation.
 */

import { z } from "zod";
import * as path from "path";
import * as os from "os";

// ─── Channel Configs ─────────────────────────────────────────────────────────

export const WhatsAppConfigSchema = z.object({
  enabled: z.boolean().default(false),
  bridgeUrl: z.string().default("ws://localhost:3001"),
  allowFrom: z.array(z.string()).default([]),
});

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(""),
  allowFrom: z.array(z.string()).default([]),
  proxy: z.string().nullable().default(null),
  startReply: z.string().default("👋 Hi, I'm SeClaw, your secure AI agent assistant.\n I help you complete tasks safely and efficiently.\nSend /help to see the available commands."),
});

export const FeishuConfigSchema = z.object({
  enabled: z.boolean().default(false),
  appId: z.string().default(""),
  appSecret: z.string().default(""),
  encryptKey: z.string().default(""),
  verificationToken: z.string().default(""),
  allowFrom: z.array(z.string()).default([]),
});

export const DingTalkConfigSchema = z.object({
  enabled: z.boolean().default(false),
  clientId: z.string().default(""),
  clientSecret: z.string().default(""),
  allowFrom: z.array(z.string()).default([]),
});

export const DiscordConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(""),
  allowFrom: z.array(z.string()).default([]),
  gatewayUrl: z.string().default("wss://gateway.discord.gg/?v=10&encoding=json"),
  intents: z.number().default(37377),
});

export const EmailConfigSchema = z.object({
  enabled: z.boolean().default(false),
  consentGranted: z.boolean().default(false),
  imapHost: z.string().default(""),
  imapPort: z.number().default(993),
  imapUsername: z.string().default(""),
  imapPassword: z.string().default(""),
  imapMailbox: z.string().default("INBOX"),
  imapUseSsl: z.boolean().default(true),
  smtpHost: z.string().default(""),
  smtpPort: z.number().default(587),
  smtpUsername: z.string().default(""),
  smtpPassword: z.string().default(""),
  smtpUseTls: z.boolean().default(true),
  smtpUseSsl: z.boolean().default(false),
  fromAddress: z.string().default(""),
  autoReplyEnabled: z.boolean().default(true),
  pollIntervalSeconds: z.number().default(30),
  markSeen: z.boolean().default(true),
  maxBodyChars: z.number().default(12000),
  subjectPrefix: z.string().default("Re: "),
  allowFrom: z.array(z.string()).default([]),
});

export const MochatMentionConfigSchema = z.object({
  requireInGroups: z.boolean().default(false),
});

export const MochatGroupRuleSchema = z.object({
  requireMention: z.boolean().default(false),
});

export const MochatConfigSchema = z.object({
  enabled: z.boolean().default(false),
  baseUrl: z.string().default("https://mochat.io"),
  socketUrl: z.string().default(""),
  socketPath: z.string().default("/socket.io"),
  socketDisableMsgpack: z.boolean().default(false),
  socketReconnectDelayMs: z.number().default(1000),
  socketMaxReconnectDelayMs: z.number().default(10000),
  socketConnectTimeoutMs: z.number().default(10000),
  refreshIntervalMs: z.number().default(30000),
  watchTimeoutMs: z.number().default(25000),
  watchLimit: z.number().default(100),
  retryDelayMs: z.number().default(500),
  maxRetryAttempts: z.number().default(0),
  clawToken: z.string().default(""),
  agentUserId: z.string().default(""),
  sessions: z.array(z.string()).default([]),
  panels: z.array(z.string()).default([]),
  allowFrom: z.array(z.string()).default([]),
  mention: MochatMentionConfigSchema.default({}),
  groups: z.record(MochatGroupRuleSchema).default({}),
  replyDelayMode: z.string().default("non-mention"),
  replyDelayMs: z.number().default(120000),
});

export const SlackDMConfigSchema = z.object({
  enabled: z.boolean().default(true),
  policy: z.string().default("open"),
  allowFrom: z.array(z.string()).default([]),
});

export const SlackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.string().default("socket"),
  webhookPath: z.string().default("/slack/events"),
  botToken: z.string().default(""),
  appToken: z.string().default(""),
  userTokenReadOnly: z.boolean().default(true),
  groupPolicy: z.string().default("mention"),
  groupAllowFrom: z.array(z.string()).default([]),
  dm: SlackDMConfigSchema.default({}),
});

export const QQConfigSchema = z.object({
  enabled: z.boolean().default(false),
  appId: z.string().default(""),
  secret: z.string().default(""),
  allowFrom: z.array(z.string()).default([]),
});

export const ChannelsConfigSchema = z.object({
  whatsapp: WhatsAppConfigSchema.default({}),
  telegram: TelegramConfigSchema.default({}),
  discord: DiscordConfigSchema.default({}),
  feishu: FeishuConfigSchema.default({}),
  mochat: MochatConfigSchema.default({}),
  dingtalk: DingTalkConfigSchema.default({}),
  email: EmailConfigSchema.default({}),
  slack: SlackConfigSchema.default({}),
  qq: QQConfigSchema.default({}),
});

// ─── Agent Configs ────────────────────────────────────────────────────────────

export const AgentDefaultsSchema = z.object({
  workspace: z.string().default("~/.seclaw/workspace"),
  model: z.string().default("anthropic/claude-opus-4-5"),
  maxTokens: z.number().default(8192),
  temperature: z.number().default(0.7),
  maxToolIterations: z.number().default(20),
});

export const AgentsConfigSchema = z.object({
  defaults: AgentDefaultsSchema.default({}),
});

// ─── Provider Configs ─────────────────────────────────────────────────────────

export const ProviderConfigSchema = z.object({
  apiKey: z.string().default(""),
  apiBase: z.string().nullable().default(null),
  extraHeaders: z.record(z.string()).nullable().default(null),
});

export const ProvidersConfigSchema = z.object({
  anthropic: ProviderConfigSchema.default({}),
  openai: ProviderConfigSchema.default({}),
  openrouter: ProviderConfigSchema.default({}),
  deepseek: ProviderConfigSchema.default({}),
  groq: ProviderConfigSchema.default({}),
  zhipu: ProviderConfigSchema.default({}),
  dashscope: ProviderConfigSchema.default({}),
  vllm: ProviderConfigSchema.default({}),
  gemini: ProviderConfigSchema.default({}),
  moonshot: ProviderConfigSchema.default({}),
  minimax: ProviderConfigSchema.default({}),
  aihubmix: ProviderConfigSchema.default({}),
});

// ─── Gateway Config ───────────────────────────────────────────────────────────

export const GatewayConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().default(18790),
});

// ─── Tools Configs ────────────────────────────────────────────────────────────

export const WebSearchConfigSchema = z.object({
  apiKey: z.string().default(""),
  maxResults: z.number().default(5),
});

export const WebToolsConfigSchema = z.object({
  search: WebSearchConfigSchema.default({}),
});

export const ExecToolConfigSchema = z.object({
  timeout: z.number().default(60),
});

export const DockerSandboxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  image: z.string().default("ubuntu:22.04"),
  containerName: z.string().default("seclaw"),
  workspaceContainer: z.string().default("/workspace"),
  workspaceReadOnly: z.boolean().default(false),
  extraMounts: z.array(z.string()).default([]),
  extraEnv: z.record(z.string()).default({}),
  memoryLimit: z.string().nullable().default(null),
  network: z.string().default("bridge"),
  snapshotEnabled: z.boolean().default(true),
  snapshotMax: z.number().default(10),
  snapshotMinIntervalSeconds: z.number().default(1800),
});

export const ToolsConfigSchema = z.object({
  web: WebToolsConfigSchema.default({}),
  exec: ExecToolConfigSchema.default({}),
  restrictToWorkspace: z.boolean().default(false),
});

// ─── Security Config ──────────────────────────────────────────────────────────

export const SecurityConfigSchema = z.object({
  dockerSandbox: DockerSandboxConfigSchema.default({}),
  prohibitedCommands: z.array(z.string()).default([]),
  inputValidationEnabled: z.boolean().default(true),
  outputValidationEnabled: z.boolean().default(true),
  executionLogEnabled: z.boolean().default(true),
  executionLogStep: z.number().default(1),
  postExecutionAuditEnabled: z.boolean().default(true),
  skillAuditEnabled: z.boolean().default(true),
});

// ─── Root Config ──────────────────────────────────────────────────────────────

export const ConfigSchema = z.object({
  agents: AgentsConfigSchema.default({}),
  channels: ChannelsConfigSchema.default({}),
  providers: ProvidersConfigSchema.default({}),
  gateway: GatewayConfigSchema.default({}),
  tools: ToolsConfigSchema.default({}),
  security: SecurityConfigSchema.default({}),
});

// ─── TypeScript Types ─────────────────────────────────────────────────────────

export type WhatsAppConfig = z.infer<typeof WhatsAppConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type FeishuConfig = z.infer<typeof FeishuConfigSchema>;
export type DingTalkConfig = z.infer<typeof DingTalkConfigSchema>;
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;
export type EmailConfig = z.infer<typeof EmailConfigSchema>;
export type MochatConfig = z.infer<typeof MochatConfigSchema>;
export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export type QQConfig = z.infer<typeof QQConfigSchema>;
export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type WebSearchConfig = z.infer<typeof WebSearchConfigSchema>;
export type WebToolsConfig = z.infer<typeof WebToolsConfigSchema>;
export type ExecToolConfig = z.infer<typeof ExecToolConfigSchema>;
export type DockerSandboxConfig = z.infer<typeof DockerSandboxConfigSchema>;
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

// ─── Config helpers ───────────────────────────────────────────────────────────

/** Get expanded workspace path */
export function getWorkspacePath(config: Config): string {
  const ws = config.agents.defaults.workspace;
  return ws.startsWith("~") ? path.join(os.homedir(), ws.slice(1)) : ws;
}

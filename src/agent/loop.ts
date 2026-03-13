/**
 * Agent loop - TypeScript port of seclaw/agent/loop.py
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import logger from "../utils/logger";
import { MessageBus } from "../bus/queue";
import { InboundMessage, OutboundMessage, makeInboundMessage, makeOutboundMessage, sessionKey as getSessionKey } from "../bus/events";
import type { LLMProvider } from "../providers/base";
import { ContextBuilder } from "./context";
import { ToolRegistry } from "./tools/registry";
import { ReadFileTool, WriteFileTool, EditFileTool, ListDirTool } from "./tools/filesystem";
import { ExecTool } from "./tools/shell";
import { WebSearchTool, WebFetchTool } from "./tools/web";
import { MessageTool } from "./tools/message";
import { SpawnTool } from "./tools/spawn";
import { CronTool } from "./tools/cron";
import { MemoryStore } from "./memory";
import { SubagentManager } from "./subagent";
import { SessionManager, Session, addMessage as sessAddMessage, getHistory as sessGetHistory, clearSession } from "../session/manager";
import type { DockerSandbox } from "./docker_sandbox";
import type { CronService } from "../cron/service";
import { SecurityValidator } from "./security/input_validation";
import { DockerSnapshotManager } from "./security/snapshot_and_rollback/docker_snapshot";
import { getBackend as getHostBackend } from "./security/snapshot_and_rollback/index";
import { auditSkills } from "./security/skill_audit";
import { auditExecution } from "./security/execution_audit";
import { auditMemory } from "./security/memory_audit";

export interface ExecToolConfig {
  timeout?: number;
}

export interface SecurityConfig {
  inputValidationEnabled?: boolean;
  outputValidationEnabled?: boolean;
  postExecutionAuditEnabled?: boolean;
  executionLogEnabled?: boolean;
  executionLogStep?: number;
  prohibitedCommands?: string[];
  dockerSandbox?: {
    snapshotMinIntervalSeconds?: number;
  };
}

export interface AgentLoopOptions {
  bus: MessageBus;
  provider: LLMProvider;
  workspace: string;
  model?: string;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  memoryWindow?: number;
  braveApiKey?: string;
  execConfig?: ExecToolConfig;
  cronService?: CronService | null;
  restrictToWorkspace?: boolean;
  sessionManager?: SessionManager;
  dockerSandbox?: DockerSandbox | null;
  securityConfig?: SecurityConfig;
  onReady?: () => void;
}

export class AgentLoop {
  private bus: MessageBus;
  private provider: LLMProvider;
  private workspace: string;
  private model: string;
  private maxIterations: number;
  private temperature: number;
  private maxTokens: number;
  private memoryWindow: number;
  private braveApiKey?: string;
  private execConfig: ExecToolConfig;
  private cronService?: CronService | null;
  private restrictToWorkspace: boolean;
  private dockerSandbox?: DockerSandbox | null;
  private securityConfig: SecurityConfig;
  private onReady?: () => void;
  private readySignaled = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  private context: ContextBuilder;
  private sessions: SessionManager;
  private tools: ToolRegistry;
  private subagents: SubagentManager;
  private running = false;
  private security!: SecurityValidator;
  private dockerSnapshot: DockerSnapshotManager | null = null;

  constructor(opts: AgentLoopOptions) {
    this.bus = opts.bus;
    this.provider = opts.provider;
    this.workspace = opts.workspace;
    this.model = opts.model ?? opts.provider.getDefaultModel();
    this.maxIterations = opts.maxIterations ?? 20;
    this.temperature = opts.temperature ?? 0.7;
    this.maxTokens = opts.maxTokens ?? 4096;
    this.memoryWindow = opts.memoryWindow ?? 50;
    this.braveApiKey = opts.braveApiKey;
    this.execConfig = opts.execConfig ?? {};
    this.cronService = opts.cronService;
    this.restrictToWorkspace = opts.restrictToWorkspace ?? false;
    this.dockerSandbox = opts.dockerSandbox;
    this.securityConfig = opts.securityConfig ?? {};
    this.onReady = opts.onReady;
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    const containerWorkspace = this.dockerSandbox?.workspaceContainer;
    const pathTranslator = this.dockerSandbox
      ? (p: string) => this.dockerSandbox!.hostToContainer(p)
      : undefined;

    this.context = new ContextBuilder({
      workspace: this.workspace,
      containerWorkspace,
      pathTranslator,
      dockerSandbox: this.dockerSandbox
        ? { image: this.dockerSandbox.image }
        : undefined,
    });

    this.sessions = opts.sessionManager ?? new SessionManager(this.workspace);
    this.tools = new ToolRegistry();
    this.subagents = new SubagentManager({
      provider: this.provider,
      workspace: this.workspace,
      bus: this.bus,
      model: this.model,
      braveApiKey: this.braveApiKey,
      execConfig: this.execConfig,
      restrictToWorkspace: this.restrictToWorkspace,
    });

    this._registerDefaultTools();

    // Initialize security validator
    this.security = new SecurityValidator({
      provider: this.provider,
      model: this.model,
      toolRegistry: this.tools,
      workspace: this.workspace,
      prohibitedCommands: this.securityConfig.prohibitedCommands ?? [],
    });

    // Build DockerSnapshotManager
    if (this.dockerSandbox) {
      const _hostBackend = getHostBackend();
      const _snapshotEnabled = this.dockerSandbox.snapshotEnabled ?? false;
      const _hostDirs: string[] = (this.dockerSandbox.extraMounts ?? []).map((m) => m.split(":")[0]);
      this.dockerSnapshot = _snapshotEnabled
        ? new DockerSnapshotManager({
            containerName: this.dockerSandbox.containerName,
            workspace: this.workspace,
            hostBackend: _hostBackend?.isAvailable() ? _hostBackend : null,
            hostDirs: _hostDirs,
            maxSnapshots: this.dockerSandbox.snapshotMax ?? 10,
          })
        : null;
    } else {
      this.dockerSnapshot = null;
    }
  }

  private _registerDefaultTools(): void {
    const allowedDir = this.restrictToWorkspace ? this.workspace : undefined;
    const sandbox = this.dockerSandbox ?? undefined;

    this.tools.register(new ReadFileTool({ allowedDir, dockerSandbox: sandbox }));
    this.tools.register(new WriteFileTool({ allowedDir, dockerSandbox: sandbox }));
    this.tools.register(new EditFileTool({ allowedDir, dockerSandbox: sandbox }));
    this.tools.register(new ListDirTool({ allowedDir, dockerSandbox: sandbox }));

    const workingDir = sandbox?.workspaceContainer ?? this.workspace;
    this.tools.register(
      new ExecTool({
        workingDir,
        timeout: this.execConfig.timeout,
        restrictToWorkspace: this.restrictToWorkspace,
        dockerSandbox: sandbox,
      })
    );

    this.tools.register(new WebSearchTool({ apiKey: this.braveApiKey }));
    this.tools.register(new WebFetchTool());

    const messageTool = new MessageTool({
      sendCallback: (msg: OutboundMessage) => this.bus.publishOutbound(msg),
    });
    this.tools.register(messageTool);

    const spawnTool = new SpawnTool(this.subagents);
    this.tools.register(spawnTool);

    if (this.cronService) {
      this.tools.register(new CronTool(this.cronService));
    }
  }

  private _setToolContext(channel: string, chatId: string): void {
    const messageTool = this.tools.get("message");
    if (messageTool instanceof MessageTool) messageTool.setContext(channel, chatId);

    const spawnTool = this.tools.get("spawn");
    if (spawnTool instanceof SpawnTool) spawnTool.setContext(channel, chatId);

    const cronTool = this.tools.get("cron");
    if (cronTool instanceof CronTool) cronTool.setContext(channel, chatId);
  }

  async run(): Promise<void> {
    this.running = true;
    logger.info("Agent loop started");

    // Reuse the same pending promise to avoid accumulating dangling waiters
    // in AsyncQueue when Promise.race timeout fires before a message arrives.
    let pending: Promise<InboundMessage> | null = null;
    let readyAnnounced = false;

    while (this.running) {
      try {
        if (!pending) {
          pending = this.bus.consumeInbound();
          if (!readyAnnounced) {
            readyAnnounced = true;
            this._signalReady();
          }
        }

        const msg = await Promise.race<InboundMessage | null>([
          pending.then((m) => { pending = null; return m; }),
          new Promise<null>((res) => setTimeout(() => res(null), 1000)),
        ]);

        if (!msg) continue;

        try {
          const response = await this._processMessage(msg);
          if (response) await this.bus.publishOutbound(response);
        } catch (e) {
          logger.error(`Error processing message: ${e}`);
          await this.bus.publishOutbound(
            makeOutboundMessage({
              channel: msg.channel,
              chatId: msg.chatId,
              content: `Sorry, I encountered an error: ${String(e)}`,
            })
          );
        }
      } catch {
        // Timeout or other error — continue
      }
    }
  }

  stop(): void {
    this.running = false;
    logger.info("Agent loop stopping");
  }

  private _signalReady(): void {
    if (this.readySignaled) return;
    this.readySignaled = true;
    this.resolveReady();

    if (this.onReady) {
      try {
        this.onReady();
      } catch (e) {
        logger.warn(`Agent onReady callback error: ${e}`);
      }
    }
  }

  async waitUntilReady(timeoutMs = 0): Promise<void> {
    if (this.readySignaled) return;

    if (timeoutMs <= 0) {
      await this.readyPromise;
      return;
    }

    await Promise.race([
      this.readyPromise,
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error(`Agent readiness timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  }

  private _secondsSinceLastUserMessage(session: Session): number | null {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const item = session.messages[i] as Record<string, unknown>;
      if (item["role"] !== "user") continue;
      const rawTs = item["timestamp"];
      if (!rawTs) continue;
      try {
        let tsText = String(rawTs);
        if (tsText.endsWith("Z")) tsText = tsText.slice(0, -1) + "+00:00";
        const parsed = new Date(tsText);
        return Math.max(0, (Date.now() - parsed.getTime()) / 1000);
      } catch {
        continue;
      }
    }
    return null;
  }

  private _isToolOutputSummary(content: unknown): boolean {
    return String(content ?? "").startsWith("[Concise summary of earlier tool output]");
  }

  private async _llmSummarizeToolOutput(content: unknown): Promise<string> {
    const text = String(content ?? "").trim();
    if (!text) return "[Concise summary of earlier tool output] (empty output)";
    if (this._isToolOutputSummary(text)) return text;

    const prompt =
      "Summarize this tool output in 1-2 short sentences for future agent context. " +
      "Keep only decisive facts: status, key findings, important paths/values, and errors. " +
      `No markdown or bullet points.\n\nTool output:\n${text.slice(0, 5000)}`;

    try {
      const response = await this.provider.chat(
        [
          { role: "system", content: "You compress tool outputs into concise factual summaries." },
          { role: "user", content: prompt },
        ],
        { model: this.model }
      );
      const summary = (response.content ?? "").replace(/\s+/g, " ").trim();
      if (summary) return `[Concise summary of earlier tool output] ${summary.slice(0, 360)}`;
    } catch (e) {
      logger.warn(`LLM tool-output summary failed, using fallback: ${e}`);
    }

    const normalized = text.replace(/\s+/g, " ");
    if (normalized.length <= 280) return `[Concise summary of earlier tool output] ${normalized}`;
    return `[Concise summary of earlier tool output] ${normalized.slice(0, 200)} ... ${normalized.slice(-60)}`;
  }

  private async _appendToolResultWithIncrementalCompression(
    execMessages: Record<string, unknown>[],
    toolCallId: string,
    toolName: string,
    result: unknown,
    latestFullToolIdx: number | null
  ): Promise<[Record<string, unknown>[], number]> {
    if (latestFullToolIdx !== null && latestFullToolIdx >= 0 && latestFullToolIdx < execMessages.length) {
      const prev = execMessages[latestFullToolIdx];
      if (prev["role"] === "tool") {
        const summarized = await this._llmSummarizeToolOutput(prev["content"]);
        execMessages[latestFullToolIdx] = { ...prev, content: summarized };
      }
    }
    this.context.addToolResult(execMessages, toolCallId, toolName, String(result));
    return [execMessages, execMessages.length - 1];
  }

  private async _takeSnapshotIfEnabled(
    msg: InboundMessage,
    key: string,
    label: string
  ): Promise<void> {
    if (!this.dockerSnapshot || !this.dockerSandbox) return;
    const dockerSandbox = this.dockerSandbox;
    const minInterval = Math.max(0, this.securityConfig.dockerSandbox?.snapshotMinIntervalSeconds ?? 0);
    const session = this.sessions.getOrCreate(key);
    const secondsSinceLast = this._secondsSinceLastUserMessage(session);
    const shouldSnapshot = minInterval === 0 || secondsSinceLast === null || secondsSinceLast >= minInterval;
    if (!shouldSnapshot) {
      logger.info(`Skip snapshot due to interval threshold: gap=${secondsSinceLast?.toFixed(1)}s < min=${minInterval}s`);
      return;
    }
    await this.bus.publishOutbound(makeOutboundMessage({
      channel: msg.channel,
      chatId: msg.chatId,
      content: "🛟 Generating snapshot, Please wait a minute ...",
      metadata: { keepTyping: true },
    }));
    await new Promise<void>((resolve) => setImmediate(resolve));
    let snapTag: string | null = null;
    try { snapTag = await this.dockerSnapshot.takeSnapshotAsync(label, (tag) => dockerSandbox.buildRunCmd(tag)); } catch (e) { logger.warn(`Snapshot failed: ${e}`); }
    if (snapTag) {
      const manifestPath = this.dockerSnapshot.getManifestPath();
      await this.bus.publishOutbound(makeOutboundMessage({
        channel: msg.channel,
        chatId: msg.chatId,
        content: `✅ Snapshot created successfully: ${snapTag}\nSnapshot cleanup location: ${manifestPath}`,
        metadata: { keepTyping: true },
      }));
    } else {
      await this.bus.publishOutbound(makeOutboundMessage({
        channel: msg.channel,
        chatId: msg.chatId,
        content: "⚠️ Snapshot creation failed, continuing.",
        metadata: { keepTyping: true },
      }));
    }
  }

  private async _buildConfirmationMessage(opts: {
    toolName: string;
    toolArgs: Record<string, unknown>;
    messages: Record<string, unknown>[];
    securityReason: string;
  }): Promise<string> {
    const { toolName, toolArgs, messages, securityReason } = opts;

    const historyLines: string[] = [];
    for (const m of messages) {
      const role = String(m["role"] ?? "");
      const content = String(m["content"] ?? "");
      if (role === "system") continue;
      if (role === "tool") {
        const snippet = content.slice(0, 200) + (content.length > 200 ? "..." : "");
        historyLines.push(`[tool result ${String(m["tool_call_id"] ?? "?")}]: ${snippet}`);
      } else if (role === "assistant") {
        const tcs = (m["tool_calls"] as Record<string, unknown>[] | undefined) ?? [];
        for (const tc of tcs) {
          const fn = (tc["function"] as Record<string, unknown> | undefined) ?? {};
          historyLines.push(`[assistant called]: ${String(fn["name"] ?? "")}(${String(fn["arguments"] ?? "").slice(0, 150)})`);
        }
        if (content) historyLines.push(`[assistant]: ${content.slice(0, 200)}`);
      } else {
        historyLines.push(`[${role}]: ${content.slice(0, 200)}`);
      }
    }
    const executionHistory = historyLines.slice(-30).join("\n");
    const argsSummary = JSON.stringify(toolArgs).slice(0, 400);

    const prompt = `You are a security assistant helping a user understand why their AI agent is pausing for confirmation.

The agent was about to call a tool but security validation flagged it.

Tool name: ${toolName}
Tool arguments (truncated): ${argsSummary}

Execution history (most recent at bottom):
${executionHistory}

Pending Reason (internal reason): ${securityReason}

Write a clear, concise confirmation request in natural language (2-4 short paragraphs):
1. Indicate the specific command (tool call) that will be executed ("tool name", "parameters", or "shell command").
2. Explain what the agent has done and why it decided to execute the current command.
3. Explain the pending reason / security concern in as much detail as possible — what risk or anomaly was detected.
4. End with a direct yes/no question asking the user whether to proceed.

## Output format (no more than 200 words):
  Pending Tool Call: <tool-call-command>
    Explanation: <the task execution context and why the agent is calling this tool>
    Pending Reason: <detailed explanation of the detected pending reason / security risk>
    Confirmation Request: <a direct yes/no question asking the user whether to proceed>
`;

    try {
      const resp = await this.provider.chat(
        [
          { role: "system", content: "You are a security assistant composing user-friendly confirmation requests." },
          { role: "user", content: prompt },
        ],
        { model: this.model }
      );
      const text = (resp.content ?? "").trim();
      if (text) return text;
    } catch (e) {
      logger.warn(`_buildConfirmationMessage LLM call failed: ${e}`);
    }

    return `Pending Tool Call: ${toolName} ${argsSummary}\n\nExplanation: The agent selected this step to continue your requested task based on recent execution context.\n\nPending Reason: ${securityReason}\n\nConfirmation Request: Do you want to proceed with this action? (yes/no)`;
  }

  async _processMessage(
    msg: InboundMessage,
    sessionKeyOverride?: string
  ): Promise<OutboundMessage | null> {
    if (msg.channel === "system") return this._processSystemMessage(msg);

    const preview = msg.content.length > 80 ? msg.content.slice(0, 80) + "..." : msg.content;
    logger.info(`Processing message from ${msg.channel}:${msg.senderId}: ${preview}`);

    const key = sessionKeyOverride ?? getSessionKey(msg);
    const session = this.sessions.getOrCreate(key);

    // Handle slash commands
    const rawCmd = msg.content.trim().replace(/^@/, "").trim();
    const cmd = rawCmd.toLowerCase();
    if (cmd === "/new") {
      const msgsBefore = [...session.messages];
      clearSession(session);
      this.sessions.save(session);
      this.sessions.invalidate(session.key);
      this._consolidateMemory(session, true, msgsBefore).catch(() => {});
      return makeOutboundMessage({
        channel: msg.channel,
        chatId: msg.chatId,
        content: "New session started. Memory consolidation in progress.",
      });
    }
    if (cmd === "/help") {
      return makeOutboundMessage({
        channel: msg.channel,
        chatId: msg.chatId,
        content:
          "🦾 seclaw commands:\n/new — Start a new conversation\n/skill_audit — Audit loaded skills for security risks\n/memory_audit — Audit stored memory for security risks\n/take_snapshot [label] — Manually create a snapshot\n/snapshot_list — List all available snapshots\n/snapshot_restore <TAG> — Restore a snapshot by tag\n/help — Show available commands",
      });
    }

    if (cmd === "/skill_audit") {
      await this._takeSnapshotIfEnabled(msg, key, `${key}: /skill_audit`);
      return auditSkills({
        skillsLoader: this.context.skills,
        provider: this.provider,
        model: this.model,
        workspace: this.workspace,
        msg,
      });
    }

    if (cmd === "/memory_audit") {
      await this._takeSnapshotIfEnabled(msg, key, `${key}: /memory_audit`);
      return auditMemory({
        workspace: this.workspace,
        provider: this.provider,
        model: this.model,
        msg,
      });
    }

    if (cmd === "/snapshot_list") {
      if (!this.dockerSnapshot) {
        return makeOutboundMessage({ channel: msg.channel, chatId: msg.chatId, content: "⚠️ Snapshot feature is not enabled." });
      }
      const snapshots = this.dockerSnapshot.listSnapshots();
      if (!snapshots.length) {
        return makeOutboundMessage({ channel: msg.channel, chatId: msg.chatId, content: "No snapshots found." });
      }
      const snapshotLines = [`📦 Available snapshots (${snapshots.length} total):\n`];
      for (let si = 0; si < snapshots.length; si++) {
        const s = snapshots[si] as unknown as Record<string, unknown>;
        snapshotLines.push(`${si}. [${String(s["timestamp"] ?? "?")}] ${String(s["tag"] ?? "?")}\n   ${String(s["label"] ?? "")}`);
      }
      return makeOutboundMessage({ channel: msg.channel, chatId: msg.chatId, content: snapshotLines.join("\n") });
    }

    if (cmd === "/take_snapshot" || cmd.startsWith("/take_snapshot ")) {
      if (!this.dockerSnapshot || !this.dockerSandbox) {
        return makeOutboundMessage({ channel: msg.channel, chatId: msg.chatId, content: "⚠️ Snapshot feature is not enabled." });
      }
      const labelArg = rawCmd.replace(/^\/take_snapshot\b/i, "").trim();
      const label = labelArg || `${key}: manual /take_snapshot`;
      await this.bus.publishOutbound(makeOutboundMessage({
        channel: msg.channel,
        chatId: msg.chatId,
        content: "🛟 Generating snapshot, please wait a moment ...",
        metadata: { keepTyping: true },
      }));
      await new Promise<void>((resolve) => setImmediate(resolve));
      let snapTag: string | null = null;
      try {
        snapTag = await this.dockerSnapshot.takeSnapshotAsync(
          label,
          (tag) => this.dockerSandbox!.buildRunCmd(tag)
        );
      } catch (e) {
        logger.warn(`Manual snapshot failed: ${e}`);
      }
      if (!snapTag) {
        return makeOutboundMessage({ channel: msg.channel, chatId: msg.chatId, content: "❌ Snapshot creation failed." });
      }
      const manifestPath = this.dockerSnapshot.getManifestPath();
      return makeOutboundMessage({
        channel: msg.channel,
        chatId: msg.chatId,
        content: `✅ Snapshot created successfully: ${snapTag}\nSnapshot cleanup location: ${manifestPath}`,
      });
    }

    if (cmd.startsWith("/snapshot_restore")) {
      if (!this.dockerSnapshot) {
        return makeOutboundMessage({ channel: msg.channel, chatId: msg.chatId, content: "⚠️ Snapshot feature is not enabled." });
      }
      const dockerSandbox = this.dockerSandbox;
      const cmdParts = rawCmd.split(/\s+/, 2);
      const snapTag = cmdParts[1]?.trim() ?? "";
      if (!snapTag) {
        return makeOutboundMessage({ channel: msg.channel, chatId: msg.chatId, content: "⚠️ Please provide a tag. Usage: /snapshot_restore <TAG>" });
      }
      try {
        this.dockerSnapshot.restoreSnapshot(
          snapTag,
          dockerSandbox ? (tag) => dockerSandbox.buildRunCmd(tag) : undefined
        );
        return makeOutboundMessage({ channel: msg.channel, chatId: msg.chatId, content: `✅ Restored to snapshot: ${snapTag}` });
      } catch (e) {
        return makeOutboundMessage({ channel: msg.channel, chatId: msg.chatId, content: `❌ Restore failed: ${e}` });
      }
    }

    // Take a Docker snapshot before processing each user message
    await this._takeSnapshotIfEnabled(msg, key, `${key}: ${msg.content.slice(0, 60)}`);

    // Update tool contexts
    this._setToolContext(msg.channel, msg.chatId);

    let messages = this.context.buildMessages({
      history: sessGetHistory(session, this.memoryWindow),
      currentMessage: msg.content,
      media: msg.media,
      channel: msg.channel,
      chatId: msg.chatId,
    });
    let execMessages = JSON.parse(JSON.stringify(messages)) as Record<string, unknown>[];
    let latestFullToolIdx: number | null = null;
    for (let i = execMessages.length - 1; i >= 0; i--) {
      if (execMessages[i]["role"] === "tool") {
        latestFullToolIdx = i;
        break;
      }
    }

    // Resume execution if previous message was a user confirmation response
    const confirmationMarker = /USER_CONFIRMATION_REQUEST/i;
    const shouldResume = (
      messages.length >= 2
      && messages[messages.length - 2]["role"] === "assistant"
      && confirmationMarker.test(String(messages[messages.length - 2]["content"] ?? ""))
    );
    if (shouldResume) {
      const resumePath = path.join(path.dirname(this.workspace), "security", "EXECUTION_RESUME.json");
      try {
        const resumed = JSON.parse(fs.readFileSync(resumePath, "utf-8")) as Record<string, unknown>[];
        resumed.push({ role: "user", content: msg.content });
        messages = resumed;
        execMessages = JSON.parse(JSON.stringify(messages)) as Record<string, unknown>[];
        latestFullToolIdx = null;
        for (let i = execMessages.length - 1; i >= 0; i--) {
          if (execMessages[i]["role"] === "tool") { latestFullToolIdx = i; break; }
        }
      } catch (e) {
        logger.warn(`Failed to load resume execution state: ${e}`);
      }
    }

    // Analyze task for security validation
    if (this.securityConfig.inputValidationEnabled) {
      const execConversations = messages.filter((m) => m["role"] !== "system");
      const userTask = JSON.stringify(execConversations);
      await this.security.analyzeTask(userTask);
      logger.info(`Security validation initialized`);
      logger.info(`\n${this.security.getTrajectorySummary()}`);
    }

    // Agent loop
    let iteration = 0;
    let finalContent: string | null = null;
    const toolsUsed: string[] = [];

    while (iteration < this.maxIterations) {
      iteration++;

      const response = await this.provider.chat(
        execMessages as import('../providers/base').Message[],
        { tools: this.tools.getDefinitions(), model: this.model }
      );

      if (response.toolCalls.length > 0) {
        const toolCallDicts = response.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));

        this.context.addAssistantMessage(messages, response.content, toolCallDicts, response.reasoningContent ?? undefined);
        this.context.addAssistantMessage(execMessages, response.content, toolCallDicts, response.reasoningContent ?? undefined);

        for (const toolCall of response.toolCalls) {
          toolsUsed.push(toolCall.name);
          const argsStr = JSON.stringify(toolCall.arguments).slice(0, 200);
          logger.info(`Tool call: ${toolCall.name}(${argsStr})`);

          // Security validation gate
          let isValid = true;
          let securityReason = "Input validation disabled";
          if (this.securityConfig.inputValidationEnabled) {
            [isValid, securityReason] = await this.security.validateToolCall(toolCall.name, toolCall.arguments);
          }

          if (!isValid) {
            logger.warn(`Tool call requires user confirmation: ${toolCall.name}`);
            const blockedResult = "⚠️ Tool call blocked by security validation. Waiting for user confirmation.";
            this.context.addToolResult(messages, toolCall.id, toolCall.name, blockedResult);
            [execMessages, latestFullToolIdx] = await this._appendToolResultWithIncrementalCompression(
              execMessages, toolCall.id, toolCall.name, blockedResult, latestFullToolIdx
            );
            const rawReason = securityReason.replace(/^USER_CONFIRMATION_REQUEST:\s*/, "");
            const confirmMsg = await this._buildConfirmationMessage({
              toolName: toolCall.name,
              toolArgs: toolCall.arguments as Record<string, unknown>,
              messages,
              securityReason: rawReason,
            });
            const fullConfirmation = `🟡 **USER_CONFIRMATION_REQUEST**\n\n${confirmMsg}`;
            messages.push({ role: "assistant", content: fullConfirmation });
            execMessages.push({ role: "assistant", content: fullConfirmation });
            const resumePath = path.join(path.dirname(this.workspace), "security", "EXECUTION_RESUME.json");
            fs.mkdirSync(path.dirname(resumePath), { recursive: true });
            fs.writeFileSync(resumePath, JSON.stringify(execMessages, null, 4), "utf-8");
            logger.info(`Execution state saved to ${resumePath}`);
            finalContent = fullConfirmation;
            break;
          }

          const result = await this.tools.execute(toolCall.name, toolCall.arguments);

          // Guard model: detect and sanitize prompt injection in tool output
          let safeResult: string = String(result);
          if (this.securityConfig.outputValidationEnabled) {
            const [sanitized, injectionDetected, detectionReason] = await this.security.detectAndSanitizeOutput(toolCall.name, result);
            if (injectionDetected) {
              logger.warn(`🛡️ Guard model sanitized output from ${toolCall.name}: ${detectionReason}`);
              safeResult = `[Security Notice: Potential prompt injection detected and removed]\n\n${sanitized}`;
            }
          }

          // Record observation for information flow tracking
          this.security.recordObservation(toolCall.name, safeResult);

          this.context.addToolResult(messages, toolCall.id, toolCall.name, safeResult);
          [execMessages, latestFullToolIdx] = await this._appendToolResultWithIncrementalCompression(
            execMessages,
            toolCall.id,
            toolCall.name,
            safeResult,
            latestFullToolIdx
          );
        }

        // If user confirmation is needed, break iteration loop
        if (finalContent !== null) break;

        // Save execution log if needed
        const logEnabled = this.securityConfig.executionLogEnabled;
        const logStep = this.securityConfig.executionLogStep ?? 5;
        if (logEnabled && iteration % logStep === 0) {
          const logName = `trajectory_${session.key}.json`;
          const logDir = path.join(path.dirname(this.workspace), "security", "execution_logs");
          fs.mkdirSync(logDir, { recursive: true });
          fs.writeFileSync(path.join(logDir, logName), JSON.stringify(messages, null, 2), "utf-8");
        }
      } else {
        finalContent = response.content ?? null;
        break;
      }
    }

    if (finalContent === null)
      finalContent = "I've completed processing but have no response to give.";

    const responsePreview = finalContent.length > 120 ? finalContent.slice(0, 120) + "..." : finalContent;
    logger.info(`Response to ${msg.channel}:${msg.senderId}: ${responsePreview}`);

    messages.push({ role: "assistant", content: finalContent });

    if (this.securityConfig.executionLogEnabled) {
      const logName = `trajectory_${session.key}_${new Date().toISOString().replace(/[:.]/g, "")}.json`;
      const logDir = path.join(path.dirname(this.workspace), "security", "execution_logs");
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, logName), JSON.stringify(messages, null, 2), "utf-8");
    }

    sessAddMessage(session, "user", msg.content);
    sessAddMessage(session, "assistant", finalContent, toolsUsed.length ? { tools_used: toolsUsed } : {});
    this.sessions.save(session);

    // Launch post-execution risk audit in background
    if (this.securityConfig.postExecutionAuditEnabled && toolsUsed.length > 0) {
      auditExecution({
        sessionKey: session.key,
        messages,
        toolsUsed,
        provider: this.provider,
        model: this.model,
        workspace: this.workspace,
        bus: this.bus,
        channel: msg.channel,
        chatId: msg.chatId,
      }).catch(() => {});
    }

    if (session.messages.length > this.memoryWindow) {
      this._consolidateMemory(session).catch(() => {});
    }

    return makeOutboundMessage({
      channel: msg.channel,
      chatId: msg.chatId,
      content: finalContent,
      metadata: msg.metadata ?? {},
    });
  }

  private async _processSystemMessage(msg: InboundMessage): Promise<OutboundMessage | null> {
    logger.info(`Processing system message from ${msg.senderId}`);

    let originChannel = "cli";
    let originChatId = msg.chatId;
    if (msg.chatId.includes(":")) {
      [originChannel, originChatId] = msg.chatId.split(":", 2) as [string, string];
    }

    const sessionKey = `${originChannel}:${originChatId}`;
    const session = this.sessions.getOrCreate(sessionKey);
    this._setToolContext(originChannel, originChatId);

    let messages = this.context.buildMessages({
      history: sessGetHistory(session),
      currentMessage: msg.content,
      channel: originChannel,
      chatId: originChatId,
    });
    let execMessages = messages.map((m) => ({ ...m }));
    let latestFullToolIdx: number | null = null;

    let iteration = 0;
    let finalContent: string | null = null;

    while (iteration < this.maxIterations) {
      iteration++;
      const response = await this.provider.chat(
        execMessages as import('../providers/base').Message[],
        { tools: this.tools.getDefinitions(), model: this.model }
      );

      if (response.toolCalls.length > 0) {
        const toolCallDicts = response.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
        this.context.addAssistantMessage(messages, response.content, toolCallDicts);
        this.context.addAssistantMessage(execMessages, response.content, toolCallDicts);

        for (const tc of response.toolCalls) {
          const result = await this.tools.execute(tc.name, tc.arguments);
          this.context.addToolResult(messages, tc.id, tc.name, result);
          [execMessages, latestFullToolIdx] = await this._appendToolResultWithIncrementalCompression(
            execMessages, tc.id, tc.name, result, latestFullToolIdx
          );
        }
      } else {
        finalContent = response.content ?? null;
        break;
      }
    }

    if (finalContent === null) finalContent = "Background task completed.";

    sessAddMessage(session, "user", `[System: ${msg.senderId}] ${msg.content}`);
    sessAddMessage(session, "assistant", finalContent);
    this.sessions.save(session);

    return makeOutboundMessage({ channel: originChannel, chatId: originChatId, content: finalContent });
  }

  private async _consolidateMemory(
    session: Session,
    archiveAll = false,
    messagesOverride?: Record<string, unknown>[]
  ): Promise<void> {
    const memory = new MemoryStore(this.workspace);
    const keepCount = this.memoryWindow / 2;

    let oldMessages: Record<string, unknown>[];
    if (archiveAll) {
      oldMessages = messagesOverride ?? session.messages as Record<string, unknown>[];
      logger.info(`Memory consolidation (archive_all): ${oldMessages.length} total messages archived`);
    } else {
      if (session.messages.length <= keepCount) return;
      const lastConsolidated = (session as any).lastConsolidated ?? 0;
      const toProcess = session.messages.length - lastConsolidated;
      if (toProcess <= 0) return;
      oldMessages = (session.messages as Record<string, unknown>[]).slice(lastConsolidated, -keepCount);
      if (oldMessages.length === 0) return;
      logger.info(`Memory consolidation: ${session.messages.length} total, ${oldMessages.length} new to process`);
    }

    const lines: string[] = [];
    for (const m of oldMessages) {
      if (!m["content"]) continue;
      const tools = m["tools_used"] ? ` [tools: ${(m["tools_used"] as string[]).join(", ")}]` : "";
      lines.push(`[${String(m["timestamp"] ?? "?").slice(0, 16)}] ${String(m["role"]).toUpperCase()}${tools}: ${m["content"]}`);
    }
    const conversation = lines.join("\n");
    const currentMemory = memory.readLongTerm();

    const prompt = `You are a memory consolidation agent. Process this conversation and return a JSON object with exactly two keys:

1. "history_entry": A paragraph (2-5 sentences) summarizing the key events/decisions/topics. Start with a timestamp like [YYYY-MM-DD HH:MM]. Include enough detail to be useful when found by grep search later.

2. "memory_update": The updated long-term memory content. Add any new facts: user location, preferences, personal info, habits, project context, technical decisions, tools/services used. If nothing new, return the existing content unchanged.

## Current Long-term Memory
${currentMemory || "(empty)"}

## Conversation to Process
${conversation}

Respond with ONLY valid JSON, no markdown fences.`;

    try {
      const response = await this.provider.chat(
        [
          { role: "system", content: "You are a memory consolidation agent. Respond only with valid JSON." },
          { role: "user", content: prompt },
        ],
        { model: this.model }
      );
      let text = (response.content ?? "").trim();
      if (!text) return;
      if (text.startsWith("```")) text = text.split("\n").slice(1).join("\n").split("```")[0].trim();
      let result: Record<string, string>;
      try {
        result = JSON.parse(text) as Record<string, string>;
      } catch {
        // Attempt a simple repair: extract JSON object pattern
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return;
        try { result = JSON.parse(match[0]) as Record<string, string>; } catch { return; }
      }
      if (result["history_entry"]) memory.appendHistory(result["history_entry"]);
      if (result["memory_update"] && result["memory_update"] !== currentMemory) {
        memory.writeLongTerm(result["memory_update"]);
      }
      if (!archiveAll) {
        (session as any).lastConsolidated = session.messages.length - keepCount;
      }
      logger.info("Memory consolidation done");
    } catch (e) {
      logger.error(`Memory consolidation failed: ${e}`);
    }
  }

  async processDirect(
    content: string,
    sessionKey = "cli:direct",
    channel = "cli",
    chatId = "direct"
  ): Promise<string> {
    const msg = makeInboundMessage({ channel, senderId: "user", chatId, content });
    const response = await this._processMessage(msg, sessionKey);
    return response?.content ?? "";
  }
}

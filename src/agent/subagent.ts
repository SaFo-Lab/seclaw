/**
 * Subagent manager
 */

import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/logger";
import { MessageBus } from "../bus/queue";
import { makeInboundMessage } from "../bus/events";
import type { LLMProvider } from "../providers/base";
import { ToolRegistry } from "./tools/registry";
import { ReadFileTool, WriteFileTool, ListDirTool } from "./tools/filesystem";
import { ExecTool } from "./tools/shell";
import { WebSearchTool, WebFetchTool } from "./tools/web";

export interface ExecToolConfig {
  timeout?: number;
}

export interface SpawnOptions {
  task: string;
  label?: string;
  originChannel?: string;
  originChatId?: string;
}

export class SubagentManager {
  private provider: LLMProvider;
  private workspace: string;
  private bus: MessageBus;
  private model: string;
  private braveApiKey?: string;
  private execConfig: ExecToolConfig;
  private restrictToWorkspace: boolean;
  private runningTasks: Map<string, Promise<void>> = new Map();

  constructor(opts: {
    provider: LLMProvider;
    workspace: string;
    bus: MessageBus;
    model?: string;
    braveApiKey?: string;
    execConfig?: ExecToolConfig;
    restrictToWorkspace?: boolean;
  }) {
    this.provider = opts.provider;
    this.workspace = opts.workspace;
    this.bus = opts.bus;
    this.model = opts.model ?? opts.provider.getDefaultModel();
    this.braveApiKey = opts.braveApiKey;
    this.execConfig = opts.execConfig ?? {};
    this.restrictToWorkspace = opts.restrictToWorkspace ?? false;
  }

  async spawn(opts: SpawnOptions): Promise<string> {
    const taskId = uuidv4().slice(0, 8);
    const { task, label, originChannel = "cli", originChatId = "direct" } = opts;
    const displayLabel = label ?? (task.length > 30 ? task.slice(0, 30) + "..." : task);

    const origin = { channel: originChannel, chatId: originChatId };

    const taskPromise = this._runSubagent(taskId, task, displayLabel, origin).then(() => {
      this.runningTasks.delete(taskId);
    });
    this.runningTasks.set(taskId, taskPromise);

    logger.info(`Spawned subagent [${taskId}]: ${displayLabel}`);
    return `Subagent [${displayLabel}] started (id: ${taskId}). I'll notify you when it completes.`;
  }

  private async _runSubagent(
    taskId: string,
    task: string,
    label: string,
    origin: { channel: string; chatId: string }
  ): Promise<void> {
    logger.info(`Subagent [${taskId}] starting task: ${label}`);

    try {
      const tools = new ToolRegistry();
      const allowedDir = this.restrictToWorkspace ? this.workspace : undefined;

      tools.register(new ReadFileTool({ allowedDir }));
      tools.register(new WriteFileTool({ allowedDir }));
      tools.register(new ListDirTool({ allowedDir }));
      tools.register(
        new ExecTool({
          workingDir: this.workspace,
          timeout: this.execConfig.timeout,
          restrictToWorkspace: this.restrictToWorkspace,
        })
      );
      tools.register(new WebSearchTool({ apiKey: this.braveApiKey }));
      tools.register(new WebFetchTool());

      const systemPrompt = this._buildSubagentPrompt(task);
      const messages: Record<string, unknown>[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: task },
      ];

      let finalResult: string | null = null;
      const maxIterations = 15;

      for (let i = 0; i < maxIterations; i++) {
        const response = await this.provider.chat(
          messages as import('../providers/base').Message[],
          { tools: tools.getDefinitions(), model: this.model }
        );

        if (response.toolCalls.length > 0) {
          const toolCallDicts = response.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }));
          messages.push({
            role: "assistant",
            content: response.content ?? "",
            tool_calls: toolCallDicts,
          });

          for (const tc of response.toolCalls) {
            logger.debug(`Subagent [${taskId}] executing: ${tc.name}`);
            const result = await tools.execute(tc.name, tc.arguments);
            messages.push({ role: "tool", tool_call_id: tc.id, name: tc.name, content: result });
          }
        } else {
          finalResult = response.content ?? null;
          break;
        }
      }

      if (finalResult === null) finalResult = "Task completed but no final response was generated.";
      logger.info(`Subagent [${taskId}] completed successfully`);
      await this._announceResult(taskId, label, task, finalResult, origin, "ok");
    } catch (e) {
      const errMsg = `Error: ${String(e)}`;
      logger.error(`Subagent [${taskId}] failed: ${e}`);
      await this._announceResult(taskId, label, task, errMsg, origin, "error");
    }
  }

  private async _announceResult(
    taskId: string,
    label: string,
    task: string,
    result: string,
    origin: { channel: string; chatId: string },
    status: string
  ): Promise<void> {
    const statusText = status === "ok" ? "completed successfully" : "failed";
    const content = `[Subagent '${label}' ${statusText}]\n\nTask: ${task}\n\nResult:\n${result}\n\nSummarize this naturally for the user. Keep it brief (1-2 sentences). Do not mention technical details like "subagent" or task IDs.`;

    const msg = makeInboundMessage({
      channel: "system",
      senderId: "subagent",
      chatId: `${origin.channel}:${origin.chatId}`,
      content,
    });
    await this.bus.publishInbound(msg);
    logger.debug(`Subagent [${taskId}] announced result to ${origin.channel}:${origin.chatId}`);
  }

  private _buildSubagentPrompt(task: string): string {
    return `# Subagent

You are a subagent spawned by the main agent to complete a specific task.

## Your Task
${task}

## Rules
1. Stay focused - complete only the assigned task, nothing else
2. Your final response will be reported back to the main agent
3. Do not initiate conversations or take on side tasks
4. Be concise but informative in your findings

## What You Can Do
- Read and write files in the workspace
- Execute shell commands
- Search the web and fetch web pages
- Complete the task thoroughly

## What You Cannot Do
- Send messages directly to users (no message tool available)
- Spawn other subagents
- Access the main agent's conversation history

## Workspace
Your workspace is at: ${this.workspace}

When you have completed the task, provide a clear summary of your findings or actions.`;
  }

  getRunningCount(): number {
    return this.runningTasks.size;
  }
}

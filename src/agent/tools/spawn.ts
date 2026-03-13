/**
 * Spawn tool
 */

import { Tool } from "./base";
import type { SubagentManager } from "../subagent";

export class SpawnTool extends Tool {
  private manager: SubagentManager;
  private originChannel: string;
  private originChatId: string;

  constructor(manager: SubagentManager) {
    super();
    this.manager = manager;
    this.originChannel = "cli";
    this.originChatId = "direct";
  }

  setContext(channel: string, chatId: string): void {
    this.originChannel = channel;
    this.originChatId = chatId;
  }

  get name(): string { return "spawn"; }
  get description(): string {
    return (
      "Spawn a subagent to handle a task in the background. " +
      "Use this for complex or time-consuming tasks that can run independently. " +
      "The subagent will complete the task and report back when done."
    );
  }
  get parameters() {
    return {
      type: "object" as const,
      properties: {
        task: { type: "string" as const, description: "The task for the subagent to complete" },
        label: { type: "string" as const, description: "Optional short label for the task (for display)" },
      },
      required: ["task"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const task = params["task"] as string;
    const label = params["label"] as string | undefined;
    return this.manager.spawn({
      task,
      label,
      originChannel: this.originChannel,
      originChatId: this.originChatId,
    });
  }
}

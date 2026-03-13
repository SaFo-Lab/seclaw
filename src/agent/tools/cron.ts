/**
 * Cron tool
 */

import { Tool } from "./base";
import { CronService } from "../../cron/service";
import type { CronSchedule } from "../../cron/types";

export class CronTool extends Tool {
  private cron: CronService;
  private channel: string;
  private chatId: string;

  constructor(cronService: CronService) {
    super();
    this.cron = cronService;
    this.channel = "";
    this.chatId = "";
  }

  setContext(channel: string, chatId: string): void {
    this.channel = channel;
    this.chatId = chatId;
  }

  get name(): string { return "cron"; }
  get description(): string { return "Schedule reminders and recurring tasks. Actions: add, list, remove."; }
  get parameters() {
    return {
      type: "object" as const,
      properties: {
        action: {
          type: "string" as const,
          enum: ["add", "list", "remove"],
          description: "Action to perform",
        },
        message: { type: "string" as const, description: "Reminder message (for add)" },
        every_seconds: { type: "integer" as const, description: "Interval in seconds (for recurring tasks)" },
        cron_expr: { type: "string" as const, description: "Cron expression like '0 9 * * *' (for scheduled tasks)" },
        job_id: { type: "string" as const, description: "Job ID (for remove)" },
      },
      required: ["action"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const action = params["action"] as string;
    if (action === "add") return this._addJob(params);
    if (action === "list") return this._listJobs();
    if (action === "remove") return this._removeJob(params["job_id"] as string | undefined);
    return `Unknown action: ${action}`;
  }

  private _addJob(params: Record<string, unknown>): string {
    const message = (params["message"] as string | undefined) ?? "";
    const everySeconds = params["every_seconds"] as number | undefined;
    const cronExpr = params["cron_expr"] as string | undefined;

    if (!message) return "Error: message is required for add";
    if (!this.channel || !this.chatId) return "Error: no session context (channel/chat_id)";

    let schedule: CronSchedule;
    if (everySeconds) {
      schedule = { kind: "every", everyMs: everySeconds * 1000 };
    } else if (cronExpr) {
      schedule = { kind: "cron", expr: cronExpr };
    } else {
      return "Error: either every_seconds or cron_expr is required";
    }

    const job = this.cron.addJob({
      name: message.slice(0, 30),
      schedule,
      message,
      deliver: true,
      channel: this.channel,
      to: this.chatId,
    });
    return `Created job '${job.name}' (id: ${job.id})`;
  }

  private _listJobs(): string {
    const jobs = this.cron.listJobs();
    if (jobs.length === 0) return "No scheduled jobs.";
    const lines = jobs.map((j) => `- ${j.name} (id: ${j.id}, ${j.schedule.kind})`);
    return "Scheduled jobs:\n" + lines.join("\n");
  }

  private _removeJob(jobId: string | undefined): string {
    if (!jobId) return "Error: job_id is required for remove";
    if (this.cron.removeJob(jobId)) return `Removed job ${jobId}`;
    return `Job ${jobId} not found`;
  }
}

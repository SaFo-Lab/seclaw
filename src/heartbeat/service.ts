/**
 * Heartbeat service
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";

const DEFAULT_HEARTBEAT_INTERVAL_S = 30 * 60;

const HEARTBEAT_PROMPT = `Read HEARTBEAT.md in your workspace (if it exists).
Follow any instructions or tasks listed there.
If nothing needs attention, reply with just: HEARTBEAT_OK`;

const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";

function isHeartbeatEmpty(content: string | null): boolean {
  if (!content) return true;

  const skipPatterns = new Set(["- [ ]", "* [ ]", "- [x]", "* [x]"]);

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith("#") ||
      trimmed.startsWith("<!--") ||
      skipPatterns.has(trimmed)
    ) {
      continue;
    }
    return false;
  }

  return true;
}

type HeartbeatCallback = (prompt: string) => Promise<string>;

export class HeartbeatService {
  workspace: string;
  onHeartbeat: HeartbeatCallback | null;
  intervalSeconds: number;
  enabled: boolean;
  private _running = false;
  private _intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(opts: {
    workspace: string;
    onHeartbeat?: HeartbeatCallback | null;
    intervalSeconds?: number;
    enabled?: boolean;
  }) {
    this.workspace = opts.workspace;
    this.onHeartbeat = opts.onHeartbeat ?? null;
    this.intervalSeconds = opts.intervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_S;
    this.enabled = opts.enabled ?? true;
  }

  get heartbeatFile(): string {
    return path.join(this.workspace, "HEARTBEAT.md");
  }

  private _readHeartbeatFile(): string | null {
    if (fs.existsSync(this.heartbeatFile)) {
      try {
        return fs.readFileSync(this.heartbeatFile, "utf8");
      } catch {
        return null;
      }
    }
    return null;
  }

  async start(): Promise<void> {
    if (!this.enabled) {
      logger.info("Heartbeat disabled");
      return;
    }

    this._running = true;
    this._intervalHandle = setInterval(() => {
      if (this._running) {
        this._tick().catch((e) =>
          logger.error({ err: e }, "Heartbeat error")
        );
      }
    }, this.intervalSeconds * 1000);

    logger.info(`Heartbeat started (every ${this.intervalSeconds}s)`);
  }

  stop(): void {
    this._running = false;
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
  }

  private async _tick(): Promise<void> {
    const content = this._readHeartbeatFile();

    if (isHeartbeatEmpty(content)) {
      logger.debug("Heartbeat: no tasks (HEARTBEAT.md empty)");
      return;
    }

    logger.info("Heartbeat: checking for tasks...");

    if (this.onHeartbeat) {
      try {
        const response = await this.onHeartbeat(HEARTBEAT_PROMPT);

        const normalised = response.toUpperCase().replace(/_/g, "");
        if (normalised.includes(HEARTBEAT_OK_TOKEN.replace("_", ""))) {
          logger.info("Heartbeat: OK (no action needed)");
        } else {
          logger.info("Heartbeat: completed task");
        }
      } catch (e) {
        logger.error({ err: e }, "Heartbeat execution failed");
      }
    }
  }

  async triggerNow(): Promise<string | null> {
    if (this.onHeartbeat) {
      return this.onHeartbeat(HEARTBEAT_PROMPT);
    }
    return null;
  }
}

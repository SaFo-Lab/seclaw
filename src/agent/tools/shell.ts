/**
 * Shell execution tool
 */

import * as child_process from "child_process";
import * as path from "path";
import { Tool } from "./base";
import type { DockerSandbox } from "../docker_sandbox";

const DENY_PATTERNS_SANDBOX = [
  /\b(format|mkfs|diskpart)\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/,
  /\b(shutdown|reboot|poweroff)\b/i,
  /:\(\)\s*\{.*\};\s*:/,
];

const DENY_PATTERNS_HOST = [
  /\brm\s+-[rf]{1,2}\b/i,
  /\bdel\s+\/[fq]\b/i,
  /\brmdir\s+\/s\b/i,
  /\b(format|mkfs|diskpart)\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/,
  /\b(shutdown|reboot|poweroff)\b/i,
  /:\(\)\s*\{.*\};\s*:/,
];

export class ExecTool extends Tool {
  private timeout: number;
  private workingDir: string | null;
  private denyPatterns: RegExp[];
  private allowPatterns: RegExp[];
  private restrictToWorkspace: boolean;
  private dockerSandbox: DockerSandbox | null;

  constructor(opts: {
    timeout?: number;
    workingDir?: string | null;
    denyPatterns?: RegExp[] | null;
    allowPatterns?: RegExp[] | null;
    restrictToWorkspace?: boolean;
    dockerSandbox?: DockerSandbox | null;
  } = {}) {
    super();
    this.timeout = opts.timeout ?? 60;
    this.workingDir = opts.workingDir ?? null;
    this.dockerSandbox = opts.dockerSandbox ?? null;
    this.denyPatterns =
      opts.denyPatterns ??
      (this.dockerSandbox?.isRunning ? DENY_PATTERNS_SANDBOX : DENY_PATTERNS_HOST);
    this.allowPatterns = opts.allowPatterns ?? [];
    this.restrictToWorkspace = opts.restrictToWorkspace ?? false;
  }

  get name(): string {
    return "exec";
  }

  get description(): string {
    return "Execute a shell command and return its output. Use with caution.";
  }

  get parameters() {
    return {
      type: "object" as const,
      properties: {
        command: { type: "string" as const, description: "The shell command to execute" },
        working_dir: {
          type: "string" as const,
          description: "Optional working directory for the command",
        },
      },
      required: ["command"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const command = params["command"] as string;
    const workingDir = (params["working_dir"] as string | undefined) ?? this.workingDir ?? process.cwd();

    const guardError = this._guardCommand(command, workingDir);
    if (guardError) return guardError;

    if (this.dockerSandbox?.isRunning) {
      try {
        const [stdout, stderr, code] = await this.dockerSandbox.exec(command, workingDir, this.timeout);
        const parts: string[] = [];
        if (stdout) parts.push(stdout);
        if (stderr.trim()) parts.push(`STDERR:\n${stderr}`);
        if (code !== 0) parts.push(`\nExit code: ${code}`);
        const result = parts.join("\n") || "(no output)";
        return result.length > 10000
          ? result.slice(0, 10000) + `\n... (truncated, ${result.length - 10000} more chars)`
          : result;
      } catch (e) {
        return `Error executing command in sandbox: ${e}`;
      }
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve(`Error: Command timed out after ${this.timeout} seconds`);
      }, this.timeout * 1000);

      const proc = child_process.exec(
        command,
        { cwd: workingDir, timeout: this.timeout * 1000 },
        (error, stdout, stderr) => {
          clearTimeout(timer);
          const parts: string[] = [];
          if (stdout) parts.push(stdout);
          if (stderr?.trim()) parts.push(`STDERR:\n${stderr}`);
          if (error?.code) parts.push(`\nExit code: ${error.code}`);
          const result = parts.join("\n") || "(no output)";
          resolve(
            result.length > 10000
              ? result.slice(0, 10000) + `\n... (truncated, ${result.length - 10000} more chars)`
              : result
          );
        }
      );

      proc.on("error", (e) => {
        clearTimeout(timer);
        resolve(`Error executing command: ${e.message}`);
      });
    });
  }

  private _guardCommand(command: string, cwd: string): string | null {
    const lower = command.toLowerCase();

    for (const pattern of this.denyPatterns) {
      if (pattern.test(lower)) {
        return "Error: Command blocked by safety guard (dangerous pattern detected)";
      }
    }

    if (this.allowPatterns.length > 0) {
      if (!this.allowPatterns.some((p) => p.test(lower))) {
        return "Error: Command blocked by safety guard (not in allowlist)";
      }
    }

    if (this.restrictToWorkspace) {
      if (command.includes("../") || command.includes("..\\")) {
        return "Error: Command blocked by safety guard (path traversal detected)";
      }
    }

    return null;
  }
}

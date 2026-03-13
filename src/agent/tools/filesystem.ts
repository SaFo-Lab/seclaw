/**
 * Filesystem tools
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Tool } from "./base";
import type { DockerSandbox } from "../docker_sandbox";

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function resolvePath(p: string, allowedDir?: string | null): string {
  const resolved = path.resolve(p.replace(/^~/, os.homedir()));
  if (allowedDir) {
    const abs = path.resolve(allowedDir);
    if (!resolved.startsWith(abs)) {
      throw new Error(`Path ${p} is outside allowed directory ${allowedDir}`);
    }
  }
  return resolved;
}

export class ReadFileTool extends Tool {
  private allowedDir: string | null;
  private sandbox: DockerSandbox | null;

  constructor(opts: { allowedDir?: string | null; dockerSandbox?: DockerSandbox | null } = {}) {
    super();
    this.allowedDir = opts.allowedDir ?? null;
    this.sandbox = opts.dockerSandbox ?? null;
  }

  get name(): string { return "read_file"; }
  get description(): string { return "Read the contents of a file at the given path."; }
  get parameters() {
    return {
      type: "object" as const,
      properties: { path: { type: "string" as const, description: "The file path to read" } },
      required: ["path"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const p = params["path"] as string;
    try {
      const filePath = resolvePath(p, this.allowedDir);

      if (this.sandbox?.isRunning) {
        const containerPath = this.sandbox.hostToContainer(filePath);
        const [stdout, stderr, rc] = await this.sandbox.exec(`cat ${shellQuote(containerPath)}`);
        if (rc === 0) return stdout;
        // Fallback to host
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          return fs.readFileSync(filePath, "utf8");
        }
        return `Error: File not found or unreadable: ${p}\n${stderr}`;
      }

      if (!fs.existsSync(filePath)) return `Error: File not found: ${p}`;
      if (!fs.statSync(filePath).isFile()) return `Error: Not a file: ${p}`;
      return fs.readFileSync(filePath, "utf8");
    } catch (e) {
      return `Error reading file: ${String(e)}`;
    }
  }
}

export class WriteFileTool extends Tool {
  private allowedDir: string | null;
  private sandbox: DockerSandbox | null;

  constructor(opts: { allowedDir?: string | null; dockerSandbox?: DockerSandbox | null } = {}) {
    super();
    this.allowedDir = opts.allowedDir ?? null;
    this.sandbox = opts.dockerSandbox ?? null;
  }

  get name(): string { return "write_file"; }
  get description(): string { return "Write content to a file. Creates parent directories if needed."; }
  get parameters() {
    return {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "The file path to write to" },
        content: { type: "string" as const, description: "The content to write" },
      },
      required: ["path", "content"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const p = params["path"] as string;
    const content = params["content"] as string;
    try {
      const filePath = resolvePath(p, this.allowedDir);

      if (this.sandbox?.isRunning) {
        const containerPath = this.sandbox.hostToContainer(filePath);
        const parent = containerPath.split("/").slice(0, -1).join("/") || ".";
        await this.sandbox.exec(`mkdir -p ${shellQuote(parent)}`);
        const [, stderr, rc] = await this.sandbox.execWithStdin(
          `cat > ${shellQuote(containerPath)}`,
          Buffer.from(content, "utf8")
        );
        if (rc !== 0) return `Error writing file in sandbox: ${stderr}`;
        return `Successfully wrote ${content.length} bytes to ${p}`;
      }

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, "utf8");
      return `Successfully wrote ${content.length} bytes to ${p}`;
    } catch (e) {
      return `Error writing file: ${String(e)}`;
    }
  }
}

export class EditFileTool extends Tool {
  private allowedDir: string | null;
  private sandbox: DockerSandbox | null;

  constructor(opts: { allowedDir?: string | null; dockerSandbox?: DockerSandbox | null } = {}) {
    super();
    this.allowedDir = opts.allowedDir ?? null;
    this.sandbox = opts.dockerSandbox ?? null;
  }

  get name(): string { return "edit_file"; }
  get description(): string { return "Edit a file by replacing old_text with new_text. The old_text must exist exactly."; }
  get parameters() {
    return {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "The file path to edit" },
        old_text: { type: "string" as const, description: "The exact text to find and replace" },
        new_text: { type: "string" as const, description: "The text to replace with" },
      },
      required: ["path", "old_text", "new_text"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const p = params["path"] as string;
    const oldText = params["old_text"] as string;
    const newText = params["new_text"] as string;
    try {
      const filePath = resolvePath(p, this.allowedDir);

      if (this.sandbox?.isRunning) {
        const containerPath = this.sandbox.hostToContainer(filePath);
        const [stdout, stderr, rc] = await this.sandbox.exec(`cat ${shellQuote(containerPath)}`);
        if (rc !== 0) return `Error: File not found: ${p}\n${stderr}`;
        if (!stdout.includes(oldText)) return "Error: old_text not found in file.";
        const count = stdout.split(oldText).length - 1;
        if (count > 1) return `Warning: old_text appears ${count} times. Provide more context.`;
        const newContent = stdout.replace(oldText, newText);
        const parent = containerPath.split("/").slice(0, -1).join("/") || ".";
        await this.sandbox.exec(`mkdir -p ${shellQuote(parent)}`);
        const [, wErr, wRc] = await this.sandbox.execWithStdin(
          `cat > ${shellQuote(containerPath)}`,
          Buffer.from(newContent, "utf8")
        );
        if (wRc !== 0) return `Error writing edited file in sandbox: ${wErr}`;
        return `Successfully edited ${p}`;
      }

      if (!fs.existsSync(filePath)) return `Error: File not found: ${p}`;
      const content = fs.readFileSync(filePath, "utf8");
      if (!content.includes(oldText)) return "Error: old_text not found in file.";
      const count = content.split(oldText).length - 1;
      if (count > 1) return `Warning: old_text appears ${count} times.`;
      const newContent = content.replace(oldText, newText);
      fs.writeFileSync(filePath, newContent, "utf8");
      return `Successfully edited ${p}`;
    } catch (e) {
      return `Error editing file: ${String(e)}`;
    }
  }
}

export class ListDirTool extends Tool {
  private allowedDir: string | null;
  private sandbox: DockerSandbox | null;

  constructor(opts: { allowedDir?: string | null; dockerSandbox?: DockerSandbox | null } = {}) {
    super();
    this.allowedDir = opts.allowedDir ?? null;
    this.sandbox = opts.dockerSandbox ?? null;
  }

  get name(): string { return "list_dir"; }
  get description(): string { return "List the contents of a directory."; }
  get parameters() {
    return {
      type: "object" as const,
      properties: { path: { type: "string" as const, description: "The directory path to list" } },
      required: ["path"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const p = params["path"] as string;
    try {
      const dirPath = resolvePath(p, this.allowedDir);

      if (this.sandbox?.isRunning) {
        const containerPath = this.sandbox.hostToContainer(dirPath);
        const [stdout, stderr, rc] = await this.sandbox.exec(`ls -1p ${shellQuote(containerPath)} 2>&1`);
        if (rc !== 0) return `Error: Directory not found or unreadable: ${p}\n${stderr}`;
        const items = stdout
          .split("\n")
          .filter((l) => l)
          .map((l) => (l.endsWith("/") ? `📁 ${l.slice(0, -1)}` : `📄 ${l}`));
        return items.length ? items.join("\n") : `Directory ${p} is empty`;
      }

      if (!fs.existsSync(dirPath)) return `Error: Directory not found: ${p}`;
      if (!fs.statSync(dirPath).isDirectory()) return `Error: Not a directory: ${p}`;

      const entries = fs.readdirSync(dirPath).sort();
      const items = entries.map((e) => {
        const fullPath = path.join(dirPath, e);
        return fs.statSync(fullPath).isDirectory() ? `📁 ${e}` : `📄 ${e}`;
      });

      return items.length ? items.join("\n") : `Directory ${p} is empty`;
    } catch (e) {
      return `Error listing directory: ${String(e)}`;
    }
  }
}

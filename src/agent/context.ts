/**
 * Context builder
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as mime from "mime-types";
import { MemoryStore } from "./memory";
import { SkillsLoader } from "./skills";

function runtimeFromImage(image: string): string {
  const name = image.split("/").pop() ?? image;
  const colonIdx = name.indexOf(":");
  const base = colonIdx > 0 ? name.slice(0, colonIdx) : name;
  const tag = colonIdx > 0 ? name.slice(colonIdx + 1) : "latest";
  const OS_MAP: Record<string, string> = {
    ubuntu: "Ubuntu",
    debian: "Debian",
    alpine: "Alpine Linux",
    fedora: "Fedora",
    centos: "CentOS",
    rockylinux: "Rocky Linux",
    almalinux: "AlmaLinux",
    amazonlinux: "Amazon Linux",
    archlinux: "Arch Linux",
    python: "Python",
    node: "Node.js",
  };
  const osName = OS_MAP[base.toLowerCase()] ?? (base.charAt(0).toUpperCase() + base.slice(1));
  return `${osName} ${tag} (Docker)`;
}

export interface DockerSandboxConfig {
  image: string;
}

export class ContextBuilder {
  static BOOTSTRAP_FILES = ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"];

  workspace: string;
  effectiveWorkspace: string;
  dockerSandbox?: DockerSandboxConfig;
  memory: MemoryStore;
  skills: SkillsLoader;

  constructor(opts: {
    workspace: string;
    containerWorkspace?: string;
    pathTranslator?: (p: string) => string;
    dockerSandbox?: DockerSandboxConfig;
  }) {
    this.workspace = opts.workspace;
    this.effectiveWorkspace =
      opts.containerWorkspace ?? path.resolve(opts.workspace.replace(/^~/, os.homedir()));
    this.dockerSandbox = opts.dockerSandbox;
    this.memory = new MemoryStore(opts.workspace, opts.containerWorkspace);
    this.skills = new SkillsLoader({
      workspace: opts.workspace,
      containerWorkspace: opts.containerWorkspace,
      pathTranslator: opts.pathTranslator,
    });
  }

  buildSystemPrompt(skillNames?: string[]): string {
    const parts: string[] = [];

    parts.push(this.getIdentity());

    const bootstrap = this.loadBootstrapFiles();
    if (bootstrap) parts.push(bootstrap);

    const memoryCtx = this.memory.getMemoryContext();
    if (memoryCtx) parts.push(`# Memory\n\n${memoryCtx}`);

    const alwaysSkills = this.skills.getAlwaysSkills();
    if (alwaysSkills.length > 0) {
      const alwaysContent = this.skills.loadSkillsForContext(alwaysSkills);
      if (alwaysContent) parts.push(`# Active Skills\n\n${alwaysContent}`);
    }

    const skillsSummary = this.skills.buildSkillsSummary();
    if (skillsSummary) {
      parts.push(
        `# Skills\n\nThe following skills extend your capabilities. ` +
          `To use a skill, read its SKILL.md file using the read_file tool.\n` +
          `Skills with available="false" need dependencies installed first - ` +
          `you can try installing them with apt/brew.\n\n${skillsSummary}`
      );
    }

    return parts.join("\n\n---\n\n");
  }

  private getIdentity(): string {
    const now = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "long",
    });
    const workspacePath = this.effectiveWorkspace;
    const runtime = this.dockerSandbox
      ? runtimeFromImage(this.dockerSandbox.image)
      : `${process.platform === "darwin" ? "macOS" : process.platform} ${process.arch}, Node.js ${process.version}`;
    const homePath = this.dockerSandbox ? "/root" : os.homedir();

    return `# seclaw 🦾

You are seclaw, a helpful AI assistant. You have access to tools that allow you to:
- Read, write, and edit files
- Execute shell commands
- Search the web and fetch web pages
- Send messages to users on chat channels
- Spawn subagents for complex background tasks

You have been deployed on the user's personal computer and have permission to access the user's machine. You should utilize the provided tools to help the user accomplish their tasks.

## Current Time
${now}

## Runtime
${runtime}

## HOME
$HOME is at: ${homePath}

## Workspace
Your workspace is at: ${workspacePath}
- Memory files: ${workspacePath}/memory/MEMORY.md
- Daily notes: ${workspacePath}/memory/YYYY-MM-DD.md
- Custom skills: ${workspacePath}/skills/{skill-name}/SKILL.md

IMPORTANT: When responding to direct questions or conversations, reply directly with your text response.
Only use the 'message' tool when you need to send a message to a specific chat channel (like WhatsApp).
For normal conversation, just respond with text - do not call the message tool.

Always be helpful, accurate, and concise. When using tools, explain what you're doing.
When remembering something, write to ${workspacePath}/memory/MEMORY.md`;
  }

  private loadBootstrapFiles(): string {
    const parts: string[] = [];
    for (const filename of ContextBuilder.BOOTSTRAP_FILES) {
      const filePath = path.join(this.workspace, filename);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        parts.push(`## ${filename}\n\n${content}`);
      }
    }
    return parts.join("\n\n");
  }

  buildMessages(opts: {
    history: Record<string, unknown>[];
    currentMessage: string;
    skillNames?: string[];
    media?: string[];
    channel?: string;
    chatId?: string;
  }): Record<string, unknown>[] {
    const { history, currentMessage, media, channel, chatId } = opts;
    const messages: Record<string, unknown>[] = [];

    let systemPrompt = this.buildSystemPrompt(opts.skillNames);
    if (channel && chatId) {
      systemPrompt += `\n\n## Current Session\nChannel: ${channel}\nChat ID: ${chatId}`;
    }
    messages.push({ role: "system", content: systemPrompt });
    messages.push(...history);

    const userContent = this.buildUserContent(currentMessage, media);
    messages.push({ role: "user", content: userContent });

    return messages;
  }

  private buildUserContent(
    text: string,
    media?: string[]
  ): string | Record<string, unknown>[] {
    if (!media || media.length === 0) return text;

    const images: Record<string, unknown>[] = [];
    for (const filePath of media) {
      const mimeType = mime.lookup(filePath) || "";
      if (!fs.existsSync(filePath) || !mimeType.startsWith("image/")) continue;
      const b64 = fs.readFileSync(filePath).toString("base64");
      images.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } });
    }
    if (images.length === 0) return text;
    return [...images, { type: "text", text }];
  }

  addToolResult(
    messages: Record<string, unknown>[],
    toolCallId: string,
    toolName: string,
    result: string
  ): Record<string, unknown>[] {
    messages.push({ role: "tool", tool_call_id: toolCallId, name: toolName, content: result });
    return messages;
  }

  addAssistantMessage(
    messages: Record<string, unknown>[],
    content: string | null,
    toolCalls?: Record<string, unknown>[],
    reasoningContent?: string
  ): Record<string, unknown>[] {
    const msg: Record<string, unknown> = { role: "assistant", content: content ?? "" };
    if (toolCalls) msg["tool_calls"] = toolCalls;
    if (reasoningContent) msg["reasoning_content"] = reasoningContent;
    messages.push(msg);
    return messages;
  }
}

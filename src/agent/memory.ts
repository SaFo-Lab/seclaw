/**
 * Memory system
 */

import * as fs from "fs";
import * as path from "path";
import { ensureDir, todayDate } from "../utils/helpers";

export class MemoryStore {
  workspace: string;
  memoryDir: string;
  memoryFile: string;
  containerWorkspace?: string;

  constructor(workspace: string, containerWorkspace?: string) {
    this.workspace = workspace;
    this.memoryDir = ensureDir(path.join(workspace, "memory"));
    this.memoryFile = path.join(this.memoryDir, "MEMORY.md");
    this.containerWorkspace = containerWorkspace;
  }

  get containerMemoryDir(): string {
    return this.containerWorkspace ? `${this.containerWorkspace}/memory` : this.memoryDir;
  }

  getTodayFile(): string {
    return path.join(this.memoryDir, `${todayDate()}.md`);
  }

  readToday(): string {
    const todayFile = this.getTodayFile();
    return fs.existsSync(todayFile) ? fs.readFileSync(todayFile, "utf-8") : "";
  }

  appendToday(content: string): void {
    const todayFile = this.getTodayFile();
    let final = content;
    if (fs.existsSync(todayFile)) {
      final = fs.readFileSync(todayFile, "utf-8") + "\n" + content;
    } else {
      final = `# ${todayDate()}\n\n` + content;
    }
    fs.writeFileSync(todayFile, final, "utf-8");
  }

  readLongTerm(): string {
    return fs.existsSync(this.memoryFile) ? fs.readFileSync(this.memoryFile, "utf-8") : "";
  }

  writeLongTerm(content: string): void {
    fs.writeFileSync(this.memoryFile, content, "utf-8");
  }

  appendHistory(entry: string): void {
    const historyFile = path.join(this.memoryDir, "HISTORY.md");
    let content: string;
    if (fs.existsSync(historyFile)) {
      content = fs.readFileSync(historyFile, "utf-8") + "\n" + entry;
    } else {
      content = "# Conversation History\n\n" + entry;
    }
    fs.writeFileSync(historyFile, content, "utf-8");
  }

  getRecentMemories(days = 7): string {
    const memories: string[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const filePath = path.join(this.memoryDir, `${dateStr}.md`);
      if (fs.existsSync(filePath)) {
        memories.push(fs.readFileSync(filePath, "utf-8"));
      }
    }
    return memories.join("\n\n---\n\n");
  }

  listMemoryFiles(): string[] {
    if (!fs.existsSync(this.memoryDir)) return [];
    return fs
      .readdirSync(this.memoryDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .map((f) => path.join(this.memoryDir, f));
  }

  getMemoryContext(): string {
    const parts: string[] = [];
    const longTerm = this.readLongTerm();
    if (longTerm) parts.push("## Long-term Memory\n" + longTerm);
    const today = this.readToday();
    if (today) parts.push("## Today's Notes\n" + today);
    return parts.join("\n\n");
  }
}

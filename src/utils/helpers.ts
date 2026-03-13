/**
 * Utility functions
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export function ensureDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function getDataPath(): string {
  return ensureDir(path.join(os.homedir(), ".seclaw"));
}

export function getWorkspacePath(workspace?: string): string {
  if (workspace) {
    const p = workspace.startsWith("~")
      ? path.join(os.homedir(), workspace.slice(1))
      : workspace;
    return ensureDir(p);
  }
  return ensureDir(path.join(os.homedir(), ".seclaw", "workspace"));
}

export function getSessionsPath(): string {
  return ensureDir(path.join(getDataPath(), "sessions"));
}

export function getMemoryPath(workspace?: string): string {
  const ws = workspace ?? getWorkspacePath();
  return ensureDir(path.join(ws, "memory"));
}

export function getSkillsPath(workspace?: string): string {
  const ws = workspace ?? getWorkspacePath();
  return ensureDir(path.join(ws, "skills"));
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function truncateString(s: string, maxLen = 100, suffix = "..."): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - suffix.length) + suffix;
}

export function safeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}

export function parseSessionKey(key: string): [string, string] {
  const idx = key.indexOf(":");
  if (idx === -1) throw new Error(`Invalid session key: ${key}`);
  return [key.slice(0, idx), key.slice(idx + 1)];
}

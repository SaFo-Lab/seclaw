/**
 * Session management
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { logger } from "../utils/logger";
import { ensureDir, safeFilename } from "../utils/helpers";

export interface Message {
  role: string;
  content: unknown;
  timestamp?: string;
  [key: string]: unknown;
}

export interface Session {
  key: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
  lastConsolidated: number;
}

export function createSession(key: string): Session {
  return {
    key,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
    lastConsolidated: 0,
  };
}

export function addMessage(
  session: Session,
  role: string,
  content: unknown,
  extra: Record<string, unknown> = {}
): void {
  session.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
    ...extra,
  });
  session.updatedAt = new Date();
}

export function getHistory(session: Session, maxMessages = 500): Message[] {
  return session.messages
    .slice(-maxMessages)
    .map((m) => ({ role: m.role, content: m.content }));
}

export function clearSession(session: Session): void {
  session.messages = [];
  session.lastConsolidated = 0;
  session.updatedAt = new Date();
}

// ─── SessionManager ───────────────────────────────────────────────────────────

export class SessionManager {
  workspace: string;
  sessionsDir: string;
  private _cache = new Map<string, Session>();

  constructor(workspace: string) {
    this.workspace = workspace;
    this.sessionsDir = ensureDir(path.join(os.homedir(), ".seclaw", "sessions"));
  }

  private _getSessionPath(key: string): string {
    const safeKey = safeFilename(key.replace(":", "_"));
    return path.join(this.sessionsDir, `${safeKey}.jsonl`);
  }

  getOrCreate(key: string): Session {
    const cached = this._cache.get(key);
    if (cached) return cached;

    const session = this._load(key) ?? createSession(key);
    this._cache.set(key, session);
    return session;
  }

  private _load(key: string): Session | null {
    const p = this._getSessionPath(key);
    if (!fs.existsSync(p)) return null;

    try {
      const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
      const messages: Message[] = [];
      let metadata: Record<string, unknown> = {};
      let createdAt: Date | null = null;
      let lastConsolidated = 0;

      for (const line of lines) {
        const data = JSON.parse(line) as Record<string, unknown>;
        if (data["_type"] === "metadata") {
          metadata = (data["metadata"] as Record<string, unknown>) ?? {};
          createdAt = data["createdAt"]
            ? new Date(data["createdAt"] as string)
            : null;
          lastConsolidated = (data["lastConsolidated"] as number) ?? 0;
        } else {
          messages.push(data as Message);
        }
      }

      return {
        key,
        messages,
        createdAt: createdAt ?? new Date(),
        updatedAt: new Date(),
        metadata,
        lastConsolidated,
      };
    } catch (e) {
      logger.warn({ err: e, key }, "Failed to load session");
      return null;
    }
  }

  save(session: Session): void {
    const p = this._getSessionPath(session.key);
    const lines: string[] = [];

    const metaLine = {
      _type: "metadata",
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      metadata: session.metadata,
      lastConsolidated: session.lastConsolidated,
    };
    lines.push(JSON.stringify(metaLine));
    for (const msg of session.messages) {
      lines.push(JSON.stringify(msg));
    }

    fs.writeFileSync(p, lines.join("\n") + "\n");
    this._cache.set(session.key, session);
  }

  invalidate(key: string): void {
    this._cache.delete(key);
  }

  delete(key: string): boolean {
    this._cache.delete(key);
    const p = this._getSessionPath(key);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      return true;
    }
    return false;
  }

  listSessions(): Array<Record<string, string>> {
    const sessions: Array<Record<string, string>> = [];

    for (const file of fs.readdirSync(this.sessionsDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const p = path.join(this.sessionsDir, file);
      try {
        const firstLine = fs.readFileSync(p, "utf8").split("\n")[0];
        if (firstLine) {
          const data = JSON.parse(firstLine) as Record<string, unknown>;
          if (data["_type"] === "metadata") {
            sessions.push({
              key: path.basename(file, ".jsonl").replace("_", ":"),
              createdAt: (data["createdAt"] as string) ?? "",
              updatedAt: (data["updatedAt"] as string) ?? "",
              path: p,
            });
          }
        }
      } catch {
        continue;
      }
    }

    return sessions.sort((a, b) =>
      (b["updatedAt"] ?? "").localeCompare(a["updatedAt"] ?? "")
    );
  }
}

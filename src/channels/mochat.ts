/**
 * Mochat channel
 *
 * Connects to a Mochat server via Socket.IO (or HTTP polling fallback).
 * Requires: socket.io-client
 */

import * as fs from "fs";
import * as path from "path";
import logger from "../utils/logger";
import { OutboundMessage } from "../bus/events";
import { MessageBus } from "../bus/queue";
import { BaseChannel } from "./base";

interface MochatConfig {
  enabled?: boolean;
  baseUrl?: string;
  token?: string;
  agentId?: string;
  allowFrom?: string[];
  bufferWindowMs?: number;
  [key: string]: unknown;
}

const MAX_SEEN_IDS = 2000;

export class MochatChannel extends BaseChannel {
  readonly name = "mochat";
  private mochatConfig: MochatConfig;
  private socket?: unknown; // socket.io-client Socket
  private seenIds: string[] = [];
  private bufferByUser: Map<string, { entries: string[]; timer?: NodeJS.Timeout }> = new Map();
  private cursorPath?: string;
  private cursor?: number;

  constructor(config: MochatConfig, bus: MessageBus) {
    super(config as Record<string, unknown>, bus);
    this.mochatConfig = config;
  }

  async start(): Promise<void> {
    let ioConnect: unknown;
    try {
      const sio = require("socket.io-client");
      ioConnect = sio.io ?? sio;
    } catch {
      logger.error("socket.io-client not installed. Run: npm install socket.io-client");
      return;
    }

    if (!this.mochatConfig.baseUrl) {
      logger.error("Mochat baseUrl not configured");
      return;
    }

    this.running = true;
    this._loadCursor();

    await this._connectSocket(ioConnect as (url: string, opts: Record<string, unknown>) => unknown);

    // Keep alive
    while (this.running) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.socket) {
      (this.socket as { disconnect: () => void }).disconnect();
    }
    logger.info("Mochat channel stopped");
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.mochatConfig.baseUrl) return;

    try {
      const axios = require("axios");
      const url = `${this.mochatConfig.baseUrl}/api/v1/messages`;
      await axios.post(
        url,
        { content: msg.content, user_id: msg.chatId, agent_id: this.mochatConfig.agentId },
        {
          headers: {
            Authorization: `Bearer ${this.mochatConfig.token ?? ""}`,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (e) {
      logger.error(`Mochat send error: ${e}`);
    }
  }

  private async _connectSocket(
    ioConnect: (url: string, opts: Record<string, unknown>) => unknown
  ): Promise<void> {
    const socket = ioConnect(this.mochatConfig.baseUrl!, {
      extraHeaders: { Authorization: `Bearer ${this.mochatConfig.token ?? ""}` },
      transports: ["websocket", "polling"],
      reconnection: true,
    }) as {
      on: (event: string, cb: (...args: unknown[]) => void) => void;
      disconnect: () => void;
    };

    this.socket = socket;

    socket.on("connect", () => {
      logger.info("Connected to Mochat server");
    });

    socket.on("disconnect", () => {
      logger.warn("Disconnected from Mochat server");
    });

    socket.on("message", async (data: unknown) => {
      await this._onMessage(data as Record<string, unknown>);
    });

    socket.on("new_message", async (data: unknown) => {
      await this._onMessage(data as Record<string, unknown>);
    });

    socket.on("error", (e: unknown) => {
      logger.error(`Mochat socket error: ${e}`);
    });
  }

  private async _onMessage(data: Record<string, unknown>): Promise<void> {
    try {
      const messageId =
        (data["id"] as string) ??
        (data["message_id"] as string) ??
        JSON.stringify(data).slice(0, 64);

      // Dedup
      if (this.seenIds.includes(messageId)) return;
      this.seenIds.push(messageId);
      if (this.seenIds.length > MAX_SEEN_IDS) this.seenIds.shift();

      const senderId =
        (data["author"] as string) ??
        ((data["user"] as Record<string, unknown>)?.["id"] as string) ??
        "unknown";
      const content =
        (data["content"] as string) ?? (data["text"] as string) ?? "";

      if (!content.trim()) return;

      const windowMs = this.mochatConfig.bufferWindowMs ?? 0;

      if (windowMs > 0) {
        await this._bufferMessage(senderId, content, windowMs);
      } else {
        await this.handleMessage({ senderId, chatId: senderId, content });
      }
    } catch (e) {
      logger.error(`Mochat message handler error: ${e}`);
    }
  }

  private async _bufferMessage(
    userId: string,
    content: string,
    windowMs: number
  ): Promise<void> {
    let state = this.bufferByUser.get(userId);
    if (!state) {
      state = { entries: [] };
      this.bufferByUser.set(userId, state);
    }
    state.entries.push(content);

    if (state.timer) clearTimeout(state.timer);

    state.timer = setTimeout(async () => {
      const combined = state!.entries.join("\n");
      state!.entries = [];
      await this.handleMessage({ senderId: userId, chatId: userId, content: combined });
    }, windowMs);
  }

  private _loadCursor(): void {
    if (!this.mochatConfig.baseUrl) return;
    try {
      const home = process.env["HOME"] ?? "/tmp";
      this.cursorPath = path.join(home, ".seclaw", "mochat_cursor.json");
      if (fs.existsSync(this.cursorPath)) {
        const data = JSON.parse(fs.readFileSync(this.cursorPath, "utf-8"));
        this.cursor = data["cursor"] as number;
      }
    } catch (_) {}
  }

  private _saveCursor(cursor: number): void {
    if (!this.cursorPath) return;
    try {
      fs.mkdirSync(path.dirname(this.cursorPath), { recursive: true });
      fs.writeFileSync(this.cursorPath, JSON.stringify({ cursor }), "utf-8");
      this.cursor = cursor;
    } catch (_) {}
  }
}

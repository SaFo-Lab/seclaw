/**
 * Discord channel
 *
 * Uses native Discord Gateway WebSocket (no discord.js dependency needed)
 */

import * as https from "https";
import logger from "../utils/logger";
import { OutboundMessage } from "../bus/events";
import { MessageBus } from "../bus/queue";
import { BaseChannel } from "./base";

const DISCORD_API_BASE = "https://discord.com/api/v10";

interface DiscordConfig {
  token?: string;
  gatewayUrl?: string;
  allowFrom?: string[];
  [key: string]: unknown;
}

function httpsRequest(url: string, opts: Record<string, unknown>, body?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, opts as any, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export class DiscordChannel extends BaseChannel {
  readonly name = "discord";
  private discordConfig: DiscordConfig;
  private ws?: any;
  private seq: number | null = null;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(config: DiscordConfig, bus: MessageBus) {
    super(config as Record<string, unknown>, bus);
    this.discordConfig = config;
  }

  async start(): Promise<void> {
    if (!this.discordConfig.token) {
      logger.error("Discord bot token not configured");
      return;
    }
    this.running = true;

    while (this.running) {
      try {
        await this._connectGateway();
      } catch (e) {
        if (!this.running) break;
        logger.warn(`Discord gateway error: ${e}. Reconnecting in 5s...`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = undefined;
    }
  }

  async send(msg: OutboundMessage): Promise<void> {
    const url = new URL(`${DISCORD_API_BASE}/channels/${msg.chatId}/messages`);
    const payload = JSON.stringify({ content: msg.content });

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const response = await httpsRequest(
          url.toString(),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bot ${this.discordConfig.token}`,
              "Content-Length": Buffer.byteLength(payload),
            },
          },
          payload
        );
        const data = JSON.parse(response);
        if (data.retry_after) {
          await new Promise((r) => setTimeout(r, data.retry_after * 1000));
          continue;
        }
        break;
      }
    } catch (e) {
      logger.error(`Error sending Discord message: ${e}`);
    }
  }

  private async _connectGateway(): Promise<void> {
    // Import ws dynamically
    const WebSocket = require("ws");
    const gatewayUrl = this.discordConfig.gatewayUrl ?? "wss://gateway.discord.gg/?v=10&encoding=json";
    this.ws = new WebSocket(gatewayUrl);

    await new Promise<void>((resolve, reject) => {
      this.ws.on("open", () => logger.info("Discord WebSocket connected"));
      this.ws.on("error", (e: Error) => reject(e));
      this.ws.on("close", () => resolve());

      this.ws.on("message", async (data: Buffer) => {
        try {
          const payload = JSON.parse(data.toString());
          await this._handlePayload(payload);
        } catch (e) {
          logger.warn(`Discord JSON parse error: ${e}`);
        }
      });
    });
  }

  private async _handlePayload(payload: Record<string, unknown>): Promise<void> {
    const op = payload["op"] as number;
    const t = payload["t"] as string | null;
    const d = payload["d"] as Record<string, unknown>;
    const s = payload["s"] as number | null;

    if (s !== null) this.seq = s;

    if (op === 10) {
      // HELLO
      const intervalMs = (d["heartbeat_interval"] as number) ?? 45000;
      this.heartbeatInterval = setInterval(() => {
        if (this.ws) {
          this.ws.send(JSON.stringify({ op: 1, d: this.seq }));
        }
      }, intervalMs);
      // IDENTIFY
      this.ws.send(
        JSON.stringify({
          op: 2,
          d: {
            token: this.discordConfig.token,
            intents: 33280, // GUILD_MESSAGES + DIRECT_MESSAGES + MESSAGE_CONTENT
            properties: { os: "linux", browser: "seclaw", device: "seclaw" },
          },
        })
      );
    } else if (op === 0 && t === "READY") {
      logger.info("Discord gateway READY");
    } else if (op === 0 && t === "MESSAGE_CREATE") {
      await this._handleMessageCreate(d);
    } else if (op === 7 || op === 9) {
      if (this.ws) this.ws.close();
    }
  }

  private async _handleMessageCreate(data: Record<string, unknown>): Promise<void> {
    const author = (data["author"] ?? {}) as Record<string, unknown>;
    if (author["bot"]) return;

    const channelId = String(data["channel_id"] ?? "");
    const content = String(data["content"] ?? "");
    const userId = String(author["id"] ?? "");
    const username = String(author["username"] ?? userId);

    if (!content.trim()) return;

    await this.handleMessage({ senderId: username, chatId: channelId, content });
  }
}

/**
 * QQ channel
 *
 * Uses QQ Open Platform WebSocket Gateway to receive events.
 * Sends replies via the QQ Bot REST API (C2C and group messages).
 * Requires: ws
 */

import * as https from "https";
import WebSocket from "ws";
import logger from "../utils/logger";
import { OutboundMessage } from "../bus/events";
import { MessageBus } from "../bus/queue";
import { BaseChannel } from "./base";

interface QQConfig {
  enabled?: boolean;
  appId?: string;
  secret?: string;
  allowFrom?: string[];
  [key: string]: unknown;
}

const QQ_API = "api.sgroup.qq.com";
const QQ_AUTH = "bots.qq.com";

export class QQChannel extends BaseChannel {
  readonly name = "qq";
  private qqConfig: QQConfig;
  private accessToken?: string;
  private tokenExpiry = 0;
  private ws?: WebSocket;
  private heartbeatInterval?: NodeJS.Timeout;
  private sessionId?: string;
  private lastSeq = 0;
  private processedIds: Set<string> = new Set();

  constructor(config: QQConfig, bus: MessageBus) {
    super(config as Record<string, unknown>, bus);
    this.qqConfig = config;
  }

  async start(): Promise<void> {
    if (!this.qqConfig.appId || !this.qqConfig.secret) {
      logger.error("QQ appId and secret not configured");
      return;
    }

    this.running = true;
    logger.info("QQ channel starting...");

    while (this.running) {
      try {
        await this._connect();
      } catch (e) {
        logger.warn(`QQ connection error: ${e}`);
      }
      if (this.running) {
        logger.info("QQ reconnecting in 5s...");
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.ws?.close();
    logger.info("QQ channel stopped");
  }

  async send(msg: OutboundMessage): Promise<void> {
    try {
      const token = await this._getAccessToken();
      if (!token) return;

      // Try C2C message (user:openid format in chatId)
      const [type, openId] = msg.chatId.includes(":") ? msg.chatId.split(":") : ["c2c", msg.chatId];
      const body = JSON.stringify({ content: msg.content, msg_type: 0 });

      const apiPath =
        type === "group"
          ? `/v2/groups/${openId}/messages`
          : `/v2/users/${openId}/messages`;

      await this._apiPost(apiPath, body, token);
    } catch (e) {
      logger.error(`QQ send error: ${e}`);
    }
  }

  private async _connect(): Promise<void> {
    const token = await this._getAccessToken();
    if (!token) return;

    // Get gateway URL
    const gatewayResp = await this._apiGet("/gateway/bot", token);
    const gatewayData = JSON.parse(gatewayResp);
    const wsUrl = (gatewayData["url"] as string) ?? "wss://api.sgroup.qq.com/websocket";

    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.on("message", async (raw: WebSocket.RawData) => {
        try {
          await this._handleGatewayEvent(JSON.parse(raw.toString()));
        } catch (_) {}
      });

      ws.on("close", () => {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        logger.warn("QQ gateway disconnected");
        resolve();
      });

      ws.on("error", (e: Error) => {
        logger.error(`QQ WS error: ${e}`);
        ws.terminate();
        resolve();
      });
    });
  }

  private async _handleGatewayEvent(payload: Record<string, unknown>): Promise<void> {
    const op = payload["op"] as number;
    const s = payload["s"] as number | undefined;
    if (s) this.lastSeq = s;

    if (op === 10) {
      // Hello - start heartbeat
      const heartbeatInterval = (payload["d"] as Record<string, unknown>)?.["heartbeat_interval"] as number ?? 45000;
      this.heartbeatInterval = setInterval(() => {
        this.ws?.send(JSON.stringify({ op: 1, d: this.lastSeq || null }));
      }, heartbeatInterval);
      // Identify
      const token = await this._getAccessToken();
      this.ws?.send(
        JSON.stringify({
          op: 2,
          d: {
            token: `QQBot ${token}`,
            intents: (1 << 25) | (1 << 12), // C2C_MESSAGE_CREATE | DIRECT_MESSAGE
            shard: [0, 1],
          },
        })
      );
    } else if (op === 0) {
      const t = payload["t"] as string;
      const d = payload["d"] as Record<string, unknown>;
      if (t === "C2C_MESSAGE_CREATE" || t === "DIRECT_MESSAGE_CREATE") {
        await this._onMessage(d, t);
      } else if (t === "READY") {
        this.sessionId = (d?.["session_id"] as string);
        logger.info(`QQ bot ready: ${(d?.["user"] as Record<string, unknown>)?.["username"]}`);
      }
    } else if (op === 7) {
      // Reconnect
      this.ws?.close();
    } else if (op === 9) {
      // Invalid session
      logger.warn("QQ invalid session");
      this.ws?.close();
    }
  }

  private async _onMessage(d: Record<string, unknown>, eventType: string): Promise<void> {
    const msgId = d["id"] as string;
    if (msgId && this.processedIds.has(msgId)) return;
    if (msgId) {
      this.processedIds.add(msgId);
      if (this.processedIds.size > 1000) {
        const first = this.processedIds.values().next().value;
        if (first !== undefined) this.processedIds.delete(first);
      }
    }

    const author = d["author"] as Record<string, unknown>;
    const senderId = (author?.["user_openid"] as string) ?? (author?.["id"] as string) ?? "unknown";
    const content = ((d["content"] as string) ?? "").trim();
    if (!content) return;

    const chatType = eventType === "C2C_MESSAGE_CREATE" ? "c2c" : "group";
    const chatId =
      eventType === "C2C_MESSAGE_CREATE"
        ? `c2c:${senderId}`
        : `group:${(d["group_openid"] as string) ?? senderId}`;

    await this.handleMessage({ senderId, chatId, content });
  }

  private async _getAccessToken(): Promise<string | undefined> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;
    try {
      const body = JSON.stringify({
        appId: this.qqConfig.appId,
        clientSecret: this.qqConfig.secret,
      });
      const respBody = await new Promise<string>((resolve, reject) => {
        const req = https.request(
          {
            hostname: QQ_AUTH,
            path: "/app/getAppAccessToken",
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => resolve(data));
          }
        );
        req.on("error", reject);
        req.write(body);
        req.end();
      });
      const parsed = JSON.parse(respBody);
      this.accessToken = parsed["access_token"] as string;
      this.tokenExpiry =
        Date.now() + parseInt(parsed["expires_in"] as string, 10) * 1000 - 60000;
      return this.accessToken;
    } catch (e) {
      logger.error(`QQ access token error: ${e}`);
      return undefined;
    }
  }

  private _apiGet(path: string, token: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: QQ_API,
          path,
          method: "GET",
          headers: { Authorization: `QQBot ${token}`, "Content-Type": "application/json" },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve(data));
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  private _apiPost(path: string, body: string, token: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: QQ_API,
          path,
          method: "POST",
          headers: {
            Authorization: `QQBot ${token}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve(data));
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

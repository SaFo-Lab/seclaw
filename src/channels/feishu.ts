/**
 * Feishu/Lark channel
 *
 * Uses the Lark Open Platform WebSocket long connection (no public IP required).
 * Requires: @larksuiteoapi/node-sdk
 */

import logger from "../utils/logger";
import { OutboundMessage } from "../bus/events";
import { MessageBus } from "../bus/queue";
import { BaseChannel } from "./base";

interface FeishuConfig {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  allowFrom?: string[];
  [key: string]: unknown;
}

export class FeishuChannel extends BaseChannel {
  readonly name = "feishu";
  private feishuConfig: FeishuConfig;
  private client?: unknown; // lark.Client
  private wsClient?: { start: () => void; stop?: () => void };
  private processedIds: Set<string> = new Set();

  constructor(config: FeishuConfig, bus: MessageBus) {
    super(config as Record<string, unknown>, bus);
    this.feishuConfig = config;
  }

  async start(): Promise<void> {
    let lark: unknown;
    try {
      lark = require("@larksuiteoapi/node-sdk");
    } catch {
      logger.error("Feishu SDK not installed. Run: npm install @larksuiteoapi/node-sdk");
      return;
    }

    if (!this.feishuConfig.appId || !this.feishuConfig.appSecret) {
      logger.error("Feishu appId and appSecret not configured");
      return;
    }

    this.running = true;

    this.client = new (lark as any).Client({
      appId: this.feishuConfig.appId,
      appSecret: this.feishuConfig.appSecret,
      loggerLevel: (lark as any).LoggerLevel.info,
    });

    const dispatcher = new (lark as any).EventDispatcher({
      encryptKey: this.feishuConfig.encryptKey ?? "",
    }).register({
      "im.message.receive_v1": async (data: unknown) => {
        await this._onMessage(data as Record<string, unknown>);
      },
    });

    this.wsClient = new (lark as any).WsClient({ appId: this.feishuConfig.appId, appSecret: this.feishuConfig.appSecret });
    (this.wsClient as any).start({ dispatcher });

    logger.info("Feishu bot started (WebSocket long connection)");

    while (this.running) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info("Feishu channel stopped");
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.client) {
      logger.warn("Feishu client not initialized");
      return;
    }
    try {
      const lark = require("@larksuiteoapi/node-sdk");
      await (this.client as any).im.message.create({
        params: { receive_id_type: "open_id" },
        data: {
          receive_id: msg.chatId,
          msg_type: "text",
          content: JSON.stringify({ text: msg.content }),
        },
      });
    } catch (e) {
      logger.error(`Feishu send error: ${e}`);
    }
  }

  private async _onMessage(data: Record<string, unknown>): Promise<void> {
    try {
      const message = (data["message"] as Record<string, unknown>) ?? {};
      const messageId: string = (message["message_id"] as string) ?? "";
      if (messageId && this.processedIds.has(messageId)) return;
      if (messageId) this.processedIds.add(messageId);

      const sender = (data["sender"] as Record<string, unknown>) ?? {};
      const senderId = (sender["sender_id"] as Record<string, unknown>)?.["open_id"] as string ?? "";
      const msgType = (message["message_type"] as string) ?? "text";
      let content = "";

      if (msgType === "text") {
        const body = JSON.parse((message["content"] as string) ?? "{}");
        content = body["text"] ?? "";
      } else {
        content = `[${msgType}]`;
      }

      await this.handleMessage({ senderId, chatId: senderId, content });
    } catch (e) {
      logger.error(`Feishu message error: ${e}`);
    }
  }
}

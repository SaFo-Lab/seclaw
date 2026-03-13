/**
 * DingTalk channel
 *
 * Uses DingTalk Stream Mode (WebSocket) to receive events.
 * Sends replies via DingTalk HTTP API.
 * Requires: dingtalk-stream (npm package, if available)
 */

import * as https from "https";
import logger from "../utils/logger";
import { OutboundMessage } from "../bus/events";
import { MessageBus } from "../bus/queue";
import { BaseChannel } from "./base";

interface DingTalkConfig {
  enabled?: boolean;
  appKey?: string;
  appSecret?: string;
  allowFrom?: string[];
  [key: string]: unknown;
}

export class DingTalkChannel extends BaseChannel {
  readonly name = "dingtalk";
  private dtConfig: DingTalkConfig;
  private accessToken?: string;
  private tokenExpiry = 0;

  constructor(config: DingTalkConfig, bus: MessageBus) {
    super(config as Record<string, unknown>, bus);
    this.dtConfig = config;
  }

  async start(): Promise<void> {
    // Try to use @open-dingtalk/nodejs-sdk if available
    let DingTalkStream: unknown;
    try {
      DingTalkStream = require("@open-dingtalk/nodejs-sdk");
    } catch {
      logger.error("DingTalk SDK not installed. Run: npm install @open-dingtalk/nodejs-sdk");
      return;
    }

    if (!this.dtConfig.appKey || !this.dtConfig.appSecret) {
      logger.error("DingTalk appKey and appSecret not configured");
      return;
    }

    this.running = true;

    try {
      const sdk = DingTalkStream as Record<string, unknown>;
      const DWClient = sdk["DWClient"] as new (opts: Record<string, unknown>) => {
        registerCallbackListener: (topic: string, handler: (ctx: unknown) => Promise<void>) => void;
        start: () => Promise<void>;
      };

      const client = new DWClient({
        clientId: this.dtConfig.appKey,
        clientSecret: this.dtConfig.appSecret,
      });

      client.registerCallbackListener("/v1.0/im/bot/messages/get", async (ctx: unknown) => {
        await this._onMessage(ctx as Record<string, unknown>);
      });

      logger.info("DingTalk channel starting (Stream Mode)...");
      await client.start();
    } catch (e) {
      logger.error(`DingTalk Stream error: ${e}`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info("DingTalk channel stopped");
  }

  async send(msg: OutboundMessage): Promise<void> {
    try {
      const token = await this._getAccessToken();
      if (!token) return;

      const body = JSON.stringify({
        msgParam: JSON.stringify({ content: msg.content }),
        msgKey: "sampleText",
        openConversationId: msg.chatId,
      });

      await new Promise<void>((resolve, reject) => {
        const req = https.request(
          {
            hostname: "api.dingtalk.com",
            path: "/v1.0/im/messages/send",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-acs-dingtalk-access-token": token,
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve());
          }
        );
        req.on("error", reject);
        req.write(body);
        req.end();
      });
    } catch (e) {
      logger.error(`DingTalk send error: ${e}`);
    }
  }

  private async _getAccessToken(): Promise<string | undefined> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;

    try {
      const body = JSON.stringify({
        appKey: this.dtConfig.appKey,
        appSecret: this.dtConfig.appSecret,
      });

      const respBody = await new Promise<string>((resolve, reject) => {
        const req = https.request(
          {
            hostname: "api.dingtalk.com",
            path: "/v1.0/oauth2/accessToken",
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
      this.accessToken = parsed["accessToken"] as string;
      this.tokenExpiry = Date.now() + (parsed["expireIn"] as number) * 1000 - 60000;
      return this.accessToken;
    } catch (e) {
      logger.error(`DingTalk token error: ${e}`);
      return undefined;
    }
  }

  private async _onMessage(ctx: Record<string, unknown>): Promise<void> {
    try {
      const data = (ctx["message"] as Record<string, unknown>) ?? ctx;
      const text =
        (data["text"] as Record<string, unknown>)?.["content"]?.toString().trim() ?? "";
      const senderId =
        (data["senderStaffId"] as string) ?? (data["senderId"] as string) ?? "unknown";
      const senderName = (data["senderNick"] as string) ?? "Unknown";

      if (!text) return;
      logger.info(`DingTalk message from ${senderName} (${senderId}): ${text}`);
      await this.handleMessage({ senderId, chatId: senderId, content: text });
    } catch (e) {
      logger.error(`DingTalk message handler error: ${e}`);
    }
  }
}

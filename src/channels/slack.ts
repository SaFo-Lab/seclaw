/**
 * Slack channel
 */

import { WebClient } from "@slack/web-api";
import { SocketModeClient } from "@slack/socket-mode";
import logger from "../utils/logger";
import { OutboundMessage } from "../bus/events";
import { MessageBus } from "../bus/queue";
import { BaseChannel } from "./base";

interface SlackConfig {
  botToken?: string;
  appToken?: string;
  mode?: string;
  allowFrom?: string[];
  [key: string]: unknown;
}

export class SlackChannel extends BaseChannel {
  readonly name = "slack";
  private slackConfig: SlackConfig;
  private webClient?: WebClient;
  private socketClient?: SocketModeClient;
  private botUserId?: string;

  constructor(config: SlackConfig, bus: MessageBus) {
    super(config as Record<string, unknown>, bus);
    this.slackConfig = config;
  }

  async start(): Promise<void> {
    if (!this.slackConfig.botToken || !this.slackConfig.appToken) {
      logger.error("Slack bot/app token not configured");
      return;
    }
    this.running = true;

    this.webClient = new WebClient(this.slackConfig.botToken);
    this.socketClient = new SocketModeClient({
      appToken: this.slackConfig.appToken,
    });

    try {
      const auth = await this.webClient.auth.test();
      this.botUserId = auth.user_id as string | undefined;
      logger.info(`Slack bot connected as ${this.botUserId}`);
    } catch (e) {
      logger.warn(`Slack auth_test failed: ${e}`);
    }

    this.socketClient.on("message", async (event) => {
      try {
        const body = (event as any).body as Record<string, unknown>;
        await this._onEvent(body);
      } catch (e) {
        logger.error(`Slack event error: ${e}`);
      }
    });

    logger.info("Starting Slack Socket Mode client...");
    await this.socketClient.start();

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!this.running) {
          clearInterval(check);
          resolve();
        }
      }, 1000);
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.socketClient) {
      try {
        await this.socketClient.disconnect();
      } catch (e) {
        logger.warn(`Slack socket disconnect error: ${e}`);
      }
      this.socketClient = undefined;
    }
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.webClient) {
      logger.warn("Slack client not initialized");
      return;
    }
    try {
      const slackMeta = (msg.metadata?.["slack"] as Record<string, unknown> | undefined) ?? {};
      const threadTs = slackMeta["thread_ts"] as string | undefined;
      const channelType = slackMeta["channel_type"] as string | undefined;
      const useThread = threadTs && channelType !== "im";

      await this.webClient.chat.postMessage({
        channel: msg.chatId,
        text: msg.content ?? "",
        thread_ts: useThread ? threadTs : undefined,
      });
    } catch (e) {
      logger.error(`Error sending Slack message: ${e}`);
    }
  }

  private async _onEvent(body: Record<string, unknown>): Promise<void> {
    const event = (body["event"] ?? {}) as Record<string, unknown>;
    if (event["type"] !== "message") return;
    if (event["bot_id"] || event["subtype"]) return;

    const userId = String(event["user"] ?? "");
    if (userId === this.botUserId) return;

    const channelId = String(event["channel"] ?? "");
    const text = String(event["text"] ?? "");
    if (!text.trim()) return;

    const ts = event["ts"] as string | undefined;
    const channelType = event["channel_type"] as string | undefined;

    await this.handleMessage({
      senderId: userId,
      chatId: channelId,
      content: text,
      metadata: { slack: { thread_ts: ts, channel_type: channelType } },
    });
  }
}

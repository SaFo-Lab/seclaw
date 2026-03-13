/**
 * Channel manager
 */

import logger from "../utils/logger";
import { MessageBus } from "../bus/queue";
import { BaseChannel } from "./base";
import type { Config } from "../config/schema";
import type { SessionManager } from "../session/manager";
import { OutboundMessage } from "../bus/events";

export class ChannelManager {
  private config: Config;
  private bus: MessageBus;
  private sessionManager?: SessionManager;
  private channels: Map<string, BaseChannel> = new Map();
  private dispatchRunning = false;

  constructor(config: Config, bus: MessageBus, sessionManager?: SessionManager) {
    this.config = config;
    this.bus = bus;
    this.sessionManager = sessionManager;
    this._initChannels();
  }

  private _initChannels(): void {
    // Telegram
    if (this.config.channels?.telegram?.enabled) {
      try {
        const { TelegramChannel } = require("./telegram");
        this.channels.set(
          "telegram",
          new TelegramChannel(
            this.config.channels.telegram,
            this.bus,
            this.config.providers?.groq?.apiKey ?? "",
            this.sessionManager
          )
        );
        logger.info("Telegram channel enabled");
      } catch (e) {
        logger.warn(`Telegram channel not available: ${e}`);
      }
    }

    // Discord
    if (this.config.channels?.discord?.enabled) {
      try {
        const { DiscordChannel } = require("./discord");
        this.channels.set("discord", new DiscordChannel(this.config.channels.discord, this.bus));
        logger.info("Discord channel enabled");
      } catch (e) {
        logger.warn(`Discord channel not available: ${e}`);
      }
    }

    // Slack
    if (this.config.channels?.slack?.enabled) {
      try {
        const { SlackChannel } = require("./slack");
        this.channels.set("slack", new SlackChannel(this.config.channels.slack, this.bus));
        logger.info("Slack channel enabled");
      } catch (e) {
        logger.warn(`Slack channel not available: ${e}`);
      }
    }

    // Email
    if (this.config.channels?.email?.enabled) {
      try {
        const { EmailChannel } = require("./email");
        this.channels.set("email", new EmailChannel(this.config.channels.email, this.bus));
        logger.info("Email channel enabled");
      } catch (e) {
        logger.warn(`Email channel not available: ${e}`);
      }
    }

    // WhatsApp
    if (this.config.channels?.whatsapp?.enabled) {
      try {
        const { WhatsAppChannel } = require("./whatsapp");
        this.channels.set("whatsapp", new WhatsAppChannel(this.config.channels.whatsapp, this.bus));
        logger.info("WhatsApp channel enabled");
      } catch (e) {
        logger.warn(`WhatsApp channel not available: ${e}`);
      }
    }

    // Feishu
    if (this.config.channels?.feishu?.enabled) {
      try {
        const { FeishuChannel } = require("./feishu");
        this.channels.set("feishu", new FeishuChannel(this.config.channels.feishu, this.bus));
        logger.info("Feishu channel enabled");
      } catch (e) {
        logger.warn(`Feishu channel not available: ${e}`);
      }
    }

    // DingTalk
    if (this.config.channels?.dingtalk?.enabled) {
      try {
        const { DingTalkChannel } = require("./dingtalk");
        this.channels.set("dingtalk", new DingTalkChannel(this.config.channels.dingtalk, this.bus));
        logger.info("DingTalk channel enabled");
      } catch (e) {
        logger.warn(`DingTalk channel not available: ${e}`);
      }
    }

    // Mochat
    if (this.config.channels?.mochat?.enabled) {
      try {
        const { MochatChannel } = require("./mochat");
        this.channels.set("mochat", new MochatChannel(this.config.channels.mochat, this.bus));
        logger.info("Mochat channel enabled");
      } catch (e) {
        logger.warn(`Mochat channel not available: ${e}`);
      }
    }

    // QQ
    if (this.config.channels?.qq?.enabled) {
      try {
        const { QQChannel } = require("./qq");
        this.channels.set("qq", new QQChannel(this.config.channels.qq, this.bus));
        logger.info("QQ channel enabled");
      } catch (e) {
        logger.warn(`QQ channel not available: ${e}`);
      }
    }
  }

  private async _startChannel(name: string, channel: BaseChannel): Promise<void> {
    try {
      await channel.start();
    } catch (e) {
      logger.error(`Failed to start channel ${name}: ${e}`);
    }
  }

  async startAll(): Promise<void> {
    if (this.channels.size === 0) {
      logger.warn("No channels enabled");
      return;
    }

    this.dispatchRunning = true;
    this._dispatchOutbound().catch(() => {});

    const tasks: Promise<void>[] = [];
    for (const [name, channel] of this.channels) {
      logger.info(`Starting ${name} channel...`);
      tasks.push(this._startChannel(name, channel));
    }
    await Promise.allSettled(tasks);
  }

  async stopAll(): Promise<void> {
    logger.info("Stopping all channels...");
    this.dispatchRunning = false;

    for (const [name, channel] of this.channels) {
      try {
        await channel.stop();
        logger.info(`Stopped ${name} channel`);
      } catch (e) {
        logger.error(`Error stopping ${name}: ${e}`);
      }
    }
  }

  private async _dispatchOutbound(): Promise<void> {
    logger.info("Outbound dispatcher started");
    let pending: Promise<OutboundMessage> | null = null;
    while (this.dispatchRunning) {
      try {
        if (!pending) pending = this.bus.consumeOutbound();
        const msg = await Promise.race<OutboundMessage | null>([
          pending.then((m) => { pending = null; return m; }),
          new Promise<null>((res) => setTimeout(() => res(null), 1000)),
        ]);
        if (!msg) continue;

        const channel = this.channels.get(msg.channel);
        if (channel) {
          try {
            await channel.send(msg);
          } catch (e) {
            logger.error(`Error sending to ${msg.channel}: ${e}`);
          }
        } else {
          logger.warn(`Unknown channel: ${msg.channel}`);
        }
      } catch {
        // Continue
      }
    }
  }

  getChannel(name: string): BaseChannel | undefined {
    return this.channels.get(name);
  }

  getStatus(): Record<string, unknown> {
    const status: Record<string, unknown> = {};
    for (const [name, channel] of this.channels) {
      status[name] = { enabled: true };
    }
    return status;
  }

  get enabledChannels(): string[] {
    return [...this.channels.keys()];
  }
}

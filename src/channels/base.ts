/**
 * Base channel
 */

import logger from "../utils/logger";
import { InboundMessage, OutboundMessage, makeInboundMessage } from "../bus/events";
import { MessageBus } from "../bus/queue";

export abstract class BaseChannel {
  static readonly channelName: string = "base";
  readonly name: string = "base";
  protected config: Record<string, unknown>;
  protected bus: MessageBus;
  protected running = false;

  constructor(config: Record<string, unknown>, bus: MessageBus) {
    this.config = config;
    this.bus = bus;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(msg: OutboundMessage): Promise<void>;

  isAllowed(senderId: string): boolean {
    const allowList = (this.config["allowFrom"] ?? this.config["allow_from"]) as string[] | undefined;
    if (!allowList || allowList.length === 0) return true;
    const s = String(senderId);
    if (allowList.includes(s)) return true;
    if (s.includes("|")) {
      for (const part of s.split("|")) {
        if (allowList.includes(part.trim())) return true;
      }
    }
    return false;
  }

  protected async handleMessage(opts: {
    senderId: string;
    chatId: string;
    content: string;
    media?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.isAllowed(opts.senderId)) {
      logger.warn(`${this.name}: sender ${opts.senderId} not in allow list, ignoring`);
      return;
    }
    const msg = makeInboundMessage({
      channel: this.name,
      senderId: opts.senderId,
      chatId: opts.chatId,
      content: opts.content,
      media: opts.media,
      metadata: opts.metadata,
    });
    await this.bus.publishInbound(msg);
  }
}

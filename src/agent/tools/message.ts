/**
 * Message tool
 */

import { Tool } from "./base";
import { OutboundMessage, makeOutboundMessage } from "../../bus/events";

type SendCallback = (msg: OutboundMessage) => Promise<void>;

export class MessageTool extends Tool {
  private sendCallback: SendCallback | null;
  private defaultChannel: string;
  private defaultChatId: string;

  constructor(opts: {
    sendCallback?: SendCallback | null;
    defaultChannel?: string;
    defaultChatId?: string;
  } = {}) {
    super();
    this.sendCallback = opts.sendCallback ?? null;
    this.defaultChannel = opts.defaultChannel ?? "";
    this.defaultChatId = opts.defaultChatId ?? "";
  }

  setContext(channel: string, chatId: string): void {
    this.defaultChannel = channel;
    this.defaultChatId = chatId;
  }

  get name(): string { return "message"; }
  get description(): string { return "Send a message to the user. Use this when you want to communicate something."; }
  get parameters() {
    return {
      type: "object" as const,
      properties: {
        content: { type: "string" as const, description: "The message content to send" },
        channel: { type: "string" as const, description: "Optional: target channel" },
        chat_id: { type: "string" as const, description: "Optional: target chat/user ID" },
      },
      required: ["content"],
    };
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const content = params["content"] as string;
    const channel = (params["channel"] as string | undefined) ?? this.defaultChannel;
    const chatId = (params["chat_id"] as string | undefined) ?? this.defaultChatId;

    if (!channel || !chatId) return "Error: No target channel/chat specified";
    if (!this.sendCallback) return "Error: Message sending not configured";

    const msg = makeOutboundMessage({ channel, chatId, content });

    try {
      await this.sendCallback(msg);
      return `Message sent to ${channel}:${chatId}`;
    } catch (e) {
      return `Error sending message: ${String(e)}`;
    }
  }
}

/**
 * Event types for the message bus
 */

export interface InboundMessage {
  /** telegram, discord, slack, whatsapp, etc. */
  channel: string;
  /** User identifier */
  senderId: string;
  /** Chat/channel identifier */
  chatId: string;
  /** Message text */
  content: string;
  timestamp: Date;
  /** Media URLs */
  media: string[];
  /** Channel-specific data */
  metadata: Record<string, unknown>;
}

export function makeInboundMessage(
  opts: Omit<InboundMessage, "timestamp" | "media" | "metadata"> &
    Partial<Pick<InboundMessage, "timestamp" | "media" | "metadata">>
): InboundMessage {
  return {
    timestamp: new Date(),
    media: [],
    metadata: {},
    ...opts,
  };
}

/** Unique key for session identification */
export function sessionKey(msg: InboundMessage): string {
  return `${msg.channel}:${msg.chatId}`;
}

export interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  replyTo?: string;
  media: string[];
  metadata: Record<string, unknown>;
}

export function makeOutboundMessage(
  opts: Omit<OutboundMessage, "media" | "metadata"> &
    Partial<Pick<OutboundMessage, "media" | "metadata">>
): OutboundMessage {
  return {
    media: [],
    metadata: {},
    ...opts,
  };
}

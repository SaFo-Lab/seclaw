/**
 * Async message queue
 */

import { InboundMessage, OutboundMessage } from "./events";
import { logger } from "../utils/logger";

type OutboundHandler = (msg: OutboundMessage) => Promise<void>;

/** Simple promise-based queue */
class AsyncQueue<T> {
  private _items: T[] = [];
  private _waiters: Array<(item: T) => void> = [];

  put(item: T): void {
    const waiter = this._waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this._items.push(item);
    }
  }

  async get(): Promise<T> {
    const item = this._items.shift();
    if (item !== undefined) return item;
    return new Promise<T>((resolve) => {
      this._waiters.push(resolve);
    });
  }

  get size(): number {
    return this._items.length;
  }
}

/**
 * Async message bus that decouples chat channels from the agent core.
 *
 * Channels push messages to the inbound queue, and the agent processes
 * them and pushes responses to the outbound queue.
 */
export class MessageBus {
  private _inbound = new AsyncQueue<InboundMessage>();
  private _outbound = new AsyncQueue<OutboundMessage>();
  private _outboundSubscribers = new Map<string, OutboundHandler[]>();
  private _running = false;

  async publishInbound(msg: InboundMessage): Promise<void> {
    this._inbound.put(msg);
  }

  async consumeInbound(): Promise<InboundMessage> {
    return this._inbound.get();
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    this._outbound.put(msg);
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    return this._outbound.get();
  }

  subscribeOutbound(channel: string, callback: OutboundHandler): void {
    if (!this._outboundSubscribers.has(channel)) {
      this._outboundSubscribers.set(channel, []);
    }
    this._outboundSubscribers.get(channel)!.push(callback);
  }

  /**
   * Dispatch outbound messages to subscribed channels.
   * Run this as a background task.
   */
  async dispatchOutbound(): Promise<void> {
    this._running = true;
    while (this._running) {
      try {
        const msg = await Promise.race([
          this._outbound.get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
        ]);

        if (!msg) continue;

        const subscribers = this._outboundSubscribers.get(msg.channel) ?? [];
        for (const cb of subscribers) {
          try {
            await cb(msg);
          } catch (e) {
            logger.error({ err: e, channel: msg.channel }, "Error dispatching outbound message");
          }
        }
      } catch (e) {
        if (this._running) {
          logger.error({ err: e }, "MessageBus dispatch error");
        }
      }
    }
  }

  stop(): void {
    this._running = false;
  }

  get inboundSize(): number {
    return this._inbound.size;
  }

  get outboundSize(): number {
    return this._outbound.size;
  }
}

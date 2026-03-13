/**
 * WhatsApp channel
 *
 * Connects to a Node.js bridge (ws server using @whiskeysockets/baileys)
 * via WebSocket. The bridge is located in /bridge/ of this monorepo.
 */

import WebSocket from "ws";
import logger from "../utils/logger";
import { OutboundMessage } from "../bus/events";
import { MessageBus } from "../bus/queue";
import { BaseChannel } from "./base";

interface WhatsappConfig {
  enabled?: boolean;
  bridgeUrl?: string;
  allowFrom?: string[];
  [key: string]: unknown;
}

export class WhatsAppChannel extends BaseChannel {
  readonly name = "whatsapp";
  private waConfig: WhatsappConfig;
  private ws?: WebSocket;
  private connected = false;

  constructor(config: WhatsappConfig, bus: MessageBus) {
    super(config as Record<string, unknown>, bus);
    this.waConfig = config;
  }

  async start(): Promise<void> {
    const bridgeUrl = this.waConfig.bridgeUrl ?? "ws://localhost:3000";
    this.running = true;

    while (this.running) {
      await this._connect(bridgeUrl);
      if (this.running) {
        logger.info("WhatsApp reconnecting in 5s...");
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.connected = false;
    this.ws?.close();
    this.ws = undefined;
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.ws || !this.connected) {
      logger.warn("WhatsApp bridge not connected");
      return;
    }
    try {
      this.ws.send(
        JSON.stringify({ type: "send", to: msg.chatId, text: msg.content })
      );
    } catch (e) {
      logger.error(`WhatsApp send error: ${e}`);
    }
  }

  private _connect(bridgeUrl: string): Promise<void> {
    return new Promise((resolve) => {
      const ws = new WebSocket(bridgeUrl);
      this.ws = ws;

      ws.on("open", () => {
        this.connected = true;
        logger.info("Connected to WhatsApp bridge");
      });

      ws.on("message", async (raw: WebSocket.RawData) => {
        try {
          const data = JSON.parse(raw.toString());
          await this._handleBridgeMessage(data);
        } catch (e) {
          logger.error(`WhatsApp bridge message error: ${e}`);
        }
      });

      ws.on("close", () => {
        this.connected = false;
        logger.warn("WhatsApp bridge disconnected");
        resolve();
      });

      ws.on("error", (e: Error) => {
        logger.warn(`WhatsApp bridge error: ${e}`);
        this.connected = false;
        ws.terminate();
        resolve();
      });
    });
  }

  private async _handleBridgeMessage(data: Record<string, unknown>): Promise<void> {
    const msgType = data["type"];

    if (msgType === "message") {
      const pn = (data["pn"] as string) ?? "";
      const sender = (data["sender"] as string) ?? "";
      const content = (data["content"] as string) ?? "";
      const userId = pn || sender;
      const senderId = userId.includes("@") ? userId.split("@")[0] : userId;

      await this.handleMessage({
        senderId,
        chatId: sender || senderId,
        content,
        metadata: {
          messageId: data["id"],
          timestamp: data["timestamp"],
          isGroup: data["isGroup"] ?? false,
        },
      });
    } else if (msgType === "status") {
      const status = data["status"] as string;
      logger.info(`WhatsApp status: ${status}`);
      this.connected = status === "connected";
    } else if (msgType === "qr") {
      logger.info("Scan QR code in the bridge terminal to connect WhatsApp");
    } else if (msgType === "error") {
      logger.error(`WhatsApp bridge error: ${data["error"]}`);
    }
  }
}

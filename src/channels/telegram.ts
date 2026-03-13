/**
 * Telegram channel
 */

import TelegramBot, { Message } from "node-telegram-bot-api";
import logger from "../utils/logger";
import { OutboundMessage } from "../bus/events";
import { MessageBus } from "../bus/queue";
import { BaseChannel } from "./base";
import type { SessionManager } from "../session/manager";

interface TelegramConfig {
  token?: string;
  proxy?: string;
  allowFrom?: string[];
  startReply?: string;
  [key: string]: unknown;
}

const DEFAULT_START_REPLY = "👋 Hi, I'm SeClaw, your secure AI agent assistant.\n I help you complete tasks safely and efficiently.\nSend /help to see the available commands.";

function markdownToHtml(text: string): string {
  if (!text) return "";

  // Extract and protect code blocks
  const codeBlocks: string[] = [];
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // Extract and protect inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // Headers → plain
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  // Blockquotes
  text = text.replace(/^>\s*(.*)$/gm, "$1");
  // Escape HTML
  text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");
  // Italic
  text = text.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, "<i>$1</i>");
  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
  // Bullet lists
  text = text.replace(/^[-*]\s+/gm, "• ");

  // Restore inline code
  inlineCodes.forEach((code, i) => {
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    text = text.replace(`\x00IC${i}\x00`, `<code>${escaped}</code>`);
  });

  // Restore code blocks
  codeBlocks.forEach((code, i) => {
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    text = text.replace(`\x00CB${i}\x00`, `<pre><code>${escaped}</code></pre>`);
  });

  return text;
}

const MAX_MESSAGE_LENGTH = 4096;

export class TelegramChannel extends BaseChannel {
  readonly name = "telegram";
  private telegramConfig: TelegramConfig;
  private bot?: TelegramBot;
  private groqApiKey: string;
  private sessionManager?: SessionManager;
  private typingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(
    config: TelegramConfig,
    bus: MessageBus,
    groqApiKey = "",
    sessionManager?: SessionManager
  ) {
    super(config as Record<string, unknown>, bus);
    this.telegramConfig = config;
    this.groqApiKey = groqApiKey;
    this.sessionManager = sessionManager;
  }

  async start(): Promise<void> {
    if (!this.telegramConfig.token) {
      logger.error("Telegram bot token not configured");
      return;
    }

    this.running = true;
    const opts: TelegramBot.ConstructorOptions = { polling: true };
    if (this.telegramConfig.proxy) {
      opts.request = { proxy: this.telegramConfig.proxy } as any;
    }

    this.bot = new TelegramBot(this.telegramConfig.token, opts);

    this.bot.on("message", async (msg: Message) => {
      try {
        await this._onMessage(msg);
      } catch (e) {
        logger.error(`Telegram message handling error: ${e}`);
      }
    });

    this.bot.on("polling_error", (err) => {
      logger.error(`Telegram polling error: ${err}`);
    });

    logger.info("Telegram bot started (polling mode)");

    // Keep running
    await new Promise<void>((resolve) => {
      const checkStop = setInterval(() => {
        if (!this.running) {
          clearInterval(checkStop);
          resolve();
        }
      }, 1000);
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    // Cancel all typing indicators
    for (const chatId of this.typingIntervals.keys()) {
      this._stopTyping(chatId);
    }
    if (this.bot) {
      await this.bot.stopPolling();
      this.bot = undefined;
    }
    logger.info("Telegram bot stopped");
  }

  private _startTyping(chatId: string): void {
    this._stopTyping(chatId);
    if (!this.bot) return;
    // Send immediately, then repeat every 4s (Telegram typing lasts ~5s)
    this.bot.sendChatAction(Number(chatId), "typing").catch(() => {});
    const interval = setInterval(() => {
      this.bot?.sendChatAction(Number(chatId), "typing").catch(() => {});
    }, 4000);
    this.typingIntervals.set(chatId, interval);
  }

  private _stopTyping(chatId: string): void {
    const interval = this.typingIntervals.get(chatId);
    if (interval !== undefined) {
      clearInterval(interval);
      this.typingIntervals.delete(chatId);
    }
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.bot) {
      logger.warn("Telegram bot not running");
      return;
    }

    const keepTyping = msg.metadata?.["keepTyping"] === true;
    // Stop typing indicator before sending the final reply
    if (!keepTyping) {
      this._stopTyping(msg.chatId);
    }

    const chatId = msg.chatId;
    const htmlContent = markdownToHtml(msg.content);

    const chunks: string[] = [];
    if (htmlContent.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(htmlContent);
    } else {
      for (let i = 0; i < htmlContent.length; i += MAX_MESSAGE_LENGTH) {
        chunks.push(htmlContent.slice(i, i + MAX_MESSAGE_LENGTH));
      }
    }

    for (const chunk of chunks) {
      try {
        await this.bot.sendMessage(chatId, chunk, { parse_mode: "HTML" });
      } catch (e) {
        // Try plain text if HTML fails
        try {
          await this.bot.sendMessage(chatId, msg.content.slice(0, MAX_MESSAGE_LENGTH));
        } catch (e2) {
          logger.error(`Failed to send Telegram message: ${e2}`);
        }
      }
    }
  }

  private async _onMessage(msg: Message): Promise<void> {
    if (!msg.from) return;

    const senderId = String(msg.from.id);
    const chatId = String(msg.chat.id);
    const text = msg.text ?? msg.caption ?? "";

    // Handle commands
    if (text.startsWith("/")) {
      const cmd = text.split(" ")[0].toLowerCase().replace(/^\//, "").split("@")[0];
      if (cmd === "start") {
        if (!this.isAllowed(senderId)) {
          logger.warn(`${this.name}: sender ${senderId} not in allow list, ignoring`);
          return;
        }
        if (this.bot) {
          const reply = this.telegramConfig.startReply?.trim() || DEFAULT_START_REPLY;
          await this.bot.sendMessage(chatId, reply);
        }
        return;
      }
      if (["help", "new", "reset", "skill_audit", "memory_audit", "snapshot_list"].includes(cmd)) {
        this._startTyping(chatId);
        await this.handleMessage({
          senderId,
          chatId,
          content: cmd === "reset" ? "/new" : `/${cmd}`,
        });
        return;
      }
      if (text.startsWith("/snapshot_restore") || text.startsWith("/take_snapshot")) {
        this._startTyping(chatId);
        await this.handleMessage({ senderId, chatId, content: text });
        return;
      }
    }

    if (!text && !msg.photo && !msg.voice && !msg.document) return;

    // Start typing indicator while processing
    this._startTyping(chatId);

    await this.handleMessage({
      senderId,
      chatId,
      content: text || "(media)",
    });
  }
}

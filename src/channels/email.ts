/**
 * Email channel
 *
 * Inbound: IMAP polling for unread messages
 * Outbound: SMTP replies via nodemailer
 */

import * as nodemailer from "nodemailer";
import logger from "../utils/logger";
import { OutboundMessage } from "../bus/events";
import { MessageBus } from "../bus/queue";
import { BaseChannel } from "./base";

interface EmailConfig {
  consentGranted?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  imapPassword?: string;
  imapSsl?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSsl?: boolean;
  pollIntervalSeconds?: number;
  allowFrom?: string[];
  [key: string]: unknown;
}

export class EmailChannel extends BaseChannel {
  readonly name = "email";
  private emailConfig: EmailConfig;
  private transporter?: nodemailer.Transporter;
  private lastSubjectByChat: Map<string, string> = new Map();
  private lastMessageIdByChat: Map<string, string> = new Map();
  private pollTimer?: NodeJS.Timeout;

  constructor(config: EmailConfig, bus: MessageBus) {
    super(config as Record<string, unknown>, bus);
    this.emailConfig = config;
  }

  async start(): Promise<void> {
    if (!this.emailConfig.consentGranted) {
      logger.warn("Email channel disabled: consentGranted is false.");
      return;
    }
    if (!this.emailConfig.smtpHost) {
      logger.error("Email SMTP not configured");
      return;
    }

    this.running = true;

    this.transporter = nodemailer.createTransport({
      host: this.emailConfig.smtpHost,
      port: this.emailConfig.smtpPort ?? 587,
      secure: this.emailConfig.smtpSsl ?? false,
      auth: {
        user: this.emailConfig.smtpUser,
        pass: this.emailConfig.smtpPassword,
      },
    });

    logger.info("Starting Email channel (IMAP polling mode)...");

    const pollSeconds = Math.max(5, this.emailConfig.pollIntervalSeconds ?? 60);
    this._poll().catch(() => {});

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
    if (this.pollTimer) clearTimeout(this.pollTimer);
    logger.info("Email channel stopped");
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.transporter) {
      logger.warn("Email transporter not initialized");
      return;
    }

    const recipient = msg.chatId;
    const lastSubject = this.lastSubjectByChat.get(recipient);
    const subject = lastSubject
      ? lastSubject.startsWith("Re:") ? lastSubject : `Re: ${lastSubject}`
      : "seclaw response";
    const lastMessageId = this.lastMessageIdByChat.get(recipient);

    const mailOpts: nodemailer.SendMailOptions = {
      from: this.emailConfig.smtpUser,
      to: recipient,
      subject,
      text: msg.content,
    };
    if (lastMessageId) {
      mailOpts.inReplyTo = lastMessageId;
      mailOpts.references = lastMessageId;
    }

    try {
      await this.transporter.sendMail(mailOpts);
    } catch (e) {
      logger.error(`Error sending email: ${e}`);
    }
  }

  private async _poll(): Promise<void> {
    while (this.running) {
      try {
        await this._fetchNewMessages();
      } catch (e) {
        logger.error(`Email polling error: ${e}`);
      }
      await new Promise((r) => setTimeout(r, (this.emailConfig.pollIntervalSeconds ?? 60) * 1000));
    }
  }

  private async _fetchNewMessages(): Promise<void> {
    // IMAP fetching requires the `imap` npm package; use dynamic import for optional dep
    try {
      const Imap = require("imap");
      const { simpleParser } = require("mailparser");

      const config: Record<string, unknown> = {
        host: this.emailConfig.imapHost,
        port: this.emailConfig.imapPort ?? 993,
        user: this.emailConfig.imapUser,
        password: this.emailConfig.imapPassword,
        tls: this.emailConfig.imapSsl !== false,
        tlsOptions: { rejectUnauthorized: false },
      };

      await new Promise<void>((resolve, reject) => {
        const imap = new Imap(config);
        imap.once("ready", () => {
          imap.openBox("INBOX", false, (err: Error, box: unknown) => {
            if (err) { imap.end(); return reject(err); }

            imap.search(["UNSEEN"], (err2: Error, uids: number[]) => {
              if (err2 || !uids.length) { imap.end(); return resolve(); }

              const fetch = imap.fetch(uids, { bodies: "" });
              const promises: Promise<void>[] = [];

              fetch.on("message", (msg: any) => {
                const p = new Promise<void>((res) => {
                  let rawEmail = "";
                  msg.on("body", (stream: NodeJS.ReadableStream) => {
                    stream.on("data", (c: Buffer) => (rawEmail += c.toString()));
                  });
                  msg.once("end", async () => {
                    try {
                      const parsed = await simpleParser(rawEmail);
                      const from = parsed.from?.value?.[0]?.address ?? "unknown";
                      const subject = parsed.subject ?? "";
                      const text = parsed.text?.trim() ?? parsed.html ?? "(empty)";
                      const messageId = parsed.messageId ?? "";

                      if (subject) this.lastSubjectByChat.set(from, subject);
                      if (messageId) this.lastMessageIdByChat.set(from, messageId);

                      await this.handleMessage({ senderId: from, chatId: from, content: text });
                    } catch (_) {}
                    res();
                  });
                });
                promises.push(p);
              });

              fetch.once("end", async () => {
                await Promise.all(promises);
                // Mark messages as seen
                imap.setFlags(uids, ["\\Seen"], () => {});
                imap.end();
                resolve();
              });
              fetch.once("error", (e: Error) => { imap.end(); reject(e); });
            });
          });
        });
        imap.once("error", reject);
        imap.connect();
      });
    } catch (e) {
      logger.debug(`Email IMAP error (may be dependency missing): ${e}`);
    }
  }
}

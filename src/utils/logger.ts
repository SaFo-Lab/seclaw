/**
 * Logger utility using pino - replaces Python's loguru
 */

import pino from "pino";

export const logger = pino({
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
  level: process.env.LOG_LEVEL ?? "info",
});

export default logger;

import pino from "pino";

/**
 * Structured logger for the application.
 *
 * In development, logs are human-readable.
 * In production, logs are JSON for machine parsing (ELK, Datadog, etc.).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? {
          target: "pino/file",
          options: { destination: 1 } // stdout
        }
      : undefined,
  base: {
    service: "citecrawl-rag"
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

/** Create a child logger scoped to a specific module. */
export function createLogger(module: string) {
  return logger.child({ module });
}

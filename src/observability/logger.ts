import pino, { type Logger, type LoggerOptions } from "pino";

/**
 * Structured logger for Constellation. Uses pino. Level and pretty-printing are
 * configured via env (LOG_LEVEL, LOG_PRETTY) so deployments can tune verbosity
 * without code changes.
 *
 * RPC/stdio note: pino writes to stderr-safe destinations only when configured;
 * by default it writes to stdout. The RPC transport keeps protocol JSON on
 * stdout separate by routing logs to stderr (see createLogger options).
 */

export type ConstellationLogger = Logger;

let rootLogger: ConstellationLogger | undefined;

export interface CreateLoggerOptions {
  level?: string;
  pretty?: boolean;
  /** Route logs to stderr (important when stdout carries an RPC protocol). */
  toStderr?: boolean;
  base?: Record<string, unknown>;
}

export function createLogger(opts: CreateLoggerOptions = {}): ConstellationLogger {
  const level = opts.level ?? process.env.LOG_LEVEL ?? "info";
  const pretty = opts.pretty ?? process.env.LOG_PRETTY === "1";
  const toStderr = opts.toStderr ?? process.env.LOG_TO_STDERR === "1";

  const options: LoggerOptions = {
    level,
    base: { service: "constellation", ...opts.base },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  const destination = toStderr ? pino.destination(2) : undefined;

  if (pretty) {
    options.transport = { target: "pino-pretty", options: { colorize: true } };
    return pino(options);
  }
  return destination ? pino(options, destination) : pino(options);
}

/** Lazily-initialized process-wide root logger. */
export function getLogger(): ConstellationLogger {
  if (!rootLogger) rootLogger = createLogger();
  return rootLogger;
}

/** Override the root logger (tests, custom transports). */
export function setLogger(logger: ConstellationLogger): void {
  rootLogger = logger;
}

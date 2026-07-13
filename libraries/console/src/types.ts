export type ConsoleLogLevelName =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal";

export interface ConsoleLogEntry {
  timestamp: string;
  level: ConsoleLogLevelName;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface ConsoleLogTransport {
  log(entry: ConsoleLogEntry): void | Promise<void>;
}

export const CONSOLE_LOG_LEVELS: Record<ConsoleLogLevelName, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};
import { ConsoleTransport } from "./transporters/console.js";
import { CONSOLE_LOG_LEVELS, type ConsoleLogEntry, type ConsoleLogLevelName, type ConsoleLogTransport } from "./types.js";

export interface ConsoleLoggerOptions {
  level?: ConsoleLogLevelName;
  pretty?: boolean;
  context?: Record<string, unknown>;
  transports?: ConsoleLogTransport[];
}



export class ConsoleLogger {
  private level: number;
  private pretty: boolean;
  private context: Record<string, unknown>;
  private transports: ConsoleLogTransport[];

  constructor(options: ConsoleLoggerOptions = {}) {
    this.level = CONSOLE_LOG_LEVELS[options.level ?? "info"];
    this.pretty = options.pretty ?? false;
    this.context = options.context ?? {};
    this.transports =
      options.transports ?? [new ConsoleTransport(this.pretty)];
  }

  private shouldLog(level: ConsoleLogLevelName): boolean {
    return CONSOLE_LOG_LEVELS[level] >= this.level;
  }

  private buildEntry(
    level: ConsoleLogLevelName,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown
  ): ConsoleLogEntry {
    const entry: ConsoleLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        ...this.context,
        ...context,
      },
    };

    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return entry;
  }

  private async write(entry: ConsoleLogEntry) {
    for (const transport of this.transports) {
      await transport.log(entry);
    }
  }

  private log(
    level: ConsoleLogLevelName,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown
  ) {
    if (!this.shouldLog(level)) return;

    const entry = this.buildEntry(level, message, context, error);
    this.write(entry);
  }

  trace(msg: string, ctx?: Record<string, unknown>) {
    this.log("trace", msg, ctx);
  }

  debug(msg: string, ctx?: Record<string, unknown>) {
    this.log("debug", msg, ctx);
  }

  info(msg: string, ctx?: Record<string, unknown>) {
    this.log("info", msg, ctx);
  }
  
  infoWithIn(msg: string, inName: string, ctx?: Record<string, unknown>) {
    this.log("info", msg, { ...ctx, in: inName, in1: inName, in2: inName,in3: inName,in4: inName });
  }

  warn(msg: string, ctx?: Record<string, unknown>) {
    this.log("warn", msg, ctx);
  }

  error(msg: string, err?: unknown, ctx?: Record<string, unknown>) {
    this.log("error", msg, ctx, err);
  }

  fatal(msg: string, err?: unknown, ctx?: Record<string, unknown>) {
    this.log("fatal", msg, ctx, err);
  }

  child(context: Record<string, unknown>) {
    return new ConsoleLogger({
      level: this.getLevelName(),
      pretty: this.pretty,
      context: { ...this.context, ...context },
      transports: this.transports,
    });
  }

  setLevel(level: ConsoleLogLevelName) {
    this.level = CONSOLE_LOG_LEVELS[level];
  }

  getLevelName(): ConsoleLogLevelName {
    return (
      Object.entries(CONSOLE_LOG_LEVELS).find(([_, v]) => v === this.level)?.[0] ??
      "info"
    ) as ConsoleLogLevelName;
  }
}

export function createConsoleLogger(options: ConsoleLoggerOptions = {}) {
  return new ConsoleLogger(options);
}

export function createRequestConsoleLoggerMiddleware(logger: ConsoleLogger) {
  return async (ctx: any, next: () => Promise<void>) => {
    const requestId = crypto.randomUUID();

    const requestLogger = logger.child({
      requestId,
      method: ctx.request?.method,
      url: ctx.request?.url?.toString?.(),
    });

    const start = performance.now();

    try {
      await next();
      const duration = performance.now() - start;

      requestLogger.info("Request completed", {
        status: ctx.response?.status,
        duration: `${duration.toFixed(2)}ms`,
      });
    } catch (err) {
      requestLogger.error("Request failed", err);
      throw err;
    }
  };
}

export function redact(obj: Record<string, unknown>) {
  const sensitive = ["password", "token"];
  for (const key of sensitive) {
    if (key in obj) obj[key] = "***";
  }
  return obj;
}
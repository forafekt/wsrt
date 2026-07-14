import * as ansi from "@wsrt/ansi-tools";
import type {
  ConsoleLogEntry,
  ConsoleLogTransport,
} from "../types.js";

type ColorFunction = (
  input: string | number | null | undefined,
) => string;

type PrettyPrintOptions = {
  indent?: string;
  maxDepth?: number;
};

export class ConsoleTransport implements ConsoleLogTransport {
  constructor(
    private readonly pretty = false,
    private readonly prettyOptions: PrettyPrintOptions = {},
  ) {
    this.log = this.log.bind(this);
  }

  log(entry: ConsoleLogEntry): void {
    if (this.pretty) {
      this.prettyPrint(entry);
      return;
    }

    console.log(JSON.stringify(entry));
  }

  private prettyPrint(entry: ConsoleLogEntry): void {
    const levelBgColors: Record<string, ColorFunction> = {
      trace: ansi.colors.blackBright,
      debug: ansi.colors.bgCyan,
      info: ansi.colors.bgGreen,
      warn: ansi.colors.bgYellow,
      error: ansi.colors.bgRed,
      fatal: ansi.colors.bgMagenta,
    };

    const levelTextColors: Record<string, ColorFunction> = {
      trace: ansi.colors.blackBright,
      debug: ansi.colors.cyan,
      info: ansi.colors.green,
      warn: ansi.colors.yellow,
      error: ansi.colors.red,
      fatal: ansi.colors.magenta,
    };

    const fallbackColor: ColorFunction = (input) => String(input ?? "");

    const bgColor = levelBgColors[entry.level] ?? fallbackColor;
    const textColor = levelTextColors[entry.level] ?? fallbackColor;

    console.log(
      insert(
        {
          text: `[${entry.level.toUpperCase()}]`,
          color: bgColor,
        },
        {
          text: formatTimestamp(entry.timestamp),
          color: ansi.colors.gray,
        },
        {
          text: entry.message,
          color: textColor,
        },
      ),
    );

    if (entry.context && Object.keys(entry.context).length > 0) {
      console.log(
        renderTree(entry.context, {
          rootLabel: "context",
          indent: this.prettyOptions.indent,
          maxDepth: this.prettyOptions.maxDepth,
        }),
      );
    }

    if (entry.error) {
      console.error(
        renderTree(entry.error, {
          rootLabel: "error",
          indent: this.prettyOptions.indent,
          maxDepth: this.prettyOptions.maxDepth,
        }),
      );
    }
  }
}

type RenderTreeOptions = {
  rootLabel?: string;
  indent?: string;
  maxDepth?: number;
};

function renderTree(
  value: unknown,
  options: RenderTreeOptions = {},
): string {
  const {
    rootLabel,
    indent = "  ",
    maxDepth = 10,
  } = options;

  const seen = new WeakSet<object>();
  const lines: string[] = [];

  if (rootLabel) {
    lines.push(`  ${ansi.colors.gray("┌─")} ${ansi.colors.gray(rootLabel)}`);

    appendTreeValue({
      lines,
      value,
      prefix: "  ",
      childPrefix: `${indent}`,
      depth: 0,
      maxDepth,
      seen,
    });

    lines.push(`  ${ansi.colors.gray("└─")}`);
  } else {
    appendTreeValue({
      lines,
      value,
      prefix: "",
      childPrefix: "",
      depth: 0,
      maxDepth,
      seen,
    });
  }

  return lines.join("\n");
}

type AppendTreeValueOptions = {
  lines: string[];
  value: unknown;
  prefix: string;
  childPrefix: string;
  depth: number;
  maxDepth: number;
  seen: WeakSet<object>;
};

function appendTreeValue({
  lines,
  value,
  prefix,
  childPrefix,
  depth,
  maxDepth,
  seen,
}: AppendTreeValueOptions): void {
  const entries = getEntries(value);

  if (!entries) {
    lines.push(`${prefix}${ansi.colors.gray("└─")} ${formatPrimitive(value)}`);
    return;
  }

  if (depth >= maxDepth) {
    lines.push(
      `${prefix}${ansi.colors.gray("└─")} ${ansi.colors.gray("[Max depth reached]")}`,
    );
    return;
  }

  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      lines.push(
        `${prefix}${ansi.colors.gray("└─")} ${ansi.colors.gray("[Circular]")}`,
      );
      return;
    }

    seen.add(value);
  }

  if (entries.length === 0) {
    lines.push(
      `${prefix}${ansi.colors.gray("└─")} ${formatEmptyCollection(value)}`,
    );
    return;
  }

  entries.forEach(([key, childValue], index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "└─" : "├─";
    const nextPrefix = `${childPrefix}${isLast ? "  " : "│ "}`;

    const childEntries = getEntries(childValue);

    if (!childEntries) {
      lines.push(
        `${childPrefix}${ansi.colors.gray(branch)} ` +
          `${formatKey(key)}: ${formatPrimitive(childValue)}`,
      );
      return;
    }

    lines.push(
      `${childPrefix}${ansi.colors.gray(branch)} ${formatKey(key)}: ${formatCollectionLabel(childValue)}`,
    );

    if (depth + 1 >= maxDepth) {
      lines.push(
        `${nextPrefix}${ansi.colors.gray("└─")} ${ansi.colors.gray("[Max depth reached]")}`,
      );
      return;
    }

    if (typeof childValue === "object" && childValue !== null) {
      if (seen.has(childValue)) {
        lines.push(
          `${nextPrefix}${ansi.colors.gray("└─")} ${ansi.colors.gray("[Circular]")}`,
        );
        return;
      }

      seen.add(childValue);
    }

    if (childEntries.length === 0) {
      lines.push(
        `${nextPrefix}${ansi.colors.gray("└─")} ${formatEmptyCollection(childValue)}`,
      );
      return;
    }

    appendEntries({
      lines,
      entries: childEntries,
      prefix: nextPrefix,
      depth: depth + 1,
      maxDepth,
      seen,
    });
  });
}

type AppendEntriesOptions = {
  lines: string[];
  entries: Array<[string, unknown]>;
  prefix: string;
  depth: number;
  maxDepth: number;
  seen: WeakSet<object>;
};

function appendEntries({
  lines,
  entries,
  prefix,
  depth,
  maxDepth,
  seen,
}: AppendEntriesOptions): void {
  entries.forEach(([key, value], index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "└─" : "├─";
    const nextPrefix = `${prefix}${isLast ? "  " : "│ "}`;

    const childEntries = getEntries(value);

    if (!childEntries) {
      lines.push(
        `${prefix}${ansi.colors.gray(branch)} ` +
          `${formatKey(key)}: ${formatPrimitive(value)}`,
      );
      return;
    }

    lines.push(
      `${prefix}${ansi.colors.gray(branch)} ` +
        `${formatKey(key)}: ${formatCollectionLabel(value)}`,
    );

    if (depth >= maxDepth) {
      lines.push(
        `${nextPrefix}${ansi.colors.gray("└─")} ${ansi.colors.gray("[Max depth reached]")}`,
      );
      return;
    }

    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        lines.push(
          `${nextPrefix}${ansi.colors.gray("└─")} ${ansi.colors.gray("[Circular]")}`,
        );
        return;
      }

      seen.add(value);
    }

    if (childEntries.length === 0) {
      lines.push(
        `${nextPrefix}${ansi.colors.gray("└─")} ${formatEmptyCollection(value)}`,
      );
      return;
    }

    appendEntries({
      lines,
      entries: childEntries,
      prefix: nextPrefix,
      depth: depth + 1,
      maxDepth,
      seen,
    });
  });
}

function getEntries(value: unknown): Array<[string, unknown]> | null {
  if (value instanceof Error) {
    const entries: Array<[string, unknown]> = [
      ["name", value.name],
      ["message", value.message],
    ];

    if (value.stack) {
      entries.push(["stack", value.stack]);
    }

    if ("cause" in value && value.cause !== undefined) {
      entries.push(["cause", value.cause]);
    }

    for (const [key, childValue] of Object.entries(value)) {
      if (!entries.some(([existingKey]) => existingKey === key)) {
        entries.push([key, childValue]);
      }
    }

    return entries;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => [`[${index}]`, item]);
  }

  if (value instanceof Map) {
    return Array.from(value.entries(), ([key, childValue]) => [
      String(key),
      childValue,
    ]);
  }

  if (value instanceof Set) {
    return Array.from(value.values(), (childValue, index) => [
      `[${index}]`,
      childValue,
    ]);
  }

  if (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof Date)
  ) {
    return Object.entries(value);
  }

  return null;
}

function formatPrimitive(value: unknown): string {
  if (value === null) {
    return ansi.colors.magenta("null");
  }

  if (value === undefined) {
    return ansi.colors.gray("undefined");
  }

  if (typeof value === "string") {
    if (value.includes("\n")) {
      return value
        .split("\n")
        .map((line, index) =>
          index === 0
            ? ansi.colors.green(JSON.stringify(line))
            : `\n      ${ansi.colors.green(JSON.stringify(line))}`,
        )
        .join("");
    }

    return ansi.colors.green(JSON.stringify(value));
  }

  if (typeof value === "number") {
    return ansi.colors.cyan(value);
  }

  if (typeof value === "bigint") {
    return ansi.colors.cyan(`${value}n`);
  }

  if (typeof value === "boolean") {
    return ansi.colors.yellow(String(value));
  }

  if (typeof value === "symbol") {
    return ansi.colors.magenta(String(value));
  }

  if (typeof value === "function") {
    return ansi.colors.gray(`[Function ${value.name || "anonymous"}]`);
  }

  if (value instanceof Date) {
    return ansi.colors.cyan(value.toISOString());
  }

  return String(value);
}

function formatKey(key: string): string {
  return ansi.colors.gray(key);
}

function formatCollectionLabel(value: unknown): string {
  if (Array.isArray(value)) {
    return ansi.colors.gray(`Array(${value.length})`);
  }

  if (value instanceof Map) {
    return ansi.colors.gray(`Map(${value.size})`);
  }

  if (value instanceof Set) {
    return ansi.colors.gray(`Set(${value.size})`);
  }

  if (value instanceof Error) {
    return ansi.colors.gray(value.name);
  }

  return ansi.colors.gray("Object");
}

function formatEmptyCollection(value: unknown): string {
  if (Array.isArray(value)) {
    return ansi.colors.gray("[]");
  }

  if (value instanceof Map) {
    return ansi.colors.gray("Map(0)");
  }

  if (value instanceof Set) {
    return ansi.colors.gray("Set(0)");
  }

  return ansi.colors.gray("{}");
}

function formatTimestamp(timestamp: ConsoleLogEntry["timestamp"]): string {
  const date = new Date(timestamp);

  return Number.isNaN(date.getTime())
    ? String(timestamp)
    : date.toLocaleString();
}

function insert(
  ...inputs: Array<{
    text: string;
    color?: ColorFunction;
  }>
): string {
  return inputs
    .map(({ text, color }) => (color ? color(text) : text))
    .join(" ");
}
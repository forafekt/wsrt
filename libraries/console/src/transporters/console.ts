import type { ConsoleLogTransport, ConsoleLogEntry } from "../types.ts";
import * as ansi from "@wsrt/ansi-tools";


export class ConsoleTransport implements ConsoleLogTransport {
  constructor(private pretty: boolean = false) {}

  log(entry: ConsoleLogEntry) {
    if (this.pretty) {
      this.prettyPrint(entry);
    } else {
      console.log(JSON.stringify(entry));
    }
  }

  private prettyPrint(entry: ConsoleLogEntry) {
    const levelBgColors: Record<string, (input: string | number | null | undefined) => string> = {
      trace: ansi.colors.blackBright,
      debug: ansi.colors.bgCyan,
      info: ansi.colors.bgGreen,
      warn: ansi.colors.bgYellow,
      error: ansi.colors.bgRed,
      fatal: ansi.colors.bgMagenta,
    };

    const levelTextColors: Record<string, (input: string | number | null | undefined) => string> = {
      trace: ansi.colors.blackBright,
      debug: ansi.colors.cyan,
      info: ansi.colors.green,
      warn: ansi.colors.yellow,
      error: ansi.colors.red,
      fatal: ansi.colors.magenta,
    };

    const bgColor = levelBgColors[entry.level] ?? ((input: string | number | null | undefined) => input);
    const textColor = levelTextColors[entry.level] ?? ((input: string | number | null | undefined) => input);

    console.log(insert(
      { text: `[${entry.level.toUpperCase()}]`, color: bgColor },
      { text: new Date(entry.timestamp).toLocaleString(), color: ansi.colors.gray },
      { text: entry.message, color: textColor },
    ));

    if (entry.context && Object.keys(entry.context).length) {
      const prettyContext = Object.entries(entry.context).map(([key, value]) => `${key}: ${value}`).join("\n  ├─ ");
      console.log(`  ┌ `);
      console.log("  ├─", prettyContext);
      console.log(`  └ `);
    }

    if (entry.error) {
      console.error("  ├", entry.error);
    }
  }
}

function insert(...inputs: ({ text: string, color?: (input: string | number | null | undefined) => string })[]) {
  return inputs.map(input => input.color ? input.color(input.text) : input.text).join(" ");
}
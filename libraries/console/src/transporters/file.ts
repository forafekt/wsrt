import type { ConsoleLogTransport, ConsoleLogEntry } from "../types.ts";
import type { Runtime } from "@wsrt/runtime";

export class FileTransport implements ConsoleLogTransport {
  constructor(private runtime: Runtime, private filePath: string) {}

  async log(entry: ConsoleLogEntry) {
    const line = JSON.stringify(entry) + "\n";

    // if (typeof Deno !== "undefined") {
    //   await Deno.writeTextFile(this.filePath, line, { append: true });
    // } else if (typeof process !== "undefined") {
    //   const fs = await import("node:fs/promises");
    //   await fs.appendFile(this.filePath, line);
    // }

    await this.runtime.fs.writeText(this.filePath, line);
  }
}
import type { ConsoleLogTransport, ConsoleLogEntry } from "../types.js";

export class HttpTransport implements ConsoleLogTransport {
  constructor(private endpoint: string) {}

  async log(entry: ConsoleLogEntry) {
    await fetch(this.endpoint, {
      method: "POST",
      body: JSON.stringify(entry),
    });
  }
}
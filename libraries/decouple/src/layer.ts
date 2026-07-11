import type { ConfigSource } from "./decouple.ts";

export function layer(...sources: ConfigSource[]): ConfigSource {
  return () => {
    const result: Record<string, string | undefined> = {};

    for (let i = sources.length - 1; i >= 0; i--) {
      const src = sources[i];
      const values = typeof src === "function" ? src() : src;

      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && !(key in result)) {
          result[key] = value;
        }
      }
    }

    return result;
  };
}

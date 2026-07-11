import type { ConfigSource } from "./decouple.ts";
import { DecoupleError } from "./errors.ts";

export function layerStrict(...sources: ConfigSource[]): ConfigSource {
  return () => {
    const seen = new Map<string, number>();
    const result: Record<string, string | undefined> = {};

    sources.forEach((src, index) => {
      const values = typeof src === "function" ? src() : src;

      for (const key of Object.keys(values)) {
        if (seen.has(key)) {
          throw new DecoupleError(
            `Config key "${key}" is shadowed (layer ${
              seen.get(key)
            } → ${index})`,
          );
        }
        seen.set(key, index);
        result[key] = values[key];
      }
    });

    return result;
  };
}

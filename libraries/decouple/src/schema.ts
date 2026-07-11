import type { DecoupledConfig } from "./decouple.ts";
import type { DecoupledVar } from "./var.ts";

export type Schema<T> = {
  [K in keyof T]: (v: DecoupledVar) => T[K];
};

export function applySchema<T>(
  config: DecoupledConfig,
  schema: Schema<T>,
): T {
  const result: Partial<T> = {};

  for (const key in schema) {
    result[key] = schema[key](config.get(key));
  }

  return result as T;
}

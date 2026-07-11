// deno-lint-ignore-file no-explicit-any
import { DecoupleError } from "./errors.ts";

export interface CastFn<T> {
  (value: string): T;
  (value: string, truthy?: string[], falsey?: string[]): T;
  (value: string, separator?: string): T;
}

export const casters = {
  string: (v: string): any => v,

  number: (v: string): any => {
    const n = Number(v);
    if (Number.isNaN(n)) {
      throw new DecoupleError(`Invalid number: "${v}"`);
    }
    return n;
  },

  boolean: (v: string, truthy: string[] = [], falsey: string[] = []): any => {
    const val = v.toLowerCase().trim();
    if (["true", ...truthy].includes(val)) return true;
    if (["false", ...falsey].includes(val)) return false;
    throw new DecoupleError(`Invalid boolean: "${v}"`);
  },

  json: (v: string): any => {
    try {
      return JSON.parse(v);
    } catch {
      throw new DecoupleError(`Invalid JSON: "${v}"`);
    }
  },

  list: (v: string, sep: string = ","): any => {
    return v.split(sep).map((x) => x.trim()).filter(Boolean);
  },
};

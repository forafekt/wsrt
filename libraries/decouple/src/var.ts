import { casters, type CastFn } from "./casters.ts";
import { DecoupleError } from "./errors.ts";

export class DecoupledVar {
  constructor(
    private readonly key: string,
    private readonly value: string | undefined, // unparsed value from source
  ) {}

  private resolve<T>(
    caster: CastFn<T>,
    defaultValue?: T,
  ) {
    if (typeof this.value !== "string") {
      return defaultValue as T;
      // throw new DecoupleError(`Missing config value: ${this.key}`);
    }

    try {
      return caster(this.value) as T;
    } catch (err) {
      throw new DecoupleError(
        `Error parsing "${this.key}": ${(err as Error).message}`,
      );
    }
  }

  /* -------------------------------------------------
   * Core types
   * ------------------------------------------------- */

  string<T>(defaultValue?: T) {
    return this.resolve<T>(casters.string, defaultValue);
  }

  number<T>(defaultValue?: T) {
    return this.resolve<T>(casters.number, defaultValue);
  }

  bool<T>(defaultValue?: T, truthy: string[] = [], falsey: string[] = []) {
    return this.resolve<T>((v) => casters.boolean(v, truthy, falsey), defaultValue);
  }

  json<T>(defaultValue?: T) {
    return this.resolve<T>(casters.json, defaultValue);
  }

  list<T>(defaultValue?: T, sep = ",") {
    return this.resolve<T>((v) => casters.list(v, sep), defaultValue);
  }

  /* -------------------------------------------------
   * Validation helpers
   * ------------------------------------------------- */

  enum<const T extends readonly string[]>(
    values: T,
    defaultValue?: T[number],
  ): T[number] {
    return this.resolve((v) => {
      if (!values.includes(v)) {
        throw new Error(
          `Expected one of ${values.join(", ")}, got "${v}"`,
        );
      }
      return v as T[number];
    }, defaultValue);
  }

  match(
    pattern: RegExp,
    defaultValue?: string,
  ) {
    return this.resolve((v) => {
      if (!pattern.test(v)) {
        throw new Error(`Value does not match ${pattern}`);
      }
      return v;
    }, defaultValue);
  }

  /* -------------------------------------------------
   * Required / raw access
   * ------------------------------------------------- */

  required() {
    if (typeof this.value !== "string") {
      throw new DecoupleError(
        `Missing required config value: ${this.key}`,
      );
    }
    return this.value;
  }

  raw() {
    return this.value;
  }
}

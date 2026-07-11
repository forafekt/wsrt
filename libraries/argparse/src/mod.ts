// deno-lint-ignore-file no-explicit-any
export type Argv<T extends Record<string, any> = Record<string, any>> = {
  _: unknown[];
} & T;

export type UnknownHandler = (arg: string) => Argv | never;

export interface Options {
  alias?: Record<string, string | string[]>;
  string?: string | string[];
  boolean?: string | string[];
  default?: Record<string, unknown>;
  unknown?: UnknownHandler;
}

function toArr<T>(value: T | T[] | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function toVal(
  out: Argv,
  key: string,
  val: unknown,
  opts: {
    string: string[];
    boolean: string[];
  },
): void {
  const old = out[key];

  let x: number;
  let nxt: unknown;

  // STRING MODE
  if (opts.string.includes(key)) {
    nxt = val == null || val === true ? "" : String(val);

    // BOOLEAN VALUE PASSTHROUGH
  } else if (typeof val === "boolean") {
    nxt = val;

    // BOOLEAN OPTION MODE
  } else if (opts.boolean.includes(key)) {
    if (val === "false") {
      nxt = false;
    } else if (val === "true") {
      nxt = true;
    } else {
      x = Number(val);
      if (x * 0 === 0) {
        out._.push(x);
        nxt = Boolean(val);
      } else {
        out._.push(val);
        nxt = Boolean(val);
      }
    }

    // NUMBER MODE
  } else {
    x = Number(val);
    nxt = x * 0 === 0 ? x : val;
  }

  // ASSIGN / APPEND
  if (old == null) {
    out[key] = nxt;
  } else if (Array.isArray(old)) {
    old.push(nxt);
  } else {
    out[key] = [old, nxt];
  }
}

export default function argparse(
  args: string[] = [],
  opts: Options = {},
): Argv {
  const out: Argv = { _: [] };

  let i = 0;
  let j = 0;
  let idx = 0;

  const len = args.length;

  const alibi = opts.alias !== undefined;
  const strict = opts.unknown !== undefined;
  const defaults = opts.default !== undefined;

  const alias: Record<string, string[]> = {};
  const stringKeys = toArr(opts.string);
  const booleanKeys = toArr(opts.boolean);

  // Normalize alias table
  if (opts.alias) {
    for (const k in opts.alias) {
      alias[k] = toArr(opts.alias[k]);
    }
  }

  // Expand alias relationships
  if (alibi) {
    for (const k in alias) {
      const arr = alias[k];
      for (i = 0; i < arr.length; i++) {
        const name = arr[i];
        alias[name] = arr.concat(k).filter((_, index) => index !== i);
      }
    }
  }

  // Expand boolean aliases
  for (i = booleanKeys.length; i-- > 0;) {
    const arr = alias[booleanKeys[i]] || [];
    for (j = arr.length; j-- > 0;) {
      booleanKeys.push(arr[j]);
    }
  }

  // Expand string aliases
  for (i = stringKeys.length; i-- > 0;) {
    const arr = alias[stringKeys[i]] || [];
    for (j = arr.length; j-- > 0;) {
      stringKeys.push(arr[j]);
    }
  }

  // Attach defaults into type groups
  if (defaults && opts.default) {
    for (const k in opts.default) {
      const type = typeof opts.default[k];
      alias[k] = alias[k] || [];

      if (type === "string") {
        stringKeys.push(k, ...alias[k]);
      } else if (type === "boolean") {
        booleanKeys.push(k, ...alias[k]);
      }
    }
  }

  const strictKeys = strict ? Object.keys(alias) : [];

  // MAIN PARSE LOOP
  for (i = 0; i < len; i++) {
    const arg = args[i];

    // Stop at "--"
    if (arg === "--") {
      out._ = out._.concat(args.slice(++i));
      break;
    }

    // Count leading "-"
    j = 0;
    while (arg.charCodeAt(j) === 45) j++;

    // Positional
    if (j === 0) {
      out._.push(arg);
      continue;
    }

    // Handle --no-flag
    if (arg.substring(j, j + 3) === "no-") {
      const name = arg.substring(j + 3);

      if (strict && !strictKeys.includes(name)) {
        return opts.unknown!(arg);
      }

      out[name] = false;
      continue;
    }

    // Find "="
    for (idx = j + 1; idx < arg.length; idx++) {
      if (arg.charCodeAt(idx) === 61) break;
    }

    let name = arg.substring(j, idx);

    const val = arg.substring(++idx) ||
      (i + 1 === len ||
          String(args[i + 1]).charCodeAt(0) === 45
        ? true
        : args[++i]);

    const targets = j === 2 ? [name] : name;

    for (idx = 0; idx < targets.length; idx++) {
      name = targets[idx];

      if (strict && !strictKeys.includes(name)) {
        return opts.unknown!("-".repeat(j) + name);
      }

      toVal(out, name, idx + 1 < targets.length || val, {
        string: stringKeys,
        boolean: booleanKeys,
      });
    }
  }

  // Apply defaults
  if (defaults && opts.default) {
    for (const k in opts.default) {
      if (out[k] === undefined) {
        out[k] = opts.default[k];
      }
    }
  }

  // Apply aliases to output
  if (alibi) {
    for (const k in out) {
      const arr = alias[k] || [];
      while (arr.length > 0) {
        const aliasName = arr.shift();
        if (aliasName) out[aliasName] = out[k];
      }
    }
  }

  return out;
}

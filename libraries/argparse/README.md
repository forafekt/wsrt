# @wsrt/argparse

A tiny, dependency-free argument parser.

`@wsrt/argparse` is a fast, minimal CLI argument parser inspired by the classic Unix style. It supports aliases, booleans, strings, defaults, strict/unknown handling, and `--no-*` flags — without pulling in half the ecosystem.

Designed for **Deno-first tooling** and internal CLIs where control and predictability matter.

---

## Features

* 🚀 Zero dependencies
* 🦕 Deno-native
* 🔀 Short & long flag aliases
* 🔤 String & boolean typing
* 🔢 Automatic number coercion
* ❌ `--no-flag` support
* 🧠 Defaults inference
* 🔒 Strict mode with unknown handlers
* 📦 Very small footprint

---

## Installation

```bash
deno add jsr:@wsrt/argparse
```

```ts
import argparse from "@wsrt/argparse";
```

(Use your preferred import map or `deno.json` config.)

---

## Basic Usage

```ts
import argparse from "@wsrt/argparse";

const argv = argparse(Deno.args);

console.log(argv);
```

Running:

```bash
deno run cli.ts foo --bar 123
```

Produces:

```ts
{
  _: ["foo"],
  bar: 123
}
```

All positional arguments are stored in `argv._`.

---

## Options

```ts
interface Options {
  alias?: Record<string, string | string[]>;
  string?: string | string[];
  boolean?: string | string[];
  default?: Record<string, unknown>;
  unknown?: (arg: string) => Argv | never;
}
```

---

## Aliases

```ts
const argv = argparse(Deno.args, {
  alias: {
    h: "help",
    v: ["verbose", "debug"],
  },
});
```

```bash
--help      → help
-h          → help
-v          → verbose, debug
```

Aliases are fully bidirectional.

---

## String Options

Force arguments to be parsed as strings:

```ts
const argv = argparse(Deno.args, {
  string: ["name"],
});
```

```bash
--name 123
```

```ts
argv.name === "123";
```

---

## Boolean Options

```ts
const argv = argparse(Deno.args, {
  boolean: ["watch", "prod"],
});
```

Supported forms:

```bash
--watch
--watch=true
--watch=false
--no-watch
```

---

## Automatic Number Parsing

By default, values are coerced into numbers **only when valid**:

```bash
--port 3000
```

```ts
argv.port === 3000; // number
```

```bash
--tag v1
```

```ts
argv.tag === "v1"; // string
```

---

## Defaults

```ts
const argv = argparse(Deno.args, {
  default: {
    port: 3000,
    debug: false,
  },
});
```

Defaults also help infer types automatically.

---

## Strict Mode & Unknown Arguments

Enable strict mode by providing an `unknown` handler:

```ts
const argv = argparse(Deno.args, {
  alias: { h: "help" },
  unknown(arg) {
    throw new Error(`Unknown argument: ${arg}`);
  },
});
```

Any unknown flag will immediately error.

---

## `--` Separator

Everything after `--` is treated as positional:

```bash
cmd --foo bar -- --not-a-flag
```

```ts
argv._ === ["--not-a-flag"];
```

---

## Return Type

```ts
type Argv<T = Record<string, any>> = {
  _: unknown[];
} & T;
```

* Flags become properties
* Repeated flags become arrays
* Positional args always live in `_`

---

## Philosophy

This parser intentionally avoids:

* Nested config objects
* Command definitions
* Validation layers
* Opinionated UX

It’s a **primitive**, not a framework — meant to be composed into higher-level tooling like `@wsrt/cli`, build systems, or dev servers.

---

## License

[MIT](LICENSE)

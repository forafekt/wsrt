# @wsrt/commandline

A **Deno-first, composable command-line framework** for building modern CLIs with subcommands, typed options, nested flags, events, and rich help output.

`@wsrt/commandline` is designed to feel familiar if you’ve used tools like `commander`, but with a few strong opinions:

* Native **Deno support**
* Explicit command + option modeling
* Built-in **subcommands**, **aliases**, and **global options**
* Dot-notation options (`--config.db.host`)
* Variadic and required args (`<arg>`, `[arg]`, `[...args]`)
* Event-driven command lifecycle
* Zero Node.js shims

---

## Features

* 🧱 Subcommands with aliases
* 🌍 Global options shared across commands
* 🧠 Required, optional, and variadic arguments
* 🪜 Dot-nested options (`--env.prod.url`)
* 🔁 Option value transforms (typed arrays)
* 🧾 Automatic help & version output
* 🧩 Extensible help sections
* 📡 EventEmitter-based command hooks
* 🚫 Unknown option detection (configurable)
* 🦕 Pure Deno, no Node dependencies

---

## Installation

```bash
deno add jsr:@wsrt/commandline
```

```ts
import CommandLine from "@wsrt/commandline/mod.ts";
```

---

## Basic Usage

```ts
import CommandLine from "@wsrt/commandline/mod.ts";

const cli = new CommandLine("mycli");

cli
  .help()
  .version("1.0.0");

cli.parse(Deno.args);
```

Running:

```sh
$ mycli --help
$ mycli --version
```

---

## Defining Commands

Commands are defined using a concise syntax that also declares arguments.

```ts
cli.command("build <entry> [outDir]", "Build the project")
  .option("-m, --minify", "Minify output")
  .action((entry, outDir, options) => {
    console.log({ entry, outDir, options });
  });
```

### Argument Syntax

| Syntax      | Meaning            |
| ----------- | ------------------ |
| `<arg>`     | Required argument  |
| `[arg]`     | Optional argument  |
| `[...args]` | Variadic arguments |

---

## Options

### Boolean Options

```ts
.option("-f, --force", "Force overwrite")
```

### Options With Values

```ts
.option("-o, --output <dir>", "Output directory")
```

### Default Values

```ts
.option("--port <number>", "Server port", {
  default: 3000,
});
```

### Typed / Transformed Options

If `type` is an array, the option will always be coerced into an array.

```ts
.option("--tag <tag>", "Add tag", {
  type: [String],
});
```

```sh
--tag a --tag b
# => options.tag = ["a", "b"]
```

---

## Dot-Nested Options

Dot notation automatically builds nested objects.

```ts
.option("--db.host <host>", "Database host")
.option("--db.port <port>", "Database port")
```

```sh
--db.host localhost --db.port 5432
```

```ts
options.db.host // "localhost"
options.db.port // 5432
```

You can also use wildcards:

```ts
.option("--env.* <value>", "Environment variables")
```

---

## Global Options

Global options apply to **all commands**.

```ts
cli.option("-d, --debug", "Enable debug logging");
```

These are merged automatically into each command’s options.

---

## Help & Version

### Enable Help

```ts
cli.help();
```

Adds `-h, --help` automatically.

### Enable Version

```ts
cli.version("1.2.3");
```

Outputs:

```sh
mycli/1.2.3 darwin arm64
```

---

## Custom Help Sections

You can intercept and modify help output.

```ts
cli.help((sections) => {
  sections.push({
    title: "Environment",
    body: "MYCLI_DEBUG=1  Enable debug mode",
  });
  return sections;
});
```

---

## Examples

Add examples that show up in `--help`.

```ts
cli.example((bin) => {
  return `$ ${bin} build src/index.ts dist/`;
});
```

Or static examples:

```ts
cli.example("$ mycli build app.ts");
```

---

## Aliases

```ts
cli.command("serve", "Start server")
  .alias("s")
  .action(() => {});
```

```sh
mycli s
```

---

## Default Command

A command with an empty name acts as the default.

```ts
cli.command("", "Default command")
  .action(() => {
    console.log("No subcommand provided");
  });
```

---

## Unknown Options Handling

By default, unknown options throw an error.

You can opt out per command:

```ts
cli.command("run", "Run task")
  .allowUnknownOptions()
  .action(() => {});
```

---

## Ignoring Default Option Values

```ts
cli.command("test", "Run tests")
  .ignoreOptionDefaultValue();
```

This prevents default values from being injected automatically.

---

## Events

The CLI emits events during parsing:

```ts
cli.on("command:build", () => {
  console.log("Build command matched");
});

cli.on("command:*", () => {
  console.log("Unknown command");
});
```

---

## Parsing Without Running

```ts
const { args, options } = cli.parse(Deno.args, {
  run: false,
});
```

---

## Error Handling

All CLI errors throw `CommandLineError`.

```ts
import { CommandLineError } from "@wsrt/commandline/mod.ts";
```

You can catch and format them yourself if needed.

---

## Design Philosophy

* **Explicit over implicit**
* **Commands are data**
* **Help output is first-class**
* **No Node compatibility hacks**
* **Composable with other bootlane packages**

This package is intended to be a foundational building block for larger tooling ecosystems, not just one-off scripts.

---

## Related Packages

* `@wsrt/argparse`
* `@wsrt/events`

---

## License

[MIT](LICENSE)

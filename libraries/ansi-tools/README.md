# @wsrt/ansi-tools

> [!WARNING]
> This package is part of WSRT, which is under active early development. APIs, configuration, behavior, and package boundaries may change without notice. It is not currently recommended for production or critical workloads.

A lightweight, dependency-free collection of ANSI utilities for building rich, interactive terminal UIs

This package provides:
- 🎨 ANSI color and style helpers
- 🧭 Cursor movement and screen control
- 🧹 Erase, clear, and scroll utilities
- 📐 ANSI-aware text wrapping and measurement
- 🧠 Small helpers for CLI navigation logic

Designed for **CLI tools**, **prompts**, and **TUI-style interfaces** where control and correctness matter.

---

## Features

- ✅ Auto-detects ANSI color support (NO_COLOR, FORCE_COLOR, CI, TTY, Windows)
- 🎨 Chainable, safe color formatting
- 🧭 Full cursor control (move, hide/show, save/restore)
- 🧹 Line, screen, and scroll manipulation
- 📏 ANSI-aware `visibleLength()` and `wrapAnsi()`
- 🧩 Zero dependencies


---

## Installation

```bash
pnpm add @wsrt/ansi-tools
```

```ts
import {
  colors,
  createColors,
  cursor,
  erase,
  clear,
  scroll,
  beep,
  wrapAnsi,
  visibleLength,
  findCursor,
} from "@wsrt/ansi-tools";
````

---

## ANSI Colors & Styles

The `colors` export provides a full set of foreground, background, and style formatters.

```ts
import { colors } from "@wsrt/ansi-tools";

console.log(colors.red("Error"));
console.log(colors.bold(colors.green("Success")));
console.log(colors.bgBlue(colors.white(" Info ")));
```

### Available styles

* `bold`, `dim`, `italic`, `underline`
* `inverse`, `hidden`, `strikethrough`
* `reset`

### Foreground colors

* `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`
* `gray`
* `*Bright` variants (e.g. `redBright`)

### Background colors

* `bgBlack`, `bgRed`, `bgGreen`, `bgYellow`, etc.
* `bg*Bright` variants

---

## Color Support Detection

Color output is automatically enabled or disabled based on:

* `NO_COLOR`
* `FORCE_COLOR`
* `--no-color` / `--color` CLI flags
* TTY detection
* Windows support
* CI environments

You can also control this manually:

```ts
import { createColors } from "@wsrt/ansi-tools";

const colors = createColors(false); // force disable
```

---

## Cursor Control

Low-level cursor movement and visibility utilities.

```ts
import { cursor } from "@wsrt/ansi-tools";

Deno.stdout.writeSync(
  new TextEncoder().encode(
    cursor.hide +
    cursor.to(0, 0) +
    "Top-left!" +
    cursor.show,
  ),
);
```

### Cursor API

* `cursor.to(x, y?)`
* `cursor.move(x, y)`
* `cursor.up(count?)`
* `cursor.down(count?)`
* `cursor.forward(count?)`
* `cursor.backward(count?)`
* `cursor.nextLine(count?)`
* `cursor.prevLine(count?)`
* `cursor.hide`
* `cursor.show`
* `cursor.save`
* `cursor.restore`
* `cursor.clearLine`

---

## Erase, Clear & Scroll

### Erase parts of the screen

```ts
import { erase } from "@wsrt/ansi-tools";

console.log(erase.line);
console.log(erase.screen);
```

* `erase.line`
* `erase.lineStart`
* `erase.lineEnd`
* `erase.lines(count)`
* `erase.up(count?)`
* `erase.down(count?)`
* `erase.screen`

### Clear the terminal

```ts
import { clear } from "@wsrt/ansi-tools";

console.log(clear.screen);
```

### Scroll control

```ts
import { scroll } from "@wsrt/ansi-tools";

console.log(scroll.up(2));
console.log(scroll.down(1));
```

---

## ANSI-Aware Text Utilities

### `visibleLength()`

Correctly measures string length **excluding ANSI escape codes**.

```ts
import { visibleLength, colors } from "@wsrt/ansi-tools";

visibleLength(colors.red("Hello")); // 5
```

---

### `wrapAnsi()`

Wraps text to a specific width **without breaking ANSI formatting**.

```ts
import { wrapAnsi, colors } from "@wsrt/ansi-tools";

const text = colors.green("This is a long line with colors");
console.log(wrapAnsi(text, 20));
```

Options:

```ts
wrapAnsi(text, width, {
  hard: true, // hard-wrap long tokens
  trim: false, // trim line endings
});
```

---

### `wrapTextWithPrefix()`

Useful for logs, prompts, and tree-style output.

```ts
wrapTextWithPrefix(
  null,
  "This is a long message that should wrap",
  "│ ",
  "┌ ",
);
```

---

## CLI Navigation Helper

### `findCursor()`

Moves a cursor index while skipping disabled options.

```ts
import { findCursor } from "@wsrt/ansi-tools";

const options = [
  { label: "A" },
  { label: "B", disabled: true },
  { label: "C" },
];

const next = findCursor(0, 1, options); // skips disabled
```

Perfect for interactive menus and prompts.

---

## Beep

```ts
import { beep } from "@wsrt/ansi-tools";

console.log(beep);
```

---

## Design Goals

* 🧠 Small, composable primitives
* 🧰 Built for real CLI frameworks
* 🧪 Safe around ANSI edge cases
* 🚫 No dependencies

---

## License

[MIT](LICENSE)

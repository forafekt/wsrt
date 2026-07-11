# @wsrt/decouple

A lightweight and flexible configuration management library for Deno, inspired by layered environment systems. `@wsrt/decouple` allows you to define multiple configuration sources, access values in various types, and inspect how values are resolved across layers.  

Think of it as a **layered config system**: values from higher-priority sources override lower-priority ones, and you can freeze configurations to prevent accidental modification.

---

## Features

- Layered configuration with priority ordering  
- Supports multiple types: `string`, `number`, `boolean`, `json`, and `list`  
- `require` to enforce mandatory configuration keys  
- Extend and freeze configuration layers  
- Introspection with `explain` and `explainAll` for debugging  

---

## Installation

```bash
deno add jsr:@wsrt/decouple
````

Or import directly in your Deno project:

```ts
import { decouple } from "@wsrt/decouple/mod.ts";
```

---

## Usage

### Basic Example

```ts
import { decouple } from "@wsrt/decouple";

// Create a config with default layers
const config = decouple({
  PORT: "3000",
  DEBUG: "false",
});

// Access values
const port = config.number("PORT", 8000); // 3000
const debug = config.bool("DEBUG");       // false
```

```ts
const config = decouple([
  fromDenoEnv(),
  fromDotEnv(),
  fromDefaults({ PORT: "3000" }),
])
  .extend(fromObject({ DEBUG: "true" }))
  .freeze();
```

---

### Using Multiple Layers

Layers are ordered by priority: **first layer wins**. Later layers act as fallbacks.

```ts
import { decouple } from "@wsrt/decouple";

// Define multiple layers
const config = decouple([
  { PORT: "4000" },            // layer 0
  () => ({ PORT: "8000" }),    // layer 1, dynamic
  { PORT: undefined },         // layer 2
]);

console.log(config.number("PORT")); // 4000
```

---

### Extending and Freezing

```ts
config.extend({ DEBUG: "true" }); // add new layer
config.freeze();                  // prevent further changes

// Throws an error if you try to extend after freeze
// config.extend({ ANOTHER: "value" });
```

---

### Required Keys

```ts
const requiredVar = config.require("PORT"); // throws if undefined
```

---

### Debugging and Introspection

`explain` shows the resolution of a key across all layers:

```ts
console.log(config.explain("PORT"));
/*
{
  key: "PORT",
  resolved: "8000",
  sources: [
    { layer: 0, value: undefined },
    { layer: 1, value: "8000" },
    { layer: 2, value: "4000" }
  ]
}
*/
```

`explainAll` lists all keys and how they are resolved:

```ts
console.log(config.explainAll());
```

---

## API

### `decouple(source?: ConfigSource | ConfigSource[]): DecoupledConfig`

Creates a new `DecoupledConfig` instance.

* `source` – A single configuration source or an array of sources (object or function returning object). Defaults to an empty layer.

### `DecoupledConfig` Methods

| Method                                       | Description                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `get(key: string): DecoupledVar`             | Returns a `DecoupledVar` object for type conversions.                     |
| `string(key, defaultValue?)`                 | Returns the value as a string.                                            |
| `number(key, defaultValue?)`                 | Returns the value as a number.                                            |
| `bool(key, defaultValue?, truthy?, falsey?)` | Returns the value as a boolean, with optional custom truthy/falsey lists. |
| `json(key, defaultValue?)`                   | Parses the value as JSON.                                                 |
| `list(key, defaultValue?, sep?)`             | Splits a string into a list by separator (default `,`).                   |
| `require(key)`                               | Throws an error if the key is undefined.                                  |
| `extend(source: ConfigSource)`               | Adds a new layer at highest priority.                                     |
| `freeze()`                                   | Freezes the configuration, preventing further modifications.              |
| `explain(key)`                               | Returns detailed resolution info for a key.                               |
| `explainAll()`                               | Returns resolution info for all keys.                                     |

---

## Example: Layered Config

```ts
import { decouple, layer } from "@wsrt/decouple";

// Default layers
const config = decouple(layer())
  .extend({ PORT: "3000" })       // Layer 0
  .extend(() => ({ PORT: "4000" })) // Layer 1 (dynamic)
  .extend({ PORT: undefined })    // Layer 2
  .freeze();

console.log(config.number("PORT")); // 4000
console.log(config.explain("PORT"));
```

---

## Error Handling

`DecoupleError` is thrown if:

* You try to modify a frozen config
* A required key is missing

```ts
import { DecoupleError } from "@wsrt/decouple";

try {
  config.extend({ NEW: "value" }); // if frozen
} catch (err) {
  if (err instanceof DecoupleError) {
    console.error(err.message);
  }
}
```

---

## License

[MIT](LICENSE)

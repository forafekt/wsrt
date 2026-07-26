# `@wsrt/config`

> [!WARNING]
> This package is part of WSRT, which is under active early development. APIs, configuration, behavior, and package boundaries may change without notice. It is not currently recommended for production or critical workloads.

Loads and normalizes WSRT TypeScript, JavaScript, JSON, JSONC, and YAML system definitions. Install it when authoring a typed `wsrt.config.ts`.

```bash
pnpm add -D @wsrt/config
```

```ts
import { defineSystem } from "@wsrt/config";
export default defineSystem({ schemaVersion: "1", name: "example", tasks: {} });
```

Only the package root is public. Node 22+, ESM, and the fixed WSRT prerelease version are required. Configuration executes trusted local code; do not load untrusted configs.

Optional top-level sections accept `null` as “not configured” and normalize like
omission. Required values remain non-nullable.

The package owns the generated Draft 2020-12 schema at
`schema/wsrt.schema.json`, exported as `@wsrt/config/schema`. Regenerate it after
public model changes with `pnpm config:schema`, and detect drift in CI with
`pnpm config:schema:check`. Generation is deterministic and uses the same public
section metadata as runtime normalization and starter-template generation.

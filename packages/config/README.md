# `@wsrt/config`

Loads and normalizes WSRT TypeScript, JavaScript, JSON, JSONC, and YAML system definitions. Install it when authoring a typed `wsrt.config.ts`.

```bash
pnpm add -D @wsrt/config
```

```ts
import { defineSystem } from "@wsrt/config";
export default defineSystem({ schemaVersion: "1", name: "example", tasks: {} });
```

Only the package root is public. Node 22+, ESM, and the fixed WSRT prerelease version are required. Configuration executes trusted local code; do not load untrusted configs.

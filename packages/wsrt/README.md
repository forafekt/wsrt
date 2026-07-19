# wsrt

> WSRT is experimental pre-alpha software. APIs and package boundaries may change without notice; do not use it in production.

`wsrt` is the batteries-included distribution for most users. It supplies the official CLI, public configuration and control-plane APIs, and the default Node.js runtime through the existing modular `@wsrt/*` packages.

```bash
pnpm add -D wsrt@next
pnpm exec wsrt --help
```

```ts
import { createControlPlane, defineSystem } from "wsrt";

export default defineSystem({ schemaVersion: "1", name: "example", tasks: {} });

const plane = await createControlPlane({ root: process.cwd() });
```

Install `@wsrt/config`, `@wsrt/control-plane`, `@wsrt/capabilities`, runtime providers, or plugins directly when building integrations or selecting only part of the platform. Optional plugins are never activated by this package; install and configure them explicitly.

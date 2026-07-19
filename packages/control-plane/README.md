# `@wsrt/control-plane`

> [!WARNING]
> This package is part of WSRT, which is under active early development. APIs, configuration, behavior, and package boundaries may change without notice. It is not currently recommended for production or critical workloads.

The advanced programmatic API that loads a WSRT definition and owns lifecycle, execution, diagnostics, events, and plugin sessions. CLI users do not need to install it directly.

```bash
pnpm add @wsrt/control-plane
```

```ts
import { createControlPlane } from "@wsrt/control-plane";
const plane = await createControlPlane({ root: process.cwd() });
try { console.log(plane.snapshot()); } finally { await plane.dispose(); }
```

Only the root entry point is public. Node 22+ and ESM are required. The API is provisional before 1.0.

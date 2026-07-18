# `@wsrt/runtime-node`

WSRT's default Node.js runtime provider for local processes, readiness, networking, filesystem access, timers, and logging. It is installed transitively by the control plane; provider authors may use it directly.

```ts
import { NodeRuntimeProvider } from "@wsrt/runtime-node";
```

Only the root entry point is public. Node 22+ and ESM are required. Linux is CI-tested; macOS and Windows support remain provisional until release CI covers them.

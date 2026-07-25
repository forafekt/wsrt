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

## Execution and shutdown ownership

The control plane is the sole owner of lifecycle operations, node state, cancellation,
monitoring, restart policy, and runtime handles. Runtime providers own concrete resources.
The default Node runtime starts each execution in an isolated process group and exposes an
awaited, idempotent process-tree termination primitive. Stop and rollback first request
graceful termination, escalate after the configured grace period, and do not complete until
the root process exits. Unix signals the process group; Windows uses `taskkill /T` and
escalates with `/F`.

Startup and readiness failures run cleanup with an independent signal, so cancellation
cannot suppress rollback. Health monitors and restart timers are cancelled before
termination, and intentional stops are excluded from restart policy.

Transports that need an immediate acknowledgement can call `submit()`. It returns the
authoritative operation ID after registration while execution continues in the control
plane; snapshots and subscriptions expose progress and structured terminal failures.

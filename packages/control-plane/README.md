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

There is one composition root: `createControlPlane(options)`. The CLI, dashboard host,
MCP transport, and programmatic consumers all receive that same control plane. The
dashboard worker is only a serialized transport/view proxy; it does not construct a
second control plane or implement lifecycle policy.

Commands have explicit semantics and accepted entity kinds:

```ts
plane.submit({ type: "node.start", nodeIds: ["application:desktop"] });
await plane.execute({ type: "task.run", taskId: "task:build" });
await plane.execute({ type: "operation.cancel", operationId });
```

`node.start`, `node.stop`, and `node.restart` accept configured executable nodes.
`task.run` accepts only tasks. Canonical IDs take precedence; shorthand/name matches
must be unique, and kind mismatches are structured domain errors. Selection never
guesses execution intent.

Transports that need an immediate acknowledgement call `submit(command)`. Validation
and operation registration happen before the acknowledgement; execution continues in
the control plane and snapshots expose progress or terminal failure. `execute(command)`
awaits the same command path.

The retained implementation components have non-overlapping ownership: the loader
composes definitions, plugins, providers, graph, and lifecycle engine; the selector only
resolves graph identities; the lifecycle engine orders transitions; the execution
manager owns runtime handles and cleanup; the operation manager owns conflicts,
cancellation, and operation records; artifact and health managers own their respective
state machines; snapshot, event, and persistence managers publish and store state.

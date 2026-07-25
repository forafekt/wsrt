# `@wsrt/runtime-rust`

This package is a `RuntimeProvider` implementation of the same `@wsrt/capabilities` contract as `@wsrt/runtime-node`. The control plane, graph, readiness, health, restart, artifact, and lifecycle policies remain TypeScript-owned and contain no Rust-specific branches.

The provider starts `wsrt-runtime`, a versioned JSON-lines native host. Rust owns process-group supervision, output forwarding, exit observation, tree termination, shutdown cleanup, and TCP connection attempts. The adapter maps those operations to `ProcessHandle`, `NetworkCapability`, and runtime disposal. Filesystem, environment, process information, HTTP `Response`, timers, and logging use the host JavaScript implementation because their contracts contain synchronous values or Web Platform objects and crossing IPC would change their public semantics.

## Build and select

```sh
cargo build --workspace
pnpm --filter @wsrt/runtime-rust build
```

Debug builds resolve to `target/debug/wsrt-runtime` (`.exe` on Windows). Set `WSRT_RUST_PROFILE=release` for `target/release`, or set `WSRT_RUST_RUNTIME_BINARY` to an explicit packaged binary.

Register the provider through the existing control-plane provider option and select it in the normal system definition:

```ts
import { defineSystem } from "@wsrt/config";

export default defineSystem({
  name: "native-example",
  runtimes: { rust: { provider: "rust" } },
  services: {
    api: {
      runtime: "rust",
      command: { command: "node", args: ["server.mjs"] },
      healthcheck: { type: "tcp", host: "127.0.0.1", port: 4000 },
    },
  },
});
```

```ts
import { createControlPlane } from "@wsrt/control-plane";
import { NodeRuntimeProvider } from "@wsrt/runtime-node";
import { RustRuntimeProvider } from "@wsrt/runtime-rust";

const plane = await createControlPlane({
  providers: [new NodeRuntimeProvider(), new RustRuntimeProvider()],
});
await plane.start();
await plane.dispose();
```

The native host supports Linux, macOS, and Windows. Unix uses a new session/process group and signals the whole group. Windows uses `taskkill /T`; graceful Windows signals are limited by the operating system and may require forced termination. Shell commands follow the Node contract but callers should prefer `shell: false`, since shell quoting is platform-dependent in both implementations.

Run conformance and native checks with:

```sh
cargo test --workspace
pnpm build
node --test tests/runtime-conformance.test.mjs
```

Protocol stdout is reserved for bounded structured messages. Diagnostics go to stderr. Invalid input is ignored with a diagnostic, unsupported protocol versions receive a structured error, and an unexpected native-host exit rejects pending requests and settles active process handles with `RUNTIME_EXIT`.

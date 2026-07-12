# WSRT extension authoring

Extensions are explicit, instance-scoped contributions. A plugin packages providers; it is not itself a runtime or lifecycle engine.

```ts
import type { ExecutionAdapter } from "@wsrt/capabilities"

const command: ExecutionAdapter<{ executable: string }> = {
  id: "example-command",
  validate(value) {
    if (!value || typeof value !== "object" || !("executable" in value))
      return { diagnostics: ["executable is required"] }
    return { options: value as { executable: string }, diagnostics: [] }
  },
  prepare(options) {
    return { command: options.executable, args: [], shell: false }
  },
}

export const plugin = {
  id: "example",
  version: "1.0.0",
  contributions: { adapters: [command] },
}
```

Runtime providers create capability registries and dispose every resource they own. Execution adapters validate provider-owned options and translate nodes into commands. Readiness providers wait until dependency admission is safe. Health providers perform one check; the control plane owns scheduling and state transitions. Artifact providers generate or inspect outputs and report location, hash, and whether content changed.

Plugins declare `requires` and `optional` dependencies. Ordering is deterministic. Contribution IDs must be unique within their role. Tests should create multiple registries or control planes to prove isolation and should verify reverse-order disposal.

Extensions must not:

- use global mutable registries;
- spawn children outside runtime capabilities;
- own lifecycle state separately;
- mutate graph internals after execution begins;
- accept unvalidated provider options;
- import control-plane implementation files;
- expose convenience packages that forward unrelated APIs.

# WSRT architecture

WSRT describes a software system and executes its lifecycle. Configuration is normalized once, compiled into a `SystemGraph`, and operated through `@wsrt/control-plane`.

```text
@wsrt/graph              @wsrt/capabilities
      ↓                         ↓
@wsrt/config             @wsrt/runtime-node
      └──────────┬──────────────┘
                 ↓
          @wsrt/lifecycle
                 ↓
        @wsrt/control-plane
          ↓       ↓       ↓
        CLI      MCP    dashboard API
```

Package ownership is explicit: graph owns nodes and plans; config owns input, normalization, diagnostics, and graph compilation; capabilities owns portable runtime contracts; runtime-node implements them; lifecycle owns transitions and scheduling; control-plane coordinates processes, readiness, events, diagnostics, and artifacts. User interfaces only call the control plane.

The local vertical slice implements process and HTTP readiness. TCP readiness is modeled but awaits a networking capability. Durable state, scheduled health monitoring, deployments, distributed operation, and non-Node runtimes remain intentionally unimplemented.

The older workspace-inspection runtime remains while unrelated package-analysis, synchronization, and Vite features are migrated. New lifecycle code must not depend on it or on `@wsrt/types`.

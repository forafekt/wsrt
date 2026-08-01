# WSRT architecture

WSRT describes a software system and executes its lifecycle. Configuration is normalized once, compiled into a `SystemGraph`, and operated through `@wsrt/control-plane`.

## Authoritative workspace session

A configured workspace has at most one authoritative runtime session. The detached local workspace host is the only shared-session component that calls `createControlPlane`; it therefore owns the persistence lock, lifecycle engine, operation identities, managed processes, events, and snapshots. CLI and dashboard processes discover the canonical real path, derive its stable workspace identity, validate a versioned discovery record and handshake, and communicate over a Unix-domain socket or Windows named pipe using bounded length-prefixed JSON frames.

First-client startup is elected by atomic directory creation. The winner launches the host; other clients observe the discovery record with bounded readiness checks and validate workspace ID, session ID, PID/start identity, and protocol version. The record contains connection metadata, never runtime state. The dashboard worker owns only browser transport; its backend is a persistent workspace-session client.

`wsrt session stop` requests orderly shutdown. The host enters `stopping`, publishes `session.closing`, closes IPC, disposes its sole control plane and supervised processes, then removes the endpoint and discovery record. Configuration is loaded by the host and changes require a session restart in protocol version 1.

```text
@wsrt/graph              @wsrt/capabilities
      ↓                         ↓
@wsrt/config             @wsrt/runtime-node
      └──────────┬──────────────┘
                 ↓
          @wsrt/lifecycle
                 ↓
        @wsrt/control-plane ← @wsrt/persistence
          ↓       ↓       ↓
        CLI      MCP    dashboard API
```

Package ownership is explicit: graph owns nodes and plans; config owns input, normalization, diagnostics, and graph compilation; capabilities owns portable runtime contracts; runtime-node implements them; lifecycle owns transitions and scheduling; persistence owns storage contracts and versioned records; persistence-filesystem and persistence-memory implement those contracts; control-plane coordinates processes, readiness, events, diagnostics, persistence, and artifacts. User interfaces only call the control plane.

Dependency edges gate dependant startup. Each edge carries a condition — `started`, `ready` (the default), `healthy`, `successful` or `completed` — and lifecycle scheduling is dependency-driven rather than stage-synchronised: a node waits only on its own dependencies, at the level each edge declares. `started` and `ready` are lifecycle milestones the engine owns; `healthy` is delegated to the control plane through `LifecycleOptions.awaitHealthy`, because health is control-plane state. A node whose condition is not satisfied transitions to `blocked` and is never started. Execution plans remain stage-shaped for reporting and own cycle detection. Health continuously observes a node only after readiness succeeds. The Node runtime supplies HTTP, TCP, process, timer, filesystem and spawn capabilities. The control plane owns monitoring, restart scheduling, cancellation, snapshots, operations and artifact provenance. Persistence is workspace-local and optional; remote persistence, deployments, distributed operation, and published non-Node runtimes remain intentionally out of scope.

Health transitions are centralized: a new node is `unknown`, monitor startup makes it `checking`, the first failure makes it `degraded`, and the configured failure threshold makes it `unhealthy`. A success while unhealthy makes it `degraded`; the configured consecutive-success threshold makes it `healthy`. Expected stop returns health to `unknown`; unexpected exit makes it `unhealthy`. Pending restart remains unhealthy until the new instance passes checks. Generation guards discard stale check completions.

`never` does not restart. `on-failure` restarts non-zero or signalled exits; `always` also restarts clean exits. `attempts` counts restarts after the initial start. Exponential delay is `min(base × 2^(attempt-1), maximum)`. Manual stop/restart and disposal cancel pending delays. Application state is derived in the control plane from explicit child criticality rather than by clients.

Snapshots are immutable, revisioned JSON projections and are the only operational authority consumed by CLI, MCP and dashboard. Dashboard hydration uses a full snapshot and subsequent Server-Sent Events, suppressing duplicate revisions and refreshing after reconnect.

There is no legacy runtime or centralized type package. New integrations must depend on their domain-owning packages and operate through the control plane.

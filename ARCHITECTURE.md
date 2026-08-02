# WSRT architecture

WSRT describes a software system and executes its lifecycle. Configuration is normalized once, compiled into a `SystemGraph`, and operated through `@wsrt/control-plane`.

## Authoritative workspace model

WSRT exposes one authoritative, versioned, evidence-backed semantic model of a configured workspace. Declared architecture, discovered workspace packages, graph relationships, lifecycle and runtime state, health, diagnostics, operations, capabilities, explicit source ownership, task inputs and outputs, artifacts, and evidence-backed change impact are composed from the normalized definition and the active control-plane snapshot. Consumers must query this model through the workspace-session protocol; they must not reconstruct it from configuration files, package manifests, process state, or control-plane implementation objects.

The model does not claim authority over source-level symbols, arbitrary code meaning, undocumented business intent, Git history, or language-specific facts unless an installed plugin supplies explicit evidence. Public facts carry provenance and remain immutable, JSON-safe, deterministically ordered projections. Control-plane classes and mutable implementation state never cross the public protocol boundary.

Ownership is divided along existing boundaries:

- `@wsrt/config` owns authored configuration, validation, normalization, source associations, task inputs and outputs, and configuration provenance.
- `@wsrt/workspace` owns package discovery and package-manifest evidence.
- `@wsrt/graph` owns graph node and edge primitives and traversal mechanics.
- `@wsrt/control-plane` owns live lifecycle, health, operation, diagnostic, artifact, plugin, and revision state.
- `@wsrt/workspace-intelligence` owns the transport-neutral semantic projection, evidence records, bounded query models, deterministic composition, capability derivation, and later impact/planning projections. It receives existing authorities; it never scans a repository or creates a control plane.
- `@wsrt/workspace-session` owns the versioned wire contract, framing, discovery, request routing, host composition, typed client, errors, cancellation, and events. Protocol request and response types remain here rather than in another protocol package.
- CLI, MCP, dashboards, IDEs, and other integrations are adapters over the workspace-session client. They own presentation and transport adaptation only.

The intelligence package is a distinct domain boundary because the semantic projection is transport-neutral, combines several existing authorities, and must be reusable without depending on IPC. It is not folded into `control-plane`, whose responsibility remains mutable lifecycle orchestration, and it is not placed in `workspace-session`, whose responsibility remains protocol and host/client transport. A separate protocol package is not justified: workspace-session already owns version negotiation, envelopes, errors, framing, discovery, cancellation, and connection lifecycle.

Existing overlaps are resolved deliberately. `ControlPlaneSnapshot` remains the internal operational projection and supplies live evidence; the workspace intelligence snapshot is the sole public semantic projection rather than a replacement operational snapshot. `SystemGraph` remains the only graph representation and traversal source; public node and relationship descriptions are immutable serializations of it. `ResolvedWorkspace` remains package-discovery output rather than a competing workspace snapshot. Existing raw `definition.get`, `graph.get`, and snapshot protocol operations are retained for compatibility while new consumers migrate to typed workspace operations; adapters must not add new logic around those raw operations.

## Authoritative workspace session

A configured workspace has at most one authoritative runtime session. The detached local workspace host is the only shared-session component that calls `createControlPlane`; it therefore owns the persistence lock, lifecycle engine, operation identities, managed processes, events, and snapshots. CLI and dashboard processes discover the canonical real path, derive its stable workspace identity, validate a versioned discovery record and handshake, and communicate over a Unix-domain socket or Windows named pipe using bounded length-prefixed JSON frames.

First-client startup is elected by atomic directory creation. The winner launches the host; other clients observe the discovery record with bounded readiness checks and validate workspace ID, session ID, PID/start identity, and protocol version. The record contains connection metadata, never runtime state. The dashboard worker owns only browser transport; its backend is a persistent workspace-session client.

`wsrt session stop` requests orderly shutdown. The host enters `stopping`, invalidates leases, publishes `session.closing`, rejects or aborts outstanding work, disposes its sole control plane and supervised processes, closes IPC, then removes the endpoint and discovery record. Configuration is loaded by the host and changes require a session restart in protocol version 1.

Session ownership is validated against an operating-system process identity, not a PID alone. Linux identities combine the kernel boot ID with the process start tick from `/proc/<pid>/stat`; permission failures, live incompatible protocols, identity mismatches, and transient transport failures are never automatically recovered. Only a proven missing process or reused PID is classified as stale. The persistence lock records the same start identity.

Long-lived dashboard, MCP, and IDE clients use renewable, expiring leases. Ordinary CLI requests do not. The current lifetime policy is deliberately explicit: a started host remains available until `wsrt session stop` or `wsrt session restart`; leases are inspection and future idle-policy inputs rather than implicit process ownership. Dashboard actions remain in the host and cross IPC only as descriptors and correlated invocations. Caller cancellation sends a separate `request.cancel` message and aborts the matching host request without cancelling unrelated submitted operations.

The host fingerprints the normalized configuration together with the primary configuration and recursively discovered local imports. `session status` reports loaded/current fingerprints and changed sources; `diagnostics` publishes `WSRT_SESSION_CONFIGURATION_STALE`. Live graph replacement is intentionally unsupported, so `wsrt session restart` is the safe refresh command and stops managed nodes before loading the new configuration.

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
 @wsrt/workspace-intelligence
                 ↓
       @wsrt/workspace-session
          ↓       ↓       ↓
        CLI      MCP    dashboard API
```

Package ownership is explicit: graph owns nodes and plans; config owns input, normalization, diagnostics, and graph compilation; capabilities owns portable runtime contracts; runtime-node implements them; lifecycle owns transitions and scheduling; persistence owns storage contracts and versioned records; persistence-filesystem and persistence-memory implement those contracts; control-plane coordinates processes, readiness, events, diagnostics, persistence, and artifacts. Workspace intelligence composes the public semantic model, workspace-session is its authoritative host and protocol, and user interfaces use workspace-session clients.

Dependency edges gate dependant startup. Each edge carries a condition — `started`, `ready` (the default), `healthy`, `successful` or `completed` — and lifecycle scheduling is dependency-driven rather than stage-synchronised: a node waits only on its own dependencies, at the level each edge declares. `started` and `ready` are lifecycle milestones the engine owns; `healthy` is delegated to the control plane through `LifecycleOptions.awaitHealthy`, because health is control-plane state. A node whose condition is not satisfied transitions to `blocked` and is never started. Execution plans remain stage-shaped for reporting and own cycle detection. Health continuously observes a node only after readiness succeeds. The Node runtime supplies HTTP, TCP, process, timer, filesystem and spawn capabilities. The control plane owns monitoring, restart scheduling, cancellation, snapshots, operations and artifact provenance. Persistence is workspace-local and optional; remote persistence, deployments, distributed operation, and published non-Node runtimes remain intentionally out of scope.

Health transitions are centralized: a new node is `unknown`, monitor startup makes it `checking`, the first failure makes it `degraded`, and the configured failure threshold makes it `unhealthy`. A success while unhealthy makes it `degraded`; the configured consecutive-success threshold makes it `healthy`. Expected stop returns health to `unknown`; unexpected exit makes it `unhealthy`. Pending restart remains unhealthy until the new instance passes checks. Generation guards discard stale check completions.

`never` does not restart. `on-failure` restarts non-zero or signalled exits; `always` also restarts clean exits. `attempts` counts restarts after the initial start. Exponential delay is `min(base × 2^(attempt-1), maximum)`. Manual stop/restart and disposal cancel pending delays. Application state is derived in the control plane from explicit child criticality rather than by clients.

Snapshots are immutable, revisioned JSON projections and are the only operational authority consumed by CLI, MCP and dashboard. Dashboard hydration uses a full snapshot and subsequent Server-Sent Events, suppressing duplicate revisions and refreshing after reconnect.

There is no legacy runtime or centralized type package. New integrations must depend on their domain-owning packages and operate through the control plane.

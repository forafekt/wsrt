# WSRT

WSRT is a runtime-centric lifecycle platform for local software systems. One definition describes applications, services, processes, tasks, artifacts, environments, dependencies, runtimes, and plugins. WSRT normalizes that definition, compiles it into a graph, and operates it through one control plane.

Use WSRT when a project needs dependency-aware startup, readiness, task execution, artifact tracking, or several user interfaces over the same runtime state. Do not use it as a container orchestrator, deployment platform, or replacement for a package manager.

## System definition

WSRT loads `wsrt.config.ts`, JavaScript module formats, JSON/JSONC, or YAML. All formats become the same normalized model.

```yaml
schemaVersion: "1"
name: example
services:
  api:
    root: apps/api
    command: { command: node, args: [server.mjs] }
    healthcheck: { type: http, url: http://127.0.0.1:4000/health }
applications:
  web:
    command: { command: vite, args: [dev] }
    dependsOn: { api: { condition: healthy } }
tasks:
  contracts: { command: { command: node, args: [scripts/generate.mjs] } }
artifacts:
  api-client: { type: typescript-client, producer: contracts, consumers: [web] }
```

Unknown core properties and missing runtime, dependency, producer, or consumer references are diagnostics rather than silently accepted data.

## Architecture

`@wsrt/config` normalizes definitions and compiles `@wsrt/graph`. The graph owns stable nodes, containment, dependencies, traversal, cycle detection, and deterministic startup/shutdown plans. `@wsrt/lifecycle` executes those plans with explicit transitions, parallel safe stages, retries, cancellation, readiness, and structured events.

Portable contracts live in `@wsrt/capabilities`; `@wsrt/runtime-node` implements filesystem, environment, process, spawn, HTTP, timers, and logging. `@wsrt/control-plane` coordinates runtimes, lifecycle, processes, events, diagnostics, and first-class artifacts. CLI, MCP, and dashboard APIs depend only on the control plane.

Vite is an explicit plugin contribution, not a runtime. It translates Vite options into command and readiness configuration. Composite applications expand into application and child process graph nodes; the control plane owns their execution.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for dependency rules and domain terminology.

## CLI

Implemented commands are `validate`, `inspect`, `graph`, `up`, `down`, `start`, `stop`, `restart`, `run`, and `artifacts`.

```sh
pnpm build
node packages/cli/dist/index.js inspect --root examples/system-lifecycle
node packages/cli/dist/index.js run contracts --root examples/system-lifecycle
```

MCP offers semantic graph, state, event, diagnostic, artifact, and lifecycle operations. Mutations require explicit permission. The dashboard package exposes read projections and lifecycle operations over the same control plane; it owns no orchestration state.

## Example and extensions

`examples/system-lifecycle` contains equivalent TypeScript and YAML definitions, two HTTP processes with readiness ordering, a composite application, a finite task, and a generated artifact.

Runtime providers implement focused capability contracts. Plugins declare deterministic contributions. Integrations must not mutate control-plane internals or create independent lifecycle state.

## Current limitations

The implemented runtime is Node. Readiness supports processes and HTTP; TCP is modeled but awaits a networking capability. State is in memory. Continuous post-readiness health monitoring, deployments, non-Node runtimes, distributed operation, and durable state are deferred.

## Development

```sh
pnpm install
pnpm lint
pnpm check:architecture
pnpm typecheck
pnpm build
pnpm test
```
## Operational workflow

```sh
pnpm install
pnpm build
node packages/cli/dist/index.js run validate
```

The root configuration dogfoods architecture checking, lint, type-checking, building and tests without recursively invoking WSRT. `wsrt status`, `health`, `operations`, `events` and `artifacts` read the authoritative snapshot; `start`, `stop`, `restart`, `run` and `cancel` create or control revisioned operations.

Readiness and health are intentionally separate. Readiness admits dependants during startup. Health checks continue after startup and drive `checking`, `healthy`, `degraded` and `unhealthy` states, process-exit reporting, and configured restart policy. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the transition and backoff rules.

Declared task outputs are invalidated before execution, verified inside the workspace, hashed with SHA-256 and recorded with size and timestamps. A failed or missing output remains invalid/failed even if an older file still exists.

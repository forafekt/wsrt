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

Portable contracts live in `@wsrt/capabilities`; `@wsrt/runtime-node` implements filesystem, environment, process, spawn, HTTP, timers, and logging. `@wsrt/control-plane` coordinates runtimes, lifecycle, processes, events, diagnostics, and first-class artifacts. CLI and MCP depend only on core contracts. Optional plugins depend inward on those contracts; core packages never import concrete plugins.

Vite is an explicit plugin contribution, not a runtime. It translates Vite options into command and readiness configuration. Composite applications expand into application and child process graph nodes; the control plane owns their execution.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for dependency rules and domain terminology.

## CLI

Implemented commands include `validate`, `inspect`, `graph`, `up`, `down`, `start`, `stop`, `restart`, `run`, `exec`, and `artifacts`.

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
# Dashboard

`@wsrt/plugin-dashboard` is the local control-plane interface. The root configuration registers it explicitly with host `127.0.0.1`, port `5177`, base path `/__wsrt`, and browser opening disabled. Dashboard startup does not implicitly start system nodes.

Prerequisites and root startup:

```bash
pnpm install
pnpm build
pnpm dashboard
```

The command prints `WSRT Dashboard: http://127.0.0.1:5177/__wsrt`. You can also run:

```bash
pnpm add -D @wsrt/plugin-dashboard
pnpm run wsrt exec --list
pnpm run wsrt exec dashboard --config ./examples/system-lifecycle/wsrt.config.ts
pnpm run wsrt exec dashboard -- --host 127.0.0.1 --port 5177 --base-path /__wsrt
pnpm run wsrt exec dashboard -- --read-only --no-open
```

Configure the package explicitly with `plugins: [{ provider: "@wsrt/plugin-dashboard", options: { host: "127.0.0.1", port: 5177, basePath: "/__wsrt" } }]`.

`wsrt run <task>` runs a finite graph task. `wsrt exec <executable>` runs an executable contribution from the explicitly configured plugin set. Arguments after `--` are validated by that plugin. Press Ctrl+C for graceful disposal.

Programmatic use is available through `startDashboard(plane, options)`; the returned `{ url, host, port, basePath, close }` handle owns only the dashboard server. See `plugins/dashboard/README.md`.

Troubleshooting: a strict occupied port reports the bind failure; choose another port or use `--no-strict-port`. Custom base paths must begin with `/`. Failure to open a browser is only a warning—open the printed URL manually. A config-not-found error occurs before binding. Stopped nodes are expected until a dashboard action or `wsrt up` starts them. In restricted sandboxes, loopback listen may fail with `EPERM`; build and non-network tests remain usable.

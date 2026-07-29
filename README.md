# WSRT

WSRT runs the moving parts of a local software system as one dependency-aware
runtime.

Define your applications, services, workers, and tasks in one file. WSRT starts
them in the right order, waits until they are ready, monitors them, and shuts
them down cleanly.

> [!WARNING]
> **WSRT is alpha software intended for experimentation and feedback.**
>
> APIs and configuration may change, documentation is still evolving, and some
> features are incomplete. WSRT is not yet recommended for production
> workloads. Its first npm prerelease has not been published.

## What is WSRT?

A modern application is rarely one process. Local development might require an
API, a frontend dev server, a worker, a database proxy, and a contract-generation
step. Shell scripts can launch them, but they do not provide one reliable view of
readiness, health, dependencies, restarts, and cleanup.

WSRT turns that collection of processes into a local runtime:

- one configuration describes the system
- dependencies determine startup and shutdown order
- readiness controls when dependants may start
- health checks report whether running services remain healthy
- the CLI, dashboard, and integrations operate on the same state

WSRT manages local processes. It is not a container orchestrator or deployment
platform.

## Why WSRT?

Use WSRT when your project has several long-running processes whose lifecycles
are related:

- a frontend that must wait for an API
- an Electron application with a web UI and local backend
- workers that depend on supporting services
- multiple APIs or development servers
- local database emulators and proxies
- setup, code-generation, or build tasks

Instead of maintaining separate startup scripts and remembering which process
owns which terminal, describe the relationships once and operate the system as a
whole.

WSRT is probably not a good fit when:

- one `npm run dev` command already does everything you need
- the workload must be deployed or scheduled across machines
- containers are the authoritative runtime boundary
- the main problem is build caching rather than process lifecycle
- production-grade stability or long-term API compatibility is required today

## Features

- YAML, JSON, JavaScript, and TypeScript configuration
- dependency-aware startup and reverse-order shutdown
- readiness and continuous health checks
- configurable restart policies
- graceful termination with forced-kill fallback
- finite task execution and artifact tracking
- immutable, revisioned runtime snapshots
- bounded events and operation history
- optional workspace-local filesystem persistence
- extensible runtime and plugin contributions
- CLI, local dashboard, and MCP interfaces over one control plane

## Example

This workspace has an API and a frontend. The frontend starts only after the API
is healthy.

```yaml
schemaVersion: "1"
name: example

services:
  api:
    root: apps/api
    command:
      command: node
      args: [server.mjs]
    healthcheck:
      type: http
      url: http://127.0.0.1:4000/health

applications:
  web:
    root: apps/web
    command:
      command: vite
      args: [dev]
    dependsOn:
      api:
        condition: healthy

tasks:
  check:
    command:
      command: pnpm
      args: [test]
```

Save the file as `wsrt.yaml`, validate it, and start the long-running nodes:

```bash
wsrt config validate
wsrt up
```

WSRT waits for the API health endpoint before starting the frontend. When the
system is stopped, dependants are terminated before their dependencies.

### Dependency conditions

Each dependency declares how far its dependency must progress before the
dependant may start. Nodes wait per dependency, so unrelated work is not held
back by a shared stage.

| Condition    | The dependant starts once the dependency                     |
| ------------ | ------------------------------------------------------------ |
| `started`    | has been launched, without waiting for readiness             |
| `ready`      | has passed its readiness check (the default)                  |
| `healthy`    | has additionally reached `healthy` under its health checks    |
| `successful` | is a task that finished successfully                          |
| `completed`  | is a task that finished, successfully or not                  |

Omitting `condition` means `ready`. A dependant whose condition is never met is
reported as `blocked` rather than started. Conditions that cannot be satisfied —
`successful` or `completed` on a long-running node, `healthy` on a task — are
configuration errors and are reported by `wsrt config validate`.

## Getting started

The npm prerelease is still being prepared. Once published, the intended
installation is:

```bash
pnpm add -D wsrt@next
pnpm exec wsrt init
pnpm exec wsrt config validate
pnpm exec wsrt up
```

For development from this repository:

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js --help
```

Common commands:

```bash
wsrt init                    # Create a starter wsrt.yaml
wsrt config validate         # Validate configuration without starting runtimes
wsrt up                      # Start all long-running nodes
wsrt status                  # Show lifecycle and health state
wsrt inspect                 # Show the complete control-plane snapshot
wsrt start service:api       # Start a node and its dependencies
wsrt stop service:api        # Stop a node and its dependants
wsrt run check               # Run a finite task
wsrt down                    # Stop the workspace
```

Use `wsrt --help` or `wsrt <command> --help` for the complete command reference.

## Why not just…?

### npm scripts

npm scripts are excellent entry points for individual commands. WSRT can run
those same commands while adding dependency ordering, readiness, health,
restart behavior, shared state, and coordinated shutdown.

### Turborepo, Nx, and task runners

Repository task runners are designed around build graphs, caching, and efficient
finite work. WSRT focuses on the live runtime graph: processes that stay running,
become ready, change health, restart, and must be cleaned up. A project can use a
task runner for builds and WSRT for its local runtime.

### Docker Compose

Docker Compose is the natural choice when containers define the environment.
WSRT operates local processes and framework integrations without making
containers the runtime boundary. It can also launch commands that interact with
an existing Compose environment.

### PM2

PM2 is a mature process manager, especially for supervising Node.js
applications. WSRT models a broader local system with typed dependencies,
readiness conditions, finite tasks, artifacts, plugins, and several control
interfaces. For production Node.js process management, PM2 is the established
choice.

## How it works

```text
Configuration
      ↓
Normalization and validation
      ↓
Dependency graph
      ↓
Lifecycle plan
      ↓
Runtime execution
      ↓
Events, snapshots, CLI, and dashboard
```

Configuration is normalized into one system model and compiled into a graph.
The lifecycle engine derives deterministic start and stop plans. A control plane
then owns runtime processes, health, operations, events, and snapshots so every
interface observes the same state.

For deeper technical context, see [Architecture](./ARCHITECTURE.md).

## Plugins and integrations

Plugins extend WSRT without moving integration-specific behavior into the core.
The dashboard is an optional plugin, and the Vite integration contributes Vite
execution and readiness behavior. An MCP package exposes control-plane
inspection and permitted operations to MCP clients.

Plugins are loaded explicitly from workspace configuration. See
[Extensions](./EXTENSIONS.md) and the individual
[plugin documentation](./plugins).
Future integrations are expected to use the same explicit plugin boundaries;
they are not included in the current feature set.

## Design principles

- **Local-first:** manage the processes used to develop and operate a project
  locally.
- **Runtime-centric:** model running software, not only build commands.
- **Explicit dependencies:** make startup and shutdown relationships visible.
- **Deterministic lifecycle:** derive predictable plans from one graph.
- **One source of runtime state:** keep CLI, dashboard, and integrations in
  agreement.
- **Plugin boundaries:** integrations extend the system without becoming hidden
  core dependencies.
- **Framework agnostic:** execute declared runtimes without requiring one
  application framework.

## Current status

The Node.js runtime, configuration loaders, graph validation, lifecycle engine,
process supervision, persistence providers, CLI, dashboard, Vite integration,
and MCP interface are implemented and covered by integration tests. They are
ready for source-based experimentation, not production adoption.

The following areas remain provisional:

- public APIs and configuration compatibility
- package names and plugin contracts before the first release
- macOS and Windows release validation
- dashboard behavior and presentation
- operational recovery across unusual process failures

Rust runtime support is available for source-checkout experiments but is not
part of the planned first npm prerelease. Remote orchestration, deployment,
distributed state, and cloud persistence are not implemented.

## Documentation

- [First use](./docs/FIRST_USE.md)
- [Architecture](./ARCHITECTURE.md)
- [Extensions and plugins](./EXTENSIONS.md)
- [Package publication status](./docs/PUBLICATION.md)
- [Security](./docs/SECURITY.md)
- [System lifecycle example](./examples/system-lifecycle)

Package-specific READMEs document public APIs and ownership without duplicating
the project overview.

## Contributing

WSRT is early enough that bug reports, use-case feedback, documentation
corrections, and focused patches are especially useful. Before submitting a
change, run:

```bash
pnpm validate
```

Keep changes incremental, preserve package and plugin boundaries, and include
tests for lifecycle or compatibility behavior.

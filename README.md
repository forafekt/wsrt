# wsrt

wsrt is a runtime-first workspace orchestrator for JavaScript and TypeScript projects. It builds a live model of projects, packages, processes, services, events, diagnostics, artifacts, and tool integrations, then lets adapters such as Vite, Node, command processes, and composite projects run against that model.

## Vision

wsrt exists because modern workspaces are more than one dev server. A real application often has web apps, packages, Electron targets, workers, command processes, generated manifests, TypeScript path state, dashboards, and AI/tooling clients that all need the same understanding of the repository.

The long-term goal is to make wsrt a standalone workspace runtime: one queryable process model that can be used by CLIs, dashboards, MCP clients, adapters, plugins, and future automation. Vite is an important adapter, but it is not the architecture. The runtime owns discovery, configuration, graph state, lifecycle state, diagnostics, and extension points; adapters translate that runtime model into concrete tools.

Runtime-first means:

- The repository is modeled before individual tools are launched.
- Projects and processes are adapter-backed runtime objects.
- CLI, dashboard, MCP, artifacts, sync, and plugins inspect the same runtime state.
- Vite integration is optional and sits beside Node, command, and composite adapters.
- Future adapters can use the runtime without changing the core model.

## Features

Implemented today:

- Config loading from TypeScript, JavaScript, JSON, JSONC, YAML, and YAML config files.
- Config `extends`, environment/profile overrides, interpolation, and module references.
- Workspace package discovery from configured package globs.
- Package export and alias resolution for source-first development.
- Project and nested process modeling.
- Vite, Node, command, and composite project adapters.
- Runtime service registry with lifecycle state, health, logs, metrics-ready methods, and events.
- Runtime event bus and ordered timeline.
- Runtime query API used by CLI, dashboard, MCP, and artifacts.
- Diagnostics attached to config, projects, packages, adapters, sync, and integrations.
- Optional dashboard plugin with runtime pages and JSON APIs.
- MCP tool/resource state and in-process MCP tool execution helpers.
- Virtual imports for Vite and fallback generated modules.
- Artifact generation for reports, graph, packages, aliases, diagnostics, and virtual imports.
- tsconfig and manifest sync in `check` and `write` modes.
- First-party workspace, Git, TypeScript, dashboard, and Vite plugin surfaces.

Intentionally incomplete today:

- Remote URL module references are diagnosed but not downloaded, cached, or executed.
- Services expose lifecycle hooks, but durable supervision, restart policies, retained logs, metrics exporters, and remote process backends are future work.
- MCP support currently exposes runtime-backed state and tools in-process; production transport packaging is planned.
- Deployment orchestration and transactional workspace mutations are roadmap items.

## Architecture

The center of wsrt is `createWorkspaceRuntime()`. It loads config, resolves module references and profile overrides, discovers packages and projects, builds graph state, registers services, initializes plugins, creates virtual imports, and exposes one runtime object.

Major concepts:

- Runtime: the canonical in-memory model of the workspace.
- Adapters: implementations that start projects. Built-ins are `vite`, `node`, `command`, and `composite`.
- Projects: configured runtime units with a root, adapter, environment, server settings, and optional nested processes.
- Processes: child projects owned by a composite project, useful for Electron renderer/main/preload plus companion commands.
- Services: lifecycle records for projects or plugins. They can start, stop, restart, report health, expose logs, and expose metrics.
- Events: typed runtime events for creation, startup, services, diagnostics, tasks, commands, artifacts, and first-party plugins.
- Timeline: an ordered event log derived from runtime events.
- Query system: `runtime.query`, the shared inspection surface for CLI, dashboard, MCP, and reports.
- Graph: packages, project relationships, dependency edges, and query helpers.
- Diagnostics: structured messages with code, level, source, project, and detail.
- Plugins: runtime extensions with lifecycle hooks and optional dashboard/MCP contribution points.
- Tasks: finite workflows registered by core or plugins.
- Actions and commands: executable runtime commands, exposed through `runtime.commands` and `wsrt exec`.
- Artifacts: generated files such as reports, graph snapshots, alias data, diagnostics, and virtual import fallbacks.
- Config: merged and resolved project, workspace, runtime, sync, plugin, adapter, service, action, and dashboard settings.
- Dashboard: an optional runtime plugin that serves the browser UI and JSON APIs.
- MCP: runtime-backed entries and tool helpers for AI/tooling clients.
- Virtual imports: Vite virtual modules and fallback files representing runtime package/project state.
- Sync: tsconfig and manifest check/write operations backed by the runtime model.
- Manifests: generated wsrt manifests and package/extension manifest checks.
- tsconfig management: path and project-reference sync for configured workspaces.

## Installation

```bash
pnpm add -D @wsrt/core @wsrt/cli
```

For npm or yarn:

```bash
npm install -D @wsrt/core @wsrt/cli
yarn add -D @wsrt/core @wsrt/cli
```

WSRT packages are published as ESM packages and require a modern Node.js runtime. TypeScript is an optional peer dependency used by TypeScript-aware workflows.

## Quick Start

Create `wsrt.config.ts`:

```ts
import { defineWorkspace } from '@wsrt/core'

export default defineWorkspace({
  workspace: {
    packages: ['./packages/*'],
  },
  projects: {
    web: {
      root: './apps/web',
      adapter: 'vite',
      vite: { configFile: './apps/web/vite.config.ts' },
      server: { host: '127.0.0.1', port: 5173 },
    },
  },
  dashboard: true,
})
```

Run the project through the runtime:

```bash
pnpm wsrt run dev
```

Inspect runtime state:

```bash
pnpm wsrt query overview --json
pnpm wsrt query projects
pnpm wsrt query graph
```

Use the runtime from Node:

```ts
import { createWorkspaceRuntime } from '@wsrt/core'

const runtime = await createWorkspaceRuntime({ root: process.cwd() })

console.log(runtime.query.overview())
console.log(runtime.query.projects())

await runtime.start()
await runtime.stop()
```

## Configuration

wsrt discovers these root config files:

- `wsrt.config.ts`, `wsrt.config.mts`, `wsrt.config.cts`
- `wsrt.config.js`, `wsrt.config.mjs`, `wsrt.config.cjs`
- `wsrt.json`
- `wsrt.jsonc`
- `wsrt.yaml`
- `wsrt.yml`

TypeScript and JavaScript configs can export executable plugin, adapter, task, service, and command objects directly. JSON, JSONC, and YAML are intended to be first-class for data-only configuration and can use module references for executable extension points.

```yaml
workspace:
  packages:
    - ./packages/*

runtime:
  environment: development
  profile: local

plugins:
  - ./plugins/local-plugin
  - package: wsrt-plugin-example
    options:
      enabled: true

adapters:
  - path: ./adapters/custom-adapter

tasks:
  - path: ./tasks/generate-docs
    export: docsTask
```

Module references can be strings or objects:

```ts
type WsrtModuleReference =
  | string
  | {
      path?: string
      package?: string
      url?: string
      export?: string
      options?: Record<string, unknown>
    }
```

Strings beginning with `.`, `/`, or `file:` are paths. `http://` and `https://` strings are URL references. Other strings are package references. Path and package references are implemented; URL references currently fail with an explicit diagnostic because remote loading is not enabled yet.

## Projects

Projects are named runtime units:

```ts
export default defineWorkspace({
  projects: {
    web: {
      root: './apps/web',
      adapter: 'vite',
      vite: { configFile: './apps/web/vite.config.ts' },
    },
    worker: {
      root: './apps/worker',
      adapter: 'node',
      command: 'node ./worker.js',
    },
  },
})
```

If `adapter` is omitted, wsrt infers:

- `composite` when `processes` is present.
- `vite` when `vite` config is present.
- `command` otherwise.

Each project becomes a runtime service with an id such as `project:web`.

## Processes

Processes are nested projects. They inherit environment from the parent and can depend on sibling processes.

```ts
export default defineWorkspace({
  projects: {
    desktop: {
      root: './apps/desktop',
      adapter: 'composite',
      processes: [
        {
          name: 'renderer',
          root: './apps/desktop',
          adapter: 'vite',
          vite: { configFile: './apps/desktop/vite.config.ts' },
        },
        {
          name: 'main',
          root: './apps/desktop',
          adapter: 'vite',
          vite: { configFile: './apps/desktop/vite.main.config.ts', command: 'build' },
        },
        {
          name: 'electron',
          root: './apps/desktop',
          adapter: 'command',
          command: 'electron .',
          dependsOn: ['renderer', 'main'],
        },
      ],
    },
  },
})
```

The child processes above are exposed as `desktop:renderer`, `desktop:main`, and `desktop:electron`.

## Composite Projects

The composite adapter starts child processes in dependency order and returns one handle for the parent project. It is useful when one application is made from multiple runtime targets, such as an Electron renderer dev server, a main-process build, a preload build, and an Electron command.

Composite process supervision is currently lightweight. wsrt starts and closes the child handles, but durable restart/backoff policies are planned work.

## Adapters

Built-in adapters:

- `vite`: loads the user's Vite config, injects wsrt aliases and virtual modules when needed, starts a dev server, or runs Vite build/build-watch.
- `node`: delegates to the command adapter for Node-style commands.
- `command`: spawns the configured command in the project root with the resolved environment.
- `composite`: starts nested processes with dependency ordering.

Vite users can also add the direct Vite plugin:

```ts
import { wsrt } from '@wsrt/plugin-vite'

export default {
  plugins: [wsrt()],
}
```

When launched through wsrt, duplicate Vite plugin injection is avoided.

## Environment

Project environments are resolved into spawn-ready string values and masked display entries.

```ts
export default defineWorkspace({
  projects: {
    api: {
      root: './apps/api',
      adapter: 'node',
      command: 'node ./server.js',
      environment: {
        NODE_ENV: '${runtime.environment}',
        API_URL: 'http://localhost:${server.port}',
        FEATURE_FLAG: true,
        RETRY_COUNT: 3,
        SECRET_TOKEN: '${env.SECRET_TOKEN}',
        REMOVE_THIS: null,
      },
    },
  },
  server: { port: 3000 },
})
```

Merge behavior:

- Parent composite environment is merged into child process environment.
- Child keys override parent keys.
- `null` and `undefined` omit a key from the spawned environment.
- Booleans become `1` or `0`.
- Numbers become strings.
- Sensitive keys containing words such as `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`, `CREDENTIAL`, or `KEY` are masked in runtime display entries.

Interpolation supports values such as `${root}`, `${runtime.environment}`, `${runtime.profile}`, `${env.NAME}`, `${server.port}`, and other config paths. References inside project/service environments produce targeted diagnostics when unresolved.

Service output interpolation is not a separate implemented feature today; service definitions can expose metadata, health, logs, and metrics through runtime APIs.

## Plugins

Plugins extend the runtime instead of patching individual tools. A plugin can adjust config, observe runtime creation, inspect packages and graph state, add diagnostics, contribute dashboard routes/pages, add MCP tools, and react to artifacts or project lifecycle events.

```ts
export default {
  name: 'example',
  runtimeCreated({ runtime }) {
    runtime.diagnostics.add({
      level: 'info',
      code: 'plugin.example',
      message: 'Example plugin loaded',
    })
  },
  dashboardRoutes(routes) {
    routes.push({ id: 'example', label: 'Example', path: '#example' })
  },
  mcpTools(tools) {
    tools.push({
      id: 'example.status',
      title: 'Example status',
      description: 'Return example plugin status.',
      kind: 'tool',
    })
  },
}
```

First-party plugins currently include workspace, Git, TypeScript, dashboard, and Vite integration surfaces. Local plugins and package plugins are implemented through module references. URL plugins are represented in config but intentionally disabled until remote download/cache policy is implemented.

## Dashboard

The dashboard is an optional runtime plugin enabled with:

```ts
export default defineWorkspace({
  dashboard: true,
})
```

Run it with:

```bash
pnpm wsrt run dashboard
```

The dashboard serves pages and APIs for overview, projects, packages, services, graph, diagnostics, sync, virtual imports, plugins, artifacts, MCP, tasks, timeline, config, aliases, exports, and settings. It also exposes live event updates over server-sent events.

## MCP

wsrt builds MCP state from the runtime and exposes helpers for running registered tools in-process:

```ts
import { createWorkspaceRuntime, runMcpTool } from '@wsrt/core'

const runtime = await createWorkspaceRuntime({ root: process.cwd() })
const overview = runMcpTool(runtime, 'workspace.overview')
```

Built-in MCP tools/resources cover overview, projects, packages, graph, diagnostics, events, timeline, services, health, artifacts, config, import resolution, dependency queries, and runtime reports. Production server transport packaging is planned.

## CLI

The CLI is organized around runtime command groups.

```bash
wsrt run
wsrt run dev
wsrt run dashboard
wsrt run service project:web start

wsrt task list
wsrt task validate
wsrt task graph
wsrt task snapshot
wsrt task tsconfig write
wsrt task manifests write

wsrt exec service project:web restart
wsrt exec graph
wsrt exec mcp workspace.overview
wsrt exec eslint .

wsrt query overview --json
wsrt query projects
wsrt query packages
wsrt query services
wsrt query graph
wsrt query diagnostics
wsrt query events
wsrt query timeline
wsrt query config
wsrt query artifacts
wsrt query tasks
wsrt query cli
wsrt query resolve @scope/pkg
```

Aliases are kept for compatibility and discoverability:

- `wsrt dev` maps to the `run` group.
- `wsrt dashboard` maps to `run dashboard`.
- `wsrt inspect`, `wsrt graph`, and `wsrt resolve` map to runtime queries.
- `wsrt tsconfig`, `wsrt manifests`, and `wsrt artifacts` map to tasks.

## Runtime Model

The runtime flow is:

1. Discover and load a wsrt config file.
2. Merge `extends`, environment overrides, profile overrides, and programmatic inline config.
3. Resolve interpolation and executable module references.
4. Add first-party plugins.
5. Discover workspace packages and exports.
6. Resolve projects and process trees.
7. Build aliases, virtual imports, graph state, diagnostics, services, tasks, commands, CLI groups, MCP state, and dashboard state.
8. Expose the model through `runtime.query`, dashboard APIs, MCP helpers, artifacts, and CLI commands.
9. Start adapter-backed services only when requested.

## Examples

### Vite App

```ts
export default defineWorkspace({
  workspace: { packages: ['./packages/*'] },
  projects: {
    web: {
      root: './apps/web',
      adapter: 'vite',
      vite: { configFile: './apps/web/vite.config.ts' },
      server: { port: 5173 },
    },
  },
})
```

### Node App

```ts
export default defineWorkspace({
  projects: {
    worker: {
      root: './apps/worker',
      adapter: 'node',
      command: 'node ./src/index.js',
      environment: {
        NODE_ENV: '${runtime.environment}',
      },
    },
  },
})
```

### Electron App

```ts
export default defineWorkspace({
  projects: {
    desktop: {
      root: './apps/desktop',
      adapter: 'composite',
      processes: [
        { name: 'renderer', root: './apps/desktop', adapter: 'vite' },
        {
          name: 'main',
          root: './apps/desktop',
          adapter: 'vite',
          vite: { configFile: './apps/desktop/vite.main.config.ts', command: 'build' },
        },
        {
          name: 'electron',
          root: './apps/desktop',
          adapter: 'command',
          command: 'electron .',
          dependsOn: ['renderer', 'main'],
        },
      ],
    },
  },
})
```

### Composite Project

```ts
export default defineWorkspace({
  projects: {
    stack: {
      root: '.',
      adapter: 'composite',
      processes: {
        api: {
          root: './apps/api',
          adapter: 'node',
          command: 'node ./server.js',
        },
        web: {
          root: './apps/web',
          adapter: 'vite',
          dependsOn: ['api'],
        },
      },
    },
  },
})
```

## API

Primary exports from `@wsrt/core`:

```ts
import {
  createWorkspaceRuntime,
  defineWorkspace,
  defineProject,
  commandAdapter,
  compositeAdapter,
  nodeAdapter,
  viteAdapter,
  dashboardPlugin,
  startDashboard,
  gitPlugin,
  typeScriptPlugin,
  workspacePlugin,
  wsrt,
} from '@wsrt/core'
```

Important runtime APIs:

- `runtime.start()` and `runtime.stop()`
- `runtime.runProject(name)`
- `runtime.resolve(specifier)`
- `runtime.query.*`
- `runtime.services.*`
- `runtime.tasks.*`
- `runtime.commands.*`
- `runtime.cli.*`
- `runtime.diagnostics.*`
- `runtime.graph.*`
- `runtime.syncTsconfig(mode)`
- `runtime.syncManifests(mode)`
- `runtime.generateArtifacts()`
- `runtime.getVirtualModule(id)`
- `runtime.setPluginData(plugin, key, data)`

Subpath exports:

```ts
import { wsrt } from '@wsrt/plugin-vite'
import { createWorkspaceRuntime } from '@wsrt/runtime'
import { dashboardPlugin } from '@wsrt/plugin-dashboard'
import { gitPlugin } from '@wsrt/plugin-git'
import { typeScriptPlugin } from '@wsrt/plugin-typescript'
import { workspacePlugin } from '@wsrt/plugin-workspace'
```

## Plugin Development

A plugin is a plain object with a `name` and optional hooks:

```ts
import type { WsrtPlugin } from '@wsrt/core'

export default function myPlugin(): WsrtPlugin {
  return {
    name: 'my-plugin',
    config(config) {
      return config
    },
    runtimeCreated({ runtime }) {
      runtime.setPluginData('my-plugin', 'status', { ready: true })
    },
    artifactsGenerated(artifacts) {
      console.log(artifacts.length)
    },
  }
}
```

Contribution points include config transforms, runtime lifecycle hooks, package/alias/graph/diagnostic observation, project lifecycle hooks, artifact hooks, dashboard routes/pages, and MCP tool entries.

Package plugins can expose metadata through `package.json`:

```json
{
  "name": "wsrt-plugin-example",
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": "./dist/index.js" },
  "wsrt": {
    "type": "plugin",
    "name": "example",
    "entry": "./dist/index.js",
    "capabilities": ["dashboard", "mcp"]
  }
}
```

## Roadmap

Current:

- Runtime model, package discovery, graph, aliases, diagnostics, services, events, timeline, query API, CLI groups, tasks, commands, dashboard, MCP helpers, artifacts, tsconfig sync, manifest sync, virtual imports, config references, first-party plugins, and built-in adapters.

Near-term:

- Better process supervision and restart policies.
- Structured log capture and retention.
- Scheduled health checks and dashboard history.
- Stronger Electron-specific adapter metadata.
- More complete MCP server transport packaging.
- More examples and fixture projects.
- Cleaner publishing layout that separates source, generated output, and examples.

Long-term:

- Remote service backends.
- Deployment providers.
- Metrics exporters.
- Remote plugin/module loading with explicit cache and trust policy.
- Transactional package generation, renaming, and movement.
- Runtime snapshots for CI and hosted dashboards.

## Contributing

Install dependencies from the workspace root:

```bash
pnpm install
```

Common package commands:

```bash
pnpm --filter @wsrt/core typecheck
pnpm --filter @wsrt/core build
pnpm test
```

The package currently relies on the workspace lint command:

```bash
pnpm exec biome lint packages-dev/wsrt
```

Keep changes runtime-first. Prefer adding behavior to the runtime model and exposing it through query APIs, services, events, plugins, and adapters instead of letting one tool rescan or own separate state.

## Philosophy

wsrt is runtime-first, adapter-driven, plugin-driven, standalone, generic, and intentionally not locked to one framework. Vite is supported deeply because it is useful, but the runtime should remain usable from plain Node, command processes, Electron projects, dashboards, MCP clients, and future adapters.

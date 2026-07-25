# @wsrt/plugin-dashboard

> [!WARNING]
> This package is part of WSRT, which is under active early development. APIs, configuration, behavior, and package boundaries may change without notice. It is not currently recommended for production or critical workloads.

The local WSRT control-plane dashboard. It serves a base-path-aware browser client, JSON API, and Server-Sent Events stream from one existing `WsrtControlPlane`.

Install and configure it explicitly:

```bash
pnpm add -D @wsrt/plugin-dashboard
pnpm exec wsrt exec --list
pnpm exec wsrt exec dashboard -- --host 127.0.0.1 --port 5177 --open
```

```ts
plugins: [{ provider: "@wsrt/plugin-dashboard", options: { basePath: "/__wsrt" } }]
```

```ts
import { createControlPlane } from "@wsrt/control-plane";
import { startDashboard } from "@wsrt/plugin-dashboard";

const plane = await createControlPlane({ config: "./wsrt.config.ts" });
const dashboard = await startDashboard(plane, {
  host: "127.0.0.1", port: 5177, basePath: "/__wsrt", open: false,
});
console.log(dashboard.url);
await dashboard.close();
await plane.dispose();
```

`startDashboard` never owns or disposes the supplied control plane. Its returned handle closes every open SSE response and the HTTP server.

## Dashboard v3 experience

The responsive workbench groups pages into Workspace, Operations, Observe, and
System navigation. Desktop navigation can be collapsed and becomes an accessible
drawer on mobile. Overview summarizes lifecycle, health, operations, artifacts,
and recent activity; dedicated views cover the graph, nodes, tasks, operations,
artifacts, events, diagnostics, health, plugins, providers, and redacted
configuration.

Press `Ctrl+K` or `Cmd+K` to search pages and nodes. The graph supports keyboard
selection and zoom/fit controls, and preserves selection during live revisions.
Selecting a graph, explorer, or table node opens one synchronized inspector with
runtime facts, relationships, artifacts, health counters, operations, and a recent
timeline. Event streaming can be paused while the authoritative snapshot continues
to advance; resuming catches the view up deterministically. Lifecycle actions surface
pending feedback and confirmations for stop/restart; when `mutations: false`, the
same controls are visibly disabled with an explanation.

Theme selection cycles through system, light, and dark modes and is stored only in
the browser. Sidebar state is also local. Both themes honor reduced-motion and the
layout adapts across mobile, tablet, and desktop widths without page-level
horizontal overflow.

## Architecture

Dashboard v3 is a small dependency-free workbench. The server adapts one existing
control plane into a redacted JSON API and an SSE snapshot stream; it neither owns
the plane nor changes its contracts. The browser client is split into routing,
immutable state reduction, snapshot transport, page renderers, layout, and shared
styles. Pages derive their display model from the latest snapshot, so there is no
second authoritative cache and reconnects remain deterministic.

```text
third-party plugin ──serializable contribution──┐
                                                v
WSRT plugin discovery ──> control plane ──> dashboard adapter ──HTTP/SSE──> workbench
                              ^                     |
                              └── public operations─┘
```

The wire snapshot declares `protocolVersion: 3` and a monotonic control-plane
revision. The browser rejects incompatible, duplicate, and stale snapshots. SSE
reconnects use `Last-Event-ID`, refresh from the snapshot endpoint, then
resubscribe. The control plane bounds operation and event journals; the UI renders
bounded tails rather than creating an unbounded browser history. Clearing logs
only clears the local visible projection.

The shell provides Overview, Workspace Explorer, Graph, Nodes, Operations, Tasks,
Artifacts, Events, Logs, Diagnostics, Health, Metrics, Timeline, Plugins,
Providers, Configuration, and Settings. A persistent status bar and `Ctrl/Cmd+K`
palette expose live health, navigation, and entity search across nodes, operations,
artifacts, plugins, and extension pages.

## Dashboard contributions

Plugins contribute serializable UI models through the generic `dashboard`
registry; the dashboard never imports a plugin implementation. Pages appear in an
Extensions sidebar section, widgets and panels can be composed into built-in
surfaces, and actions execute through the contribution invocation boundary.
Supported declarative surfaces are pages, navigation, overview widgets, commands,
inspector sections, badges, graph decorations, diagnostic and event renderers,
artifact and operation actions, metric panels, status items, and generic panels.

```ts
definePlugin({
  id: "example", version: "1.0.0", capabilities: ["dashboard"],
  contributions: { dashboard: [{
    id: "releases", kind: "page", title: "Releases",
    load: (context, signal) => ({ title: "Latest", status: "ready" }),
  }] },
});
```

View models must be JSON-serializable and are limited to 1 MB per contribution.
HTML, React components, and client modules are intentionally not accepted. IDs,
kinds, metadata, refresh intervals, and serializability are validated at the
adapter boundary; duplicates and failures become isolated error view models so
one extension cannot prevent the workbench loading. Contribution loading and
actions receive scoped plugin context and an abort signal.

Use `kind: "page"` for a full extension page, `kind: "command"` for a palette
command, `kind: "inspector"` with a node-oriented `target` for inspector data,
`kind: "graph-decoration"` for node or edge decoration models, or
`kind: "metric-panel"` for real measurements exposed by the plugin. Testing a
contribution should cover `validateDashboardContribution`, load failure, and
action invocation through the control-plane contribution boundary.

## Transport and security

The server defaults to `127.0.0.1`, emits no environment values, redacts
configuration keys resembling secrets, serves a fixed asset root, applies
`nosniff`, and exposes no browser code-execution endpoint. Mutations can be
disabled with `--read-only`. Binding to a non-loopback address exposes workspace
state and operation endpoints to that network; place an authenticated reverse
proxy in front of WSRT and disable mutations unless they are required. Dashboard
shutdown closes SSE clients, unsubscribes snapshot listeners, clears heartbeats,
and then closes the HTTP server. The dashboard never owns the supplied control
plane.

## Known limitations

- WSRT does not currently expose CPU or memory time series, so v3 does not invent
  them. Metrics show only values derivable from public snapshots and contributions.
- The event journal is the only current structured output source; process stdout
  is shown only when a provider emits it as an event.
- Configuration is read-only and source locations are shown only when supplied by
  the configuration diagnostics.
- Graph layout is deterministic and lightweight; very large graph clustering and
  minimap support remain future work.

## Development and testing

Run `pnpm --filter @wsrt/plugin-dashboard typecheck`, `pnpm run build`, and
`node --test tests/dashboard-client.test.mjs tests/plugin-architecture.test.mjs`.
The client tests cover routing, monotonic/protocol snapshot updates, paused live
inspection, preserved interaction state, contribution validation and isolation,
and SSE cleanup. The workspace test suite additionally covers API integration,
plugin isolation, lifecycle operations, and architecture boundaries.

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

## Dashboard experience

The responsive workbench groups pages into Workspace, Operations, Observe, and
System navigation. Desktop navigation can be collapsed and becomes an accessible
drawer on mobile. Overview summarizes lifecycle, health, operations, artifacts,
and recent activity; dedicated views cover the graph, nodes, tasks, operations,
artifacts, events, diagnostics, health, plugins, providers, and redacted
configuration.

Press `Ctrl+K` or `Cmd+K` to search pages and nodes. The graph supports keyboard
selection and zoom/fit controls, and preserves selection during live revisions.
Event streaming can be paused while inspecting history. Lifecycle actions surface
pending feedback and confirmations for stop/restart; when `mutations: false`, the
same controls are visibly disabled with an explanation.

Theme selection cycles through system, light, and dark modes and is stored only in
the browser. Sidebar state is also local. Both themes honor reduced-motion and the
layout adapts across mobile, tablet, and desktop widths without page-level
horizontal overflow.

## Architecture

Dashboard 2.0 is a small dependency-free workbench. The server adapts one existing
control plane into a redacted JSON API and an SSE snapshot stream; it neither owns
the plane nor changes its contracts. The browser client is split into routing,
immutable state reduction, snapshot transport, page renderers, layout, and shared
styles. Pages derive their display model from the latest snapshot, so there is no
second authoritative cache and reconnects remain deterministic.

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

```ts
definePlugin({
  id: "example", version: "1.0.0", capabilities: ["dashboard"],
  contributions: { dashboard: [{
    id: "releases", kind: "page", title: "Releases",
    load: (context, signal) => ({ title: "Latest", status: "ready" }),
  }] },
});
```

View models must be JSON-serializable. HTML and client modules are intentionally
not accepted. Contribution loading and actions receive scoped plugin context and
an abort signal; failures are returned as an error boundary inside the page and
are also reflected by the operational contribution system.

## Development and testing

Run `pnpm --filter @wsrt/plugin-dashboard typecheck`, `pnpm run build`, and
`node --test tests/dashboard-client.test.mjs tests/plugin-architecture.test.mjs`.
The client tests cover routing, immutable snapshot updates, preserved interaction
state, contribution models, and SSE cleanup. The workspace test suite additionally
covers API integration, plugin isolation, lifecycle operations, and architecture.

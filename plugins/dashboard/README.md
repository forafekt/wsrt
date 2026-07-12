# @wsrt/plugin-dashboard

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

# @wsrt/plugin-dashboard

> [!WARNING]
> This package is part of WSRT, which is under active early development. APIs, configuration, behavior, and package boundaries may change without notice. It is not currently recommended for production or critical workloads.

The local WSRT control-plane dashboard. It serves a base-path-aware browser client, JSON API, and Server-Sent Events stream from one existing `WsrtControlPlane`.

![Alt text](./screenshot.png?raw=true "Dashboard")

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
the browser. The versioned `wsrt.layout.v1` preference stores sidebar, inspector,
and bottom-panel dimensions, collapse states, maximization, and the active runtime
tab. Drag resize handles with the pointer, use arrow keys while a handle is
focused, or press `Home`/double-click to reset one dimension. Settings provides a
full layout reset. Narrow screens replace desktop resize behavior with drawers and
bounded overlays.

Keyboard shortcuts:

| Shortcut | Result |
| --- | --- |
| `Ctrl+K` / `Cmd+K` | Open and focus the command palette |
| `Ctrl+J` / `Cmd+J` | Toggle the bottom runtime panel |
| `Escape` | Close the command palette |
| `Enter` / `Space` | Select a focused graph node |
| Arrow keys on resize handle | Resize by 8 px (`Shift`: 32 px) |
| `Home` on resize handle | Reset that panel dimension |
| Graph arrow keys | Move selection through filtered graph nodes |
| `Tab` / `Shift+Tab` | Move through navigation, panels, graph nodes, and records |

The bottom runtime panel keeps Logs, Events, Timeline, Operations, and Diagnostics
available without replacing the main editor view. It supports independent resize,
close, maximize/restore, persisted tabs, and contextual opening from the node
inspector.

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

The wire snapshot keeps the `protocolVersion: 3` compatibility marker and also
declares a structured descriptor:

```json
{
  "transport": 1,
  "snapshot": 3,
  "contributions": 1,
  "actions": 1,
  "events": 1
}
```

The global number remains for v3 clients. The component versions identify the
schema that actually changed: transport covers SSE framing and reconnect
behavior; snapshot covers the immutable state DTO; contributions covers
declarative view models; actions covers HTTP operation requests and results; and
events covers retained event envelopes. Optional fields are additive. Removing a
field, changing meaning or type, or changing framing increments the affected
component. Clients reject unsupported transport/snapshot versions and ignore
unknown additive fields. Duplicate and stale revisions are ignored. Action HTTP
errors retain `{ error: { code, message, status } }`; incompatible future action
schemas must fail explicitly rather than being guessed.

SSE reconnects use `Last-Event-ID`, refresh from the snapshot endpoint, then
resubscribe. The control plane bounds operations to 100 and events to 1,000; the
UI renders bounded tails rather than creating an unbounded browser history. Logs
and events use a 60-row fixed-window renderer over the retained 1,000-record
journal; scrolling changes the window instead of materializing the full stream.
Individual event payloads larger than 64 KiB are replaced with a bounded preview.
Clearing logs only clears the local visible projection.

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
Every declared kind has a controlled renderer. `panel` intentionally uses the
generic JSON-safe fallback; all others render in their named workbench surface.

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
state and operation endpoints to that network and now emits an explicit security
warning; place an authenticated reverse proxy in front of WSRT and disable
mutations unless they are required. Request URLs are limited to 8 KiB,
contributions to 1 MiB, and event payloads to 64 KiB. Plugin strings are escaped
before rendering and arbitrary HTML or script contributions are rejected. Complete
snapshot and SSE snapshot frames default to 8 MiB, request bodies to 64 KiB, and
action/secondary API responses to 1 MiB. Configure `maxSnapshotBytes`,
`maxRequestBytes`, or `maxActionResponseBytes` when necessary. Oversized snapshots
fail with `dashboard.frame_too_large`; they are never partially written or silently
truncated, and the client presents recovery guidance. Dashboard
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
- Graph layout is deterministic, cached by topology, and supports search, kind,
  lifecycle and health filters, related-node dimming, pan, zoom, fit and keyboard
  traversal. Clustering and a minimap remain future work.
- Wrapped variable-height log rows use the same bounded window but do not yet use
  measured-height virtualization.

## Development and testing

Run `pnpm --filter @wsrt/plugin-dashboard typecheck`, `pnpm run build`, and
`node --test tests/dashboard-client.test.mjs tests/plugin-architecture.test.mjs`.
The client tests cover routing, monotonic/protocol snapshot updates, paused live
inspection, preserved interaction state, contribution validation and isolation,
and SSE cleanup. The workspace test suite additionally covers API integration,
plugin isolation, lifecycle operations, and architecture boundaries.

The HTTP/SSE transport runs in one persistent worker thread. It receives immutable,
serializable snapshots and sends serialized start, stop, restart, task, and cancellation
commands to the parent. The parent control plane remains the single owner of plugins,
operations, and runtime resources. A synchronous or CPU-bound provider operation therefore
cannot stall dashboard HTTP or SSE handling.

`@wsrt/worker-pool` is intentionally not used for lifecycle execution. Its serializable
worker-thread protocol does use separate event loops and provides bounded jobs,
cancellation, error serialization, heartbeat recovery, and forced worker shutdown. Its job
model is not suitable for the persistent dashboard server and bidirectional snapshot/command
stream, while lifecycle work itself depends on live plugin instances, process handles, and
one authoritative state. Runtime providers may still use the pool for serializable CPU work.

Rendered Chromium acceptance:

```bash
pnpm --filter @wsrt/plugin-dashboard exec playwright install chromium
pnpm --filter @wsrt/plugin-dashboard build
pnpm --filter @wsrt/plugin-dashboard test:browser
```

The deterministic rendered fixture covers initial hydration, reconnect and
resubscription, paused inspection with advancing live revisions, panel resize and
reload persistence, synchronized node inspection, command-palette navigation,
1,000-record virtualization, contribution failure isolation, oversized-frame
recovery, theme switching, graph filtering, and a 390 px narrow viewport. The
large fixture uses 500 rendered graph nodes, 1,000 retained events, 100 operations,
500 artifacts, and 500 contributed commands. Reducer and frame-boundary tests run
with:

```bash
node --test tests/dashboard-client.test.mjs
```

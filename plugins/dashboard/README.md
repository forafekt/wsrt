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

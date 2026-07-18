# @wsrt/plugin-vite

This package provides four cooperating integrations. `@wsrt/workspace` owns
Vite-independent discovery, package relationships, source aliases, TypeScript
paths, and manifest projections. This plugin contributes a Vite execution
adapter, the lossless `wsrt exec vite` tool, configuration composition, and an
optional native Vite plugin.

```bash
pnpm add -D @wsrt/plugin-vite vite
```

```ts
import { defineSystem } from '@wsrt/config'
export default defineSystem({
  name: 'example',
  plugins: [{ provider: '@wsrt/plugin-vite', options: {
    workspace: { discover: true, aliases: true, dependencies: true },
    aliasPrecedence: 'user',
  }}],
  services: { web: {
    root: './apps/web',
    provider: { provider: 'vite', options: { command: 'dev' } },
    healthcheck: { type: 'http', url: 'http://127.0.0.1:5173' },
  }},
})
```

Use `wsrt start web`, or retain the complete CLI with `wsrt exec vite dev`,
`wsrt exec vite dev --host 0.0.0.0`, `wsrt exec vite build --mode production`,
and `wsrt exec vite preview`. Everything after the tool name belongs to Vite;
`--` remains an optional collision separator.

For Vite-first usage:

```ts
import { defineConfig } from 'vite'
import { wsrt } from '@wsrt/plugin-vite/vite'
export default defineConfig({ plugins: [wsrt()] })
```

It searches upward for a workspace and works without a control-plane daemon.
Both entry points use one resolver. User aliases win by default; choose
`aliasPrecedence: 'wsrt'` to reverse the policy. Existing Vite configuration is
merged and never overwritten.

`wsrt workspace inspect` and `resolve` are read-only. `sync` explicitly writes
deterministic TypeScript paths and `workspace:*` dependencies; `check` reports
drift and is CI-safe. Unrelated user entries are retained. Include/exclude globs
and API function filters can select target and dependency packages. Source
selection checks `source`, export source/development entries, `src/index.ts(x)`,
JavaScript variants, `module`, then `main`. Root configuration can serve many
apps by selecting a declared node root or the plugin `project` option.

Migration: replace `viteContribution()` with the generic execution provider
shown above. The former default native Vite plugin is now the explicit
`@wsrt/plugin-vite/vite` `wsrt()` export.

## Structured WSRT integration

The execution adapter creates a collision-free telemetry channel for each
execution. The native `wsrt()` plugin reports the actual address selected by
Vite as a versioned `server.listening` event, including the selected port and
resolved URLs. WSRT waits for that structured event before declaring the node
ready and starts configured health monitoring only afterward. The old textual
readiness/artifact markers are no longer the primary protocol.

Build bundle entries are reported as `artifact.discovered` events. After a
successful build, the Vite artifact provider enumerates the output directory
and returns candidates to the control plane; WSRT retains ownership of path
validation, existence checks, hashing, unchanged detection, timestamps, events,
and snapshots. Diagnostic telemetry uses the generic diagnostic event and is
attributed to the Vite contribution and current node/operation.

Cancellation aborts readiness polling and artifact collection. Telemetry files
are unique per execution and removed after readiness or build collection. The
`wsrt exec vite` wrapper likewise uses a unique temporary configuration and its
idempotent close path terminates Vite, disposes its runtime, and removes the
temporary directory. Native Vite use without WSRT remains supported; telemetry
is simply disabled when no WSRT channel is present.

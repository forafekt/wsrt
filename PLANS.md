# Workspace Runtime Plans

## Runtime Production Roadmap

The runtime now has typed services, lifecycle state, health, logs, metrics-ready interfaces, a runtime profile, and an event bus. These are intentionally incremental scaffolds. Future production work should add:

- Durable process supervision with restart policies and backoff.
- Structured log capture and retention across service adapters.
- Metrics exporters for Prometheus/OpenTelemetry-compatible backends.
- Health check scheduling, history, and dashboard trend views.
- Deployment providers for Docker, remote hosts, and managed platforms.
- Electron-specific adapter metadata and lifecycle controls.
- MCP server transport packaging that serves the live runtime, not only CLI tool calls.
- Runtime snapshots and artifact publishing for CI dashboards.

Vite should remain an adapter. New runtime features should depend on `createWorkspaceRuntime`, `runtime.services`, and runtime events instead of importing Vite-specific modules.

## CLI Mutations

`wsrt generate`, `wsrt rename`, and `wsrt move` currently emit safe planning output only.

The stable core is in place for scanning, resolving, graphing, validating, querying, and artifact generation. The remaining work is to add transactional workspace mutations for package scaffolding, package renames, and package moves.

Before these commands mutate files they should:

- Build a complete file-change plan.
- Detect package manager workspace globs and destination conflicts.
- Update `package.json` names and dependency references.
- Rewrite source imports only when the resolver can prove the old and new specifiers resolve to the same module.
- Update tsconfig paths and generated artifacts.
- Require `--yes` for writes.
- Keep `--dry-run` as the default behavior.

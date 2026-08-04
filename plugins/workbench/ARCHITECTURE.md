# Workbench Architecture

The Workbench is an independent WSRT plugin and a browser client of the authoritative workspace session. It does not import `@wsrt/plugin-dashboard`, does not scan workspace files, and does not infer ownership, impact, validation, lifecycle, runtime, graph, or evidence state in the frontend.

## Audit Summary

Existing package structure: the prototype had `src/index.ts`, `src/plugin.ts`, `src/server.ts`, and two frontend files, `src/ui/client.ts` and `src/ui/styles.ts`. The latter two contained the entire app and stylesheet as TypeScript strings.

Backend/server entry points: `createWorkbenchServer` and `startWorkbench` remain the public server API. The plugin executable still validates options independently and starts Workbench against a `WorkspaceSessionClient`.

Asset-serving model: replaced generated string responses with packaged static assets under `dist/ui`. The server now renders a small `index.html` template and serves `assets/bootstrap.js`, `assets/main.css`, and lazy chunks through `server/static-assets.ts`.

Client bootstrap: replaced inline server-fed script with `ui/bootstrap.ts`, which defines `<wsrt-workbench-app>`.

Transport and subscriptions: frontend transport is isolated in `ui/core/workspace-client.ts` and `ui/core/subscriptions.ts`. The server still gates requests through the allow-list and mutation option.

Route handling: route parsing and navigation live in `ui/core/router.ts` and `ui/core/route.ts`. Routes support deep links, typed params, query preservation, not-found handling, and lazy page imports.

State handling: server state, navigation state, layout state, runtime summary, and mutation/query state are separate store modules under `ui/state`.

Dashboard reuse: dashboard code was inspected for routing and SSE patterns. No dashboard code was imported or extracted because Workbench has a different protocol boundary and must remain removable.

Build tooling: Workbench uses the monorepo's existing `esbuild` dependency after `tsc`. Browser assets are bundled, minified, source-mapped, CSS-bundled, and code-split.

CSP implications: the app no longer depends on inline scripts or inline event-handler attributes. Component shadow styles are still injected as static style nodes; a strict CSP can move those to constructable stylesheets or bundled component CSS in a later hardening pass.

Plugin packaging: `files` continues to publish `dist`, README, and this architecture document. Runtime asset lookup is relative to compiled server files, so package consumers do not need repository source files.

Classification: keep `index.ts`, `plugin.ts`, option validation, request allow-list, SSE fan-out, tests, README. Refactor `server.ts` into server routing plus static asset helpers. Replace raw UI strings with Web Components, stores, router, services, CSS files, and bundled assets. Remove `ui/client.ts` and `ui/styles.ts`.

## Web Components Decision

Workbench uses native Web Components rather than a lightweight authoring library.

Native components keep the public boundary framework-neutral, add no runtime dependency, work with static hosting, support shadow DOM and custom events directly, and fit WSRT's package architecture. The tradeoff is a little more boilerplate around rendering and lifecycle cleanup, but the current surface is small enough that a library would not yet repay its bundle and maintenance cost.

The rendering convention is DOM construction with `textContent`/text nodes for dynamic values, small static component styles, typed public properties, and documented custom events such as `wsrt:navigate`, `wsrt:inspect`, `wsrt:command`, `wsrt:close-inspector`, `wsrt:retry`, and `wsrt:execute-plan`.

## Frontend Structure

`ui/index.html` is the packaged document shell. `ui/bootstrap.ts` registers the root element. `ui/app.ts` owns top-level composition only: navigation, top bar, router outlet, inspector, command palette, connection state, revision state, and global loading/error states.

`ui/core` contains router, route types, workspace client, session DTO boundary, subscriptions, capability helpers, errors, and UI view-model type aliases derived from `@wsrt/workspace-session`.

`ui/state` contains small stores for workspace data, navigation, layout, runtime summary, and operation/query state.

`ui/components` contains reusable Web Components with `wsrt-workbench-` names. Feature pages live under `ui/features` and are lazy-loaded by route.

`ui/styles` contains tokens, reset, typography, layout, utilities, and theme overrides. Global CSS is limited to document layout, tokens, reusable primitives, and accessibility-safe defaults; component-specific CSS stays with components.

## Boundaries

The frontend treats WSRT responses as authoritative. It may filter or format already-returned data for presentation, but protocol requests are the only source of workspace intelligence. Route-level pages must not traverse the workspace graph to infer missing relationships, owners, lifecycle status, impact, or validation.

Server APIs exposed to the browser are limited to:

- `GET /api/bootstrap`
- `GET /api/events`
- `POST /api/request`
- packaged static assets

All protocol request types forwarded by `/api/request` must remain documented in the server allow-list.

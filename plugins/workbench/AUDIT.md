# Workbench Audit

Phase 1 audit date: 2026-08-02

This audit covers the current `@wsrt/plugin-workbench` working tree after the initial Web Components architecture refactor. It intentionally does not mark route existence as feature completion.

## Package Inventory

Implemented package entry points:

- `src/index.ts`: package exports.
- `src/plugin.ts`: independent executable contribution and option validation.
- `src/server.ts`: HTTP routing, SSE fan-out, request allow-list, mutation gate.
- `src/server/static-assets.ts`: packaged `index.html` and static asset serving.
- `scripts/build.mjs`: `tsc` plus esbuild browser bundling.

Implemented frontend foundations:

- `ui/index.html`
- `ui/bootstrap.ts`
- `ui/app.ts`
- `ui/core/dom.ts`
- `ui/core/events.ts`
- `ui/core/route.ts`
- `ui/core/router.ts`
- `ui/core/workspace-client.ts`
- `ui/core/workspace-session.ts`
- `ui/core/subscriptions.ts`
- `ui/core/capabilities.ts`
- `ui/core/errors.ts`
- `ui/core/view-model.ts`
- `ui/state/workspace-state.ts`
- `ui/state/navigation-state.ts`
- `ui/state/layout-state.ts`
- `ui/state/runtime-state.ts`
- `ui/state/operation-state.ts`
- `ui/state/store.ts`

Implemented Web Components:

- `wsrt-workbench-app`
- `wsrt-workbench-app-shell`
- `wsrt-workbench-navigation`
- `wsrt-workbench-topbar`
- `wsrt-workbench-command-palette`
- `wsrt-workbench-inspector`
- `wsrt-workbench-status-badge`
- `wsrt-workbench-loading-state`
- `wsrt-workbench-empty-state`
- `wsrt-workbench-error-state`
- `wsrt-workbench-router`

Implemented routes:

- `/`
- `/architecture`
- `/projects`
- `/projects/:projectId`
- `/nodes`
- `/nodes/:nodeId`
- `/files`
- `/impact`
- `/validation`
- `/runtime`
- `/operations`
- `/operations/:operationId`
- `/diagnostics`
- `/artifacts`
- `/artifacts/:artifactId`
- `/sessions`
- `/settings`
- not-found fallback

Styles:

- Global CSS is split into `tokens.css`, `reset.css`, `typography.css`, `layout.css`, `utilities.css`, and `main.css`.
- Several component styles are still static strings inside component modules. They are scoped to shadow roots, but this remains a CSP and visual-system hardening item.

Tests:

- Package tests cover option validation, dashboard independence, modular asset build, browser-fetch binding, deep-route serving, and request allow-listing.
- No automated browser rendering, accessibility, keyboard, viewport, reconnect, or visual regression tests exist yet.

## Inventory Findings

Implemented routes:

- All planned route paths are parsable and served as deep links.
- Feature modules are lazy-loaded by route.

Route shells:

- Impact is a shell with explicit placeholder text.
- Validation is a shell with explicit placeholder text.
- Settings is a read-only information shell, not a functional preferences screen.
- Sessions is minimal identity output only.

Functional views:

- Overview renders real workspace identity, counts, and capabilities from bootstrap data.
- Projects renders a real project table from bootstrap data.
- Nodes renders a real bounded node table from bootstrap data.
- Files renders declared file associations from bootstrap node data only.
- Runtime renders nodes with lifecycle/runtime fields from bootstrap data.
- Operations renders operation snapshots from bootstrap data.
- Diagnostics renders diagnostic records from bootstrap data.
- Artifacts renders artifact records from bootstrap data.

Incomplete components:

- Inspector only fetches node, artifact, and file details; project, operation, diagnostic, task, evidence, capability, and session inspectors are local placeholders.
- Command palette only supports route navigation and basic node/project search.
- Top bar search button opens the command palette, but there is no distinct global semantic search experience.
- Status badge component is registered but not used by the current shell.
- Router element is registered but not meaningfully used as a router outlet.

Placeholders:

- `impact-page.ts`: "Impact analysis controls are isolated for the next feature pass."
- `validation-page.ts`: "Validation planning controls are ready for the next feature pass."

Fake data:

- No fake workspace data is present in production source.
- Tests use a fake session client for server behavior.

Missing protocol wiring:

- `workspace.graph.query` is allow-listed but not used by the Architecture page.
- `workspace.nodes.query` is allow-listed but not used by the Nodes page.
- `workspace.files.query` is allow-listed but not used by the Files page.
- `workspace.change.impact` is allow-listed but not used by the Impact page.
- `workspace.validation.recommend` is allow-listed but not used by the Validation page.
- `workspace.command.plan` is allow-listed but not used by UI controls.
- `workspace.command.execute` is allow-listed and mutation-gated but not exposed through confirmed UI actions.
- `session.status` is included in bootstrap but not refreshable from the Sessions page.

Duplicated state:

- Authoritative workspace state is centralized in `workspace-state.ts`.
- UI-only state is split into navigation, layout, runtime summary, and operation stores.
- No duplicate authoritative store was found.
- `operation-state.ts` exists but is not used.

Raw templates or styles:

- Removed raw application HTML and full-app CSS TypeScript strings.
- `ui/index.html` is a small static document template.
- Component-scoped CSS strings remain in Web Component modules.

Unhandled errors:

- Feature lazy-load errors are not caught at route level.
- Inspector request race and stale response errors are not guarded.
- Bootstrap request supersession is not guarded.
- EventSource parse failures only mark disconnected and do not expose structured error UI.

Missing empty states:

- Impact and Validation use placeholders instead of true empty states.
- Projects, Nodes, Files, Runtime, and Artifacts tables do not render explicit empty-state components.
- Command palette lacks explicit empty and error states.
- Inspector has minimal empty states.

Missing capability gates:

- Navigation links are not capability-aware.
- Routes do not explain unavailable capabilities.
- Mutating operation controls are mostly absent, so confirmation/capability handling is also absent.

Missing responsive behavior:

- Shell has desktop/tablet/mobile breakpoints.
- Responsive route-level table behavior has not been browser-validated.
- No automated viewport tests exist for 1440 x 900, 1280 x 800, 1024 x 768, or 768 x 1024.

Missing tests:

- Browser rendering tests.
- Accessibility tests.
- Keyboard navigation tests.
- Reconnect tests.
- Route race tests.
- Request cancellation tests.
- Revision consistency tests.
- Theme tests.
- Inspector lifecycle tests.
- Command palette lifecycle tests.
- Responsive layout tests.
- Dashboard simultaneous-run non-regression test.

Unused components and dead code:

- `StatusBadge` is registered but unused.
- `EmptyState` is registered but mostly unused by route pages.
- `WorkbenchRouterElement` is registered but not used as the route outlet.
- `operationState` is unused.
- Existing acceptance screenshots are from an earlier prototype and are not current evidence.

Accessibility problems:

- Command palette has `role="dialog"` but no focus trap, no initial focus restoration, and no active descendant keyboard navigation.
- Inspector close control exists, but focus is not moved into or restored from the panel.
- Navigation icons use text glyphs; icon system is not consistent.
- Status indicators depend partly on color and small dots.
- Several clickable rows are table rows with `tabindex` and keyboard handling but no explicit button/link semantics.
- No live region announces connection, stale revision, or operation state changes.

Visual inconsistencies:

- Some component styles use hardcoded colors, z-indexes, and compact CSS strings outside the token system.
- Route pages use generic tables and surfaces; visual hierarchy is not yet polished for demonstration.
- The design system has tokens but not complete density, disabled, selected, partial-support, stale, and disconnected semantics.

Dashboard coupling:

- No runtime imports, package dependencies, registrations, or UI wrapping of `@wsrt/plugin-dashboard` were found.
- A test asserts Workbench plugin metadata does not include `plugin-dashboard`.

Missing cleanup logic:

- `WorkbenchRouter.stop()` removes `popstate`, and `WorkspaceSubscriptions.close()` closes EventSource.
- `WorkbenchApp.bindEvents()` registers listeners on the app and `document` but does not remove them on disconnect.
- Reconnecting the root custom element could duplicate document keydown handling and internal event handling.
- Inspector requests are not abortable and may update after the target changes.
- Bootstrap requests are not abortable and can race with later bootstrap calls.

## Feature Matrix

| Feature | Classification | Notes |
| --- | --- | --- |
| Overview | Partial | Real bootstrap data for identity, counts, capabilities. Missing session identity, active runtime summary, recent diagnostics, artifact/project summaries, actionable links, disconnected/stale variants. |
| Architecture | Partial | Real nodes and relationship counts. Missing graph query controls, bounded graph explorer, filters, focus mode, fit-to-view, keyboard selection, accessible graph alternative beyond table. |
| Projects | Partial | Real project list. Missing sorting, search input wiring, project detail, owned nodes/files/tasks/artifacts/dependencies/evidence, deep-link detail handling. |
| Nodes | Partial | Real bounded node list. Missing authoritative node query, filters UI, sorting, aliases, parent/composition/dependencies/dependants, operations, lifecycle planning. |
| Files | Partial | Uses file associations from loaded nodes. Missing path query, exact/glob explorer, aggregate owners, support level, unresolved patterns, warnings, pagination, impact/validation actions. |
| Impact | Route shell only | Explicit placeholder. No path input or `workspace.change.impact` wiring. |
| Validation | Route shell only | Explicit placeholder. No changed-file input, recommendations, plan, execution, operation progress, cancellation, or diagnostics. |
| Runtime | Partial | Real runtime/lifecycle table. Missing grouping, readiness, restart count, operations, transitions, lifecycle actions, logs, live progress. |
| Operations | Partial | Real operation snapshots. Missing filters, deep links, details, cancellation, diagnostics, linked nodes/artifacts/validation, duplicate submission protection. |
| Diagnostics | Partial | Real diagnostics list. Missing grouping, filters/search UI, timestamp, related node/operation navigation, evidence, live subscription handling. |
| Artifacts | Partial | Real artifact records. Missing detail, exact vs glob distinction, consumers, generated state, evidence, task/application links, filters, sorting, deep links. |
| Sessions | Partial | Minimal handshake display. Missing uptime, transport, discovery state, subscription status, reconnect action, connected-client info where supported, revision explanation. |
| Settings | Route shell only | Displays static local facts. Missing theme/density/panel/table/graph/log preferences, validation, reset/clear actions. |
| Search | Missing | No standalone global semantic search controller or UI. |
| Command palette | Partial | Opens, filters route/node/project items, supports mouse selection. Missing fuzzy keyboard-first behavior, grouped results, commands list, disabled reasons, context actions, recent searches. |
| Inspector | Partial | Node/artifact/file fetch paths exist. Missing project/operation/diagnostic/task/evidence/capability/session support, history, focus management, deep links, resize, mobile sheet validation, stale request protection. |
| Themes | Partial | Light/dark tokens and toggle exist. Missing full per-route theme validation and stored value validation. |
| Responsive layout | Partial | Shell breakpoints exist. Missing route-level viewport validation and table/graph controls. |
| Keyboard support | Partial | Ctrl/Cmd-K, Escape, nav links, and inspectable rows have some support. Missing palette keyboard navigation, dialog focus handling, focus restoration, no-trap validation. |
| Reconnect | Partial | EventSource connection state exists. Missing reconnect action, structured reconnect errors, repeated connect/disconnect testing. |
| Revision handling | Partial | Bootstrap revision and stale flag exist. Missing request-level expected revision, stale response prevention, mixed-revision protection. |
| Error handling | Partial | Bootstrap error state and server JSON errors exist. Missing route-level lazy import errors, protocol error rendering across features, request race/cancellation errors. |

No feature is currently "complete and verified" under the full product standard in the new brief.

## Known Phase 2 Foundation Defects

- No request cancellation for bootstrap, route requests, or inspector requests.
- No response correlation; stale responses can overwrite current state.
- Root app event listeners are not removed on disconnect.
- `connectedCallback` can reinitialize clients/router/subscriptions if the same element is reconnected.
- Theme stored in `localStorage` is not validated.
- Feature lazy-loading errors are not caught and rendered as route errors.
- Capability data is loaded but not modeled into route/link availability.
- Browser history and deep links are implemented but not browser-tested.
- No automated browser-console checks exist.
- No real browser accessibility or viewport tests exist.

## Phase 1 Validation Evidence

Commands run from `/Users/jonnydoyle/Documents/wsrt`:

- `pnpm --filter @wsrt/plugin-workbench build`: passed.
- `pnpm exec biome check plugins/workbench`: passed.
- `pnpm --filter @wsrt/plugin-workbench test`: passed, 5 tests.

Browser tooling check:

- `playwright`: missing.
- `@playwright/test`: missing.
- `puppeteer`: missing.
- `jsdom`: missing.

ActiveLane evidence:

- Requested Linux path `/home/jonnydoyle/Dev/github/activelane-project` is not present in this environment.
- Available workspace used: `/Users/jonnydoyle/Documents/activelane-project`.
- Started Workbench with local CLI against ActiveLane on `http://127.0.0.1:58452/__wsrt/workbench`.
- `GET /`, `/architecture`, `/impact`, `/validation`: HTTP 200 HTML shell.
- `GET /assets/bootstrap.js`: HTTP 200 JavaScript.
- `GET /assets/main.css`: HTTP 200 CSS.
- `GET /api/bootstrap`: HTTP 200 JSON, 58,314 bytes.
- `POST /api/request` with `workspace.nodes.query` limit 5: HTTP 200, result count 5.
- `POST /api/request` with `workspace.files.query` limit 5: HTTP 200, result count 5.

Visual/browser evidence:

- No real browser screenshots or console traces were captured because no browser automation library is installed in the workspace.
- Existing `plugins/workbench/acceptance/*.png` files predate this audit and are not accepted as current visual evidence.

## Phase 2 Layout Stabilization

Phase 2A-2H update date: 2026-08-02

Reported defect A: no usable vertical page scrolling.

- Reproduced with a real Chrome browser test before the fix: the shell had no explicit `.route-viewport` scroll owner, so tests could not locate or exercise an intentional route scroll container.
- Root cause: the shell used a nested `workspace -> content -> main` layout with scrolling assigned to `main` inside a shadow tree, while the document body was globally hidden. The scroll contract was implicit and keyboard scrolling had no stable target.
- Fix: `wsrt-workbench-app-shell` now owns a single `.route-viewport` with `overflow-y: auto`, `min-block-size: 0`, `overscroll-behavior: contain`, and keyboard focusability. Feature pages remain intrinsic and do not receive route-specific height hacks.

Reported defect B: toggling/collapsing the left navigation breaks the UI layout.

- Reproduced with Chrome browser tests at 1440 x 900, 1280 x 800, 1024 x 768, and 768 x 1024.
- Root causes:
  - Navigation layout mode was split across `sidebarCollapsed`, `drawerOpen`, shell classes, and navigation classes.
  - Sidebar widths were duplicated between shell CSS and mobile `::slotted` rules.
  - Conditional `::slotted(...)` positioning was not a reliable way to move the drawer navigation host.
  - Collapsed mode hid the navigation toggle and removed accessible link names when labels were hidden.
  - The root custom element was not explicitly `display: block`, which made tablet sizing harder to reason about.
- Fix: layout state now uses one persisted desktop navigation mode (`expanded` or `collapsed`) plus a non-persisted drawer-open flag. The effective runtime mode is `expanded`, `collapsed`, or `drawer`. The shell uses tokenized grid columns and the navigation component owns its drawer positioning through a `mode` attribute.

Layout contract:

- `html`, `body`, and `wsrt-workbench-app` occupy the viewport; `body` remains non-scrolling intentionally.
- `wsrt-workbench-app-shell` is the application viewport.
- `.shell` is a grid with navigation, top bar, route viewport, inspector, and status bar regions.
- `.route-viewport` is the only primary vertical page scroll owner.
- Wide tables scroll horizontally inside `.table-wrap`; the page should not create document-level horizontal overflow.
- Inspector content scrolls independently in its own `aside`.
- Tablet drawer mode overlays navigation and does not resize the route viewport.
- Scroll policy for Phase 2 is reset-on-route-render because each route render creates a fresh route viewport.

Layout tokens:

- `--wsrt-topbar-height`
- `--wsrt-statusbar-height`
- `--wsrt-navigation-width-expanded`
- `--wsrt-navigation-width-collapsed`
- `--wsrt-navigation-width`
- `--wsrt-inspector-width-default`
- `--wsrt-inspector-width`
- `--wsrt-content-max-width`
- `--wsrt-breakpoint-navigation-drawer`
- `--wsrt-layout-transition-duration`

Foundation updates completed:

- Browser automation added with Playwright.
- Vertical route scrolling regression test added.
- Inspector independent scrolling regression test added.
- Desktop navigation collapse/expand/reload persistence regression tests added.
- Tablet drawer open/Escape/route-select regression test added.
- Console error and failed request assertions added to browser tests.
- Root app event listeners are disposed with an `AbortController`.
- Bootstrap requests are abortable and sequence-guarded.
- Inspector requests are abortable and sequence-guarded.
- Route lazy-loading/rendering is sequence-guarded and has an error fallback.
- Stored theme and navigation mode are validated before use.
- Legacy `wsrt.workbench.sidebar` values migrate into `wsrt.workbench.navigation`.

Remaining Phase 2 foundation gaps:

- Capability-aware route/link explanations are still incomplete.
- Request-level `expectedRevision` is not yet applied across all feature requests.
- Reconnect behavior relies on EventSource reconnect behavior and bootstrap refresh; there is no explicit reconnect command.
- Route scroll restoration is reset-on-render only; per-route restoration is not implemented.
- Accessibility validation is still a smoke level, not a full axe/manual pass.
- Browser tests cover shell/layout regressions, not every future feature route behavior.

Phase 2 browser evidence:

- Chrome via Playwright.
- Viewports covered by regression tests: 1440 x 900, 1280 x 800, 1024 x 768, 768 x 1024.
- ActiveLane screenshots captured under `plugins/workbench/acceptance/phase2/`.
- Screenshots reviewed: desktop expanded, desktop collapsed, desktop inspector open, tablet drawer closed, tablet drawer open, long page scrolled, dark theme.

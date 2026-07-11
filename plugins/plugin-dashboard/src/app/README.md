# WSRT Dashboard Web Components Split

This folder splits the original single `dashboardHtml()` implementation into separate files while preserving the original dashboard behavior.

## Entry points

- `index.ts` re-exports the dashboard API.
- `dashboard-html.ts` generates the HTML shell.
- `styles.ts` contains the original dashboard CSS.
- `client/main.ts` registers the Web Components.

## Web Components

- `wsrt-app` owns bootstrapping, shell rendering, refreshes, and page rendering.
- `wsrt-sidebar` owns navigation and live status rendering.
- `wsrt-topbar` owns search, refresh, theme toggle, and Cmd/Ctrl+K focus.
- `wsrt-graph` owns graph filtering, node selection, pan, zoom, and details.

## Pages

Each former page render function has been moved into `client/pages/*`.

## Important server note

The new HTML loads `/client/main.js` as a module. Your server/dev middleware needs to serve or bundle the files under `client/`. If your existing dashboard endpoint only supports one inline script, bundle `client/main.ts` with Vite/esbuild and serve the generated JS at `${basePath}/client/main.js`.

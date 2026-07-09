import { dashboardCss } from './styles.js'

export function dashboardHtml(basePath: string): string {
  const cleanBase = basePath.replace(/\/$/, '')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>Workspace Runtime Dashboard</title>
    <style>${dashboardCss()}</style>
  </head>
  <body>
    <wsrt-app class="loading-shell">
      <div class="loading-card">
        <div class="spinner"></div>
        <strong>Loading Workspace Runtime</strong>
        <span>Connecting to runtime state</span>
      </div>
    </wsrt-app>
    <script>window.__WSRT_BASE__ = ${JSON.stringify(basePath)};</script>
    <script type="module" src="${cleanBase}/client/main.js"></script>
  </body>
</html>`
}

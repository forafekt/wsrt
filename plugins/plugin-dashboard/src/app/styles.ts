export function dashboardCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f5f6f8;
  --panel: #ffffff;
  --panel-2: #f9fafb;
  --text: #151922;
  --muted: #687282;
  --line: #dde2ea;
  --accent: #0f6cbd;
  --accent-2: #0b8261;
  --warning: #a15c00;
  --error: #c3352b;
  --ok: #0d7a55;
  --shadow: 0 12px 32px rgba(20, 31, 43, 0.08);
}
[data-theme="dark"] {
  color-scheme: dark;
  --bg: #101317;
  --panel: #171b21;
  --panel-2: #1e242c;
  --text: #eef2f6;
  --muted: #9aa6b5;
  --line: #303844;
  --accent: #63b3ff;
  --accent-2: #62d6ad;
  --warning: #f0b45b;
  --error: #ff7c70;
  --ok: #75d7b1;
  --shadow: 0 18px 44px rgba(0, 0, 0, 0.32);
}
* { box-sizing: border-box; }
html, body { max-width: 100%; overflow-x: hidden; }
body { overflow: hidden; margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
button, input, select { font: inherit; color: inherit; }
a { color: inherit; text-decoration: none; }
.loading-shell { min-height: 100vh; display: grid; place-items: center; }
.loading-card { display: grid; justify-items: center; gap: 8px; padding: 28px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); }
.spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.shell { width: 100%; min-width: 0; max-height: 100vh; overflow: auto; display: grid; grid-template-columns: 260px minmax(0, 1fr); overflow-x: hidden; }
.sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 16px; padding: 18px; background: var(--panel); border-right: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; min-height: 42px; }
.brand-mark { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; color: white; background: linear-gradient(135deg, #0f6cbd, #0b8261); font-weight: 800; }
.brand h1 { margin: 0; font-size: 15px; line-height: 1.1; }
.brand span { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
.nav { display: grid; gap: 4px; overflow: auto; padding-right: 2px; }
.nav a { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 10px; border-radius: 7px; color: var(--muted); font-size: 14px; }
.nav a.active, .nav a:hover { background: var(--panel-2); color: var(--text); }
.nav small { min-width: 22px; height: 20px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 999px; font-size: 11px; color: var(--muted); }
.sidebar-footer { margin-top: auto; display: grid; gap: 10px; color: var(--muted); font-size: 12px; }
.connection { display: flex; align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warning); }
.dot.ok { background: var(--ok); }
.dot.error { background: var(--error); }
.main { min-width: 0; max-width: 100%; overflow: hidden; display: flex; flex-direction: column; }
.topbar { position: sticky; top: 0; z-index: 4; display: grid; grid-template-columns: minmax(260px, 620px) auto; gap: 14px; align-items: center; padding: 16px 22px; background: color-mix(in srgb, var(--bg) 88%, transparent); border-bottom: 1px solid var(--line); backdrop-filter: blur(14px); }
.search { position: relative; }
.search input { width: 100%; min-height: 42px; border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 9px 12px 9px 38px; outline: none; box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02); }
.search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.search::before { content: "⌕"; position: absolute; left: 13px; top: 7px; color: var(--muted); font-size: 23px; }
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.icon-button { min-width: 38px; height: 38px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); cursor: pointer; }
.icon-button:hover { border-color: var(--accent); }
.control-button, .subtle-button, .link-button { min-height: 32px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--text); padding: 6px 10px; cursor: pointer; font-size: 12px; }
.control-button:hover, .subtle-button:hover, .link-button:hover { border-color: var(--accent); }
.control-button:disabled, .subtle-button:disabled { opacity: 0.48; cursor: not-allowed; }
.subtle-button { color: var(--muted); background: var(--panel-2); }
.link-button { border: 0; background: transparent; color: var(--accent); padding: 2px 0; text-align: left; }
.control-row, .inline-actions, .badge-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.content { width: 100%; max-width: 100%; min-width: 0; padding: 24px; overflow-x: hidden; }
.page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.page-title h2 { margin: 0; font-size: 28px; line-height: 1.15; }
.page-title p { margin: 7px 0 0; color: var(--muted); overflow-wrap: anywhere; }
.grid { min-width: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 14px; }
.card { min-width: 0; overflow: hidden; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02); }
.card.clickable { cursor: pointer; transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease; }
.card.clickable:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--accent) 42%, var(--line)); box-shadow: var(--shadow); }
.metric strong { display: block; font-size: 30px; line-height: 1; margin-bottom: 8px; }
.metric span, .muted { color: var(--muted); font-size: 13px; }
.stack { display: grid; gap: 14px; }
.split { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 360px); gap: 14px; }
.split.compact { grid-template-columns: minmax(0, 1fr) minmax(220px, 300px); }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 12px; }
.card-head h3 { margin: 0; }
.card-section { margin-top: 14px; }
.service-grid, .task-grid { display: grid; gap: 14px; margin-top: 14px; }
.service-card, .task-card { display: grid; gap: 12px; }
.config-board, .diagnostics-board, .timeline-board { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; margin-top: 14px; align-items: start; }
.notice { padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); }
.notice p { margin: 8px 0 0; }
.empty.small { padding: 14px; font-size: 12px; }
.section-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr)); gap: 10px; }
.section-card { display: flex; flex-direction: column; justify-content: space-between; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); flex-wrap: wrap; }
.section-card span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }
.pill-grid { display: grid; gap: 8px; }
.pill-grid span { display: flex; justify-content: space-between; gap: 12px; min-width: 0; padding: 8px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel-2); color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.diagnostic-card.error { border-color: color-mix(in srgb, var(--error) 55%, var(--line)); }
.diagnostic-card.warning { border-color: color-mix(in srgb, var(--warning) 55%, var(--line)); }
.table-wrap { max-width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
table { width: 100%; border-collapse: collapse; min-width: 620px; }
th, td { padding: 11px 12px; border-bottom: 1px solid var(--line); text-align: left; font-size: 13px; }
th { color: var(--muted); background: var(--panel-2); font-weight: 650; }
tr:last-child td { border-bottom: 0; }
.badge { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 24px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel-2); color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge.ok, .status-info { color: var(--ok); }
.badge.warning, .status-warning { color: var(--warning); }
.badge.error, .status-error { color: var(--error); }
pre { max-width: 100%; overflow: auto; max-height: 440px; margin: 0; padding: 14px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.kv { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 8px 12px; font-size: 13px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; overflow-wrap: anywhere; }
.empty { padding: 34px; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: 8px; background: var(--panel); }
.filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.filters select, .filters input { min-height: 36px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); padding: 7px 10px; }
.graph-shell { min-width: 0; min-height: 620px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 340px); gap: 14px; }
.graph-stage { min-width: 0; position: relative; min-height: 620px; overflow: hidden; background: color-mix(in srgb, var(--accent) 4%, var(--panel)); border: 1px solid var(--line); border-radius: 8px; }
.graph-toolbar { position: absolute; left: 12px; top: 12px; z-index: 2; display: flex; gap: 8px; }
.graph-toolbar button { height: 32px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); cursor: pointer; }
svg.graph { width: 100%; height: 620px; cursor: grab; }
svg.graph:active { cursor: grabbing; }
.edge { stroke: color-mix(in srgb, var(--muted) 42%, transparent); stroke-width: 1.4; }
.edge.highlight { stroke: var(--accent); stroke-width: 2.4; }
.edge-label { fill: var(--muted); font-size: 10px; paint-order: stroke; stroke: var(--panel); stroke-width: 3px; stroke-linejoin: round; }
.node {
  cursor: pointer;
}

.node:hover circle {
  stroke: var(--warning);
  stroke-width: 3;
}
.node circle { stroke: var(--panel); stroke-width: 2; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.12)); }
.node.package circle { fill: var(--accent); }
.node.project circle { fill: var(--accent-2); }
.node.service circle { fill: #8a5cf6; }
.node.task circle { fill: #d97706; }
.node.plugin circle { fill: #64748b; }
.node.artifact circle { fill: #0891b2; }
.node.diagnostic-source circle { fill: var(--warning); }
.node.problem circle { fill: var(--error); }
.node text { fill: var(--text); font-size: 12px; paint-order: stroke; stroke: var(--panel); stroke-width: 4px; stroke-linejoin: round; }
.node .node-badge { fill: white; stroke: none; font-weight: 800; font-size: 12px; }
.node.selected circle { stroke: var(--warning); stroke-width: 4; }
.graph-panel { display: grid; align-content: start; gap: 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 8px; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 4px 8px; }
.legend-item i { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
.legend-item.project i { background: var(--accent-2); }
.legend-item.service i { background: #8a5cf6; }
.legend-item.task i { background: #d97706; }
.legend-item.artifact i { background: #0891b2; }
.legend-item.diagnostic-source i { background: var(--warning); }
.timeline { display: grid; gap: 10px; padding: 0; margin: 0; list-style: none; }
.timeline li { display: grid; grid-template-columns: 72px minmax(140px, auto) minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel-2); }
.timeline li > span { color: var(--muted); font-size: 12px; }
.timeline li p { margin: 2px 0 0; overflow-wrap: anywhere; }
.timeline details { grid-column: 1 / -1; }
.timeline.compact-list li { grid-template-columns: 66px 58px minmax(0, 1fr); }
.event-error { border-color: color-mix(in srgb, var(--error) 55%, var(--line)) !important; }
.event-warning { border-color: color-mix(in srgb, var(--warning) 55%, var(--line)) !important; }
.event-ok { border-color: color-mix(in srgb, var(--ok) 35%, var(--line)) !important; }
.error-box { border-color: color-mix(in srgb, var(--error) 55%, var(--line)); }
@media (max-width: 980px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { position: relative; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  .nav { grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); }
  .topbar, .split, .graph-shell, .config-board, .diagnostics-board, .timeline-board { grid-template-columns: 1fr; }
  .timeline li { grid-template-columns: 1fr; }
  .content { padding: 18px; }
}
`
}

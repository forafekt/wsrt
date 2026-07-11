import { badge, head, kv, link, metric, table } from '../lib/html.js'
import { state } from '../state.js'

export function overviewPage(): string {
  const overview = state.data.overview
  return head('Overview', overview?.root || 'Runtime state') + '<div class="grid">' +
    metric('Projects', overview?.counts.projects) + metric('Packages', overview?.counts.packages) + metric('Aliases', overview?.counts.aliases) + metric('Exports', overview?.counts.exports) +
    metric('Services', overview?.counts.services) + metric('Running', overview?.counts.runningServices) + metric('Diagnostics', overview?.counts.diagnostics) + metric('Graph edges', overview?.counts.graphEdges) + '</div>' +
    '<div class="split" style="margin-top:14px"><div class="card"><h3>Runtime status</h3>' + kv({ Environment: overview?.status.environment, Profile: overview?.status.profile, MCP: overview?.status.mcp ? 'enabled' : 'disabled', Artifacts: overview?.status.artifacts, Plugins: overview?.status.plugins, 'Virtual imports': overview?.status.virtualImports, Config: overview?.configFile || 'none' }) + '</div><div class="card"><h3>Services</h3>' + table(['Name','Adapter','Status'], (state.data.serverStatus || []).map((p: any) => [link('/projects/' + encodeURIComponent(p.name), p.name), badge(p.adapter), badge(p.status)]), true) + '</div></div>'
}

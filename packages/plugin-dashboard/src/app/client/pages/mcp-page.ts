import { badge, head, metric, table } from '../lib/html.js'
import { state } from '../state.js'

export function mcpPage(): string {
  const mcp = state.data.mcp || { tools: [], resources: [] }
  return head('MCP', 'Tools and resources exposed from runtime report/state.') + '<div class="grid">' + metric('Enabled', mcp.enabled ? 'yes' : 'no') + metric('Tools', mcp.tools.length) + metric('Resources', mcp.resources.length) + metric('Max results', mcp.maxResults) + '</div><div class="card" style="margin-top:14px"><h3>Catalog</h3>' + table(['Kind','ID','Description'], mcp.tools.concat(mcp.resources).map((item: any) => [badge(item.kind), item.id, item.description])) + '</div>'
}

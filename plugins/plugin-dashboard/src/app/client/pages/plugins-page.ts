import { esc, head, table } from '../lib/html.js'
import { state } from '../state.js'

export function pluginsPage(): string {
  const plugins = state.data.plugins || { names: [], hooks: {}, metadata: [] }
  const metadata = Array.isArray(plugins.metadata) ? plugins.metadata : []
  const pluginRows = metadata.length
    ? metadata.map((plugin: any) => [
        plugin.name,
        plugin.version || '',
        plugin.description || '',
        Array.isArray(plugin.capabilities) ? plugin.capabilities.join(', ') : '',
      ])
    : (plugins.names || []).map((name: string) => [name, '', '', ''])
  return head('Plugins', 'Loaded WSRT plugins and registered hooks.') + '<div class="split"><div class="card"><h3>Plugins</h3>' + table(['Name', 'Version', 'Description', 'Capabilities'], pluginRows) + '</div><div class="card"><h3>Hooks</h3><pre>' + esc(JSON.stringify(plugins.hooks, null, 2)) + '</pre></div></div>'
}

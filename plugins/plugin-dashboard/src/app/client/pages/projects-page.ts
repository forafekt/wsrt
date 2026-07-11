import { get } from '../api.js'
import { cards, diagnosticsTable, esc, head, kv, link, list, routeHref, table } from '../lib/html.js'
import { filter, state } from '../state.js'

export function projectsPage(): string {
  const items = filter(state.data.projects || [], (p: any) => p.name + p.root + p.adapter)
  return head('Projects', 'Adapters, composite processes, targets, commands, ports, and resolver state.') + cards(items.map((p: any) => '<div class="card clickable" data-go="' + routeHref('/projects/' + encodeURIComponent(p.name)) + '"><h3>' + esc(p.name) + ' <span class="badge ' + esc(p.adapter) + '">' + esc(p.adapter) + '</span></h3><p class="muted">' + esc(p.root) + '</p><p>Processes: ' + (p.processes?.length || 0) + '</p></div>'))
}

export function projectPage(name: string): string {
  return detail('/projects/' + encodeURIComponent(name), (project: any) => head(project.name, project.root) + '<div class="split"><div class="stack"><div class="card"><h3>Project</h3>' + kv({ Adapter: project.adapter, Status: project.status, Root: project.root, Command: project.config?.command || '', 'Vite configs': project.viteConfigFiles.join(', ') || 'none', Processes: project.processes?.length || 0 }) + '</div><div class="card"><h3>Processes and targets</h3>' + table(['Name','Adapter','Command','Config'], (project.processes || []).map((p: any) => [link('/projects/' + encodeURIComponent(p.name), p.name), '<span class="badge ' + esc(p.adapter) + '">' + esc(p.adapter) + '</span>', p.config?.command || '', p.config?.vite?.configFile || '']), true) + '</div><div class="card"><h3>Diagnostics</h3>' + diagnosticsTable(project.diagnostics) + '</div></div><div class="stack"><div class="card"><h3>Related packages</h3>' + list(project.relatedPackages.map((p: any) => link('/packages/' + encodeURIComponent(p.name), p.name))) + '</div><div class="card"><h3>Aliases</h3><pre>' + esc(JSON.stringify(project.aliases, null, 2)) + '</pre></div></div></div>')
}

function detail(path: string, renderDetail: (value: any) => string): string {
  const key = 'projectDetail:' + path
  const existing = state.data[key]
  if (existing) return renderDetail(existing)
  get(path).then((data) => { state.data[key] = data; window.dispatchEvent(new CustomEvent('wsrt:data-changed')) }).catch((error) => { state.data[key] = { error: error.message }; window.dispatchEvent(new CustomEvent('wsrt:data-changed')) })
  return head('Loading', path) + '<div class="loading-card"><div class="spinner"></div><span>Loading detail</span></div>'
}

import { get } from '../api.js'
import { badge, cards, diagnosticsTable, esc, head, kv, link, list, routeHref } from '../lib/html.js'
import { filter, state } from '../state.js'

export function packagesPage(): string {
  const items = filter(state.data.packages || [], (p: any) => p.name + p.root + Object.keys(p.exports || {}).join(' '))
  return head('Packages', 'Workspace packages discovered by the canonical runtime.') + cards(items.map((p: any) => '<div class="card clickable" data-go="' + routeHref('/packages/' + encodeURIComponent(p.name)) + '"><h3>' + esc(p.name) + ' ' + (p.private ? badge('private') : '') + '</h3><p class="muted">' + esc(p.root) + '</p><p>Exports: ' + Object.keys(p.exports || {}).length + '</p></div>'))
}

export function packagePage(name: string): string {
  return detail('/packages/' + encodeURIComponent(name), (pkg: any) => head(pkg.name, pkg.root) + '<div class="split"><div class="stack"><div class="card"><h3>Package</h3>' + kv({ Version: pkg.version || '', Private: pkg.private ? 'yes' : 'no', Root: pkg.root, 'package.json': pkg.packageJson, Entry: pkg.sourceEntry || '' }) + '</div><div class="card"><h3>Exports</h3><pre>' + esc(JSON.stringify({ exports: pkg.exports, resolvedExports: pkg.resolvedExports }, null, 2)) + '</pre></div><div class="card"><h3>Diagnostics</h3>' + diagnosticsTable(pkg.diagnostics) + '</div></div><div class="stack"><div class="card"><h3>Dependencies</h3>' + list((pkg.dependencies || []).map((dep: string) => link('/packages/' + encodeURIComponent(dep), dep))) + '</div><div class="card"><h3>Dependents</h3>' + list((pkg.dependents || []).map((dep: string) => link('/packages/' + encodeURIComponent(dep), dep))) + '</div><div class="card"><h3>Sync</h3>' + kv({ Manifests: (pkg.manifestStatus || []).join(', ') || 'none', Tsconfig: (pkg.tsconfigStatus || []).join(', ') || 'none' }) + '</div><div class="card"><h3>Aliases</h3><pre>' + esc(JSON.stringify(pkg.aliases, null, 2)) + '</pre></div></div></div>')
}

function detail(path: string, renderDetail: (value: any) => string): string {
  const key = 'packageDetail:' + path
  const existing = state.data[key]
  if (existing) return renderDetail(existing)
  get(path).then((data) => { state.data[key] = data; window.dispatchEvent(new CustomEvent('wsrt:data-changed')) }).catch((error) => { state.data[key] = { error: error.message }; window.dispatchEvent(new CustomEvent('wsrt:data-changed')) })
  return head('Loading', path) + '<div class="loading-card"><div class="spinner"></div><span>Loading detail</span></div>'
}

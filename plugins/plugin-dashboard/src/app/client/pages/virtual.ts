import { badge, esc, head, table } from '../lib/html.js'
import { state } from '../state.js'

export function virtualPage(): string {
  const virtualImports = state.data.virtualImports || { imports: [] }
  return head('Virtual Imports', 'Vite modules and non-Vite fallback outputs.') + '<div class="card"><p class="muted">Fallback directory: ' + esc(virtualImports.fallbackDir || '') + '</p>' + table(['Import','Kind','Fallback file'], virtualImports.imports.map((item: any) => [item.id, badge(item.kind), item.file || '']), true) + '</div>'
}

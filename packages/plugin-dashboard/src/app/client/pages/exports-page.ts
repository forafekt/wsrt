import { esc, head, link, table } from '../lib/html.js'
import { matches, state } from '../state.js'

export function exportsPage(): string {
  return head('Exports', 'Package export maps and resolved source targets.') + table(['Package','Exports','Resolved'], (state.data.exports || []).filter((item: any) => matches(item.name)).map((item: any) => [link('/packages/' + encodeURIComponent(item.name), item.name), '<pre>' + esc(JSON.stringify(item.exports, null, 2)) + '</pre>', '<pre>' + esc(JSON.stringify(item.resolvedExports, null, 2)) + '</pre>']), true)
}

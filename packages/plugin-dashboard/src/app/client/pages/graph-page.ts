import { esc, head } from '../lib/html.js'
import { state } from '../state.js'

export function graphPage(): string {
  return head('Graph', 'Pan, zoom, search, and select package/project relationships.') +
    '<wsrt-graph filter="' + esc(state.graph.filter) + '"></wsrt-graph>'
}

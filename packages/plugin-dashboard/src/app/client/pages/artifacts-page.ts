import { badge, head, table } from '../lib/html.js'
import { state } from '../state.js'

export function artifactsPage(): string {
  return head('Artifacts', 'Generated runtime artifacts and report outputs.') + table(['Kind','Status','File','Bytes'], (state.data.artifacts || []).map((a: any) => [badge(a.kind), badge(a.status), a.file, a.bytes || '']))
}

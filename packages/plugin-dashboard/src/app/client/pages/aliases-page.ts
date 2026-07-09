import { head, table } from '../lib/html.js'
import { matches, state } from '../state.js'

export function aliasesPage(): string {
  return head('Aliases', 'Resolved import aliases from the runtime resolver.') + table(['Specifier','Target'], Object.entries(state.data.aliases || {}).filter(([k, v]) => matches(k + v)).map(([k, v]) => [k, v]))
}

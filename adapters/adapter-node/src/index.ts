import { commandAdapter } from '@wsrt/adapter-command'
import type { ProjectAdapter } from '@wsrt/types'

export function nodeAdapter(): ProjectAdapter {
  const command = commandAdapter()
  return {
    name: 'node',
    start: command.start,
  }
}

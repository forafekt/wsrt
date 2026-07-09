import { commandAdapter } from '@wsrt/adapter-command'
import { compositeAdapter } from '@wsrt/adapter-composite'
import { nodeAdapter } from '@wsrt/adapter-node'
import { viteAdapter } from '@wsrt/adapter-vite'
import type { ProjectAdapter } from '@wsrt/types'

export function createProjectAdapters(
  customAdapters: ProjectAdapter[] = [],
): Record<string, ProjectAdapter> {
  const adapters: Record<string, ProjectAdapter> = {
    vite: viteAdapter(),
    command: commandAdapter(),
    node: nodeAdapter(),
    composite: compositeAdapter(() => adapters),
  }
  for (const adapter of customAdapters) adapters[adapter.name] = adapter
  return adapters
}

export { commandAdapter, compositeAdapter, nodeAdapter, viteAdapter }

import path from 'node:path'
import type { VirtualImport, VirtualImportState, WorkspaceRuntime } from '@wsrt/types'

const virtualIds = [
  'virtual:wsrt',
  'virtual:wsrt/packages',
  'virtual:wsrt/aliases',
  'virtual:wsrt/graph',
  'virtual:wsrt/report',
]

export function createVirtualImportState(runtime: WorkspaceRuntime): VirtualImportState {
  const fallbackDir = path.resolve(runtime.state.root, artifactDir(runtime), 'virtual')
  return {
    fallbackDir,
    diagnostics: [],
    imports: virtualIds.map((id) => createVirtualImport(runtime, id, fallbackDir)),
  }
}

export function createVirtualImport(
  runtime: WorkspaceRuntime,
  id: string,
  fallbackDir = path.resolve(runtime.state.root, '.wsrt/virtual'),
): VirtualImport {
  const contents = virtualModuleContents(runtime, id)
  return {
    id,
    kind: 'vite',
    contents,
    file: path.join(fallbackDir, `${id.replace(/^virtual:/, '').replaceAll('/', '-')}.mjs`),
  }
}

export function virtualModuleContents(runtime: WorkspaceRuntime, id: string): string {
  const value = virtualValue(runtime, id)
  return `export default ${JSON.stringify(value, null, 2)};\nexport const value = ${JSON.stringify(value, null, 2)};\n`
}

function virtualValue(runtime: WorkspaceRuntime, id: string): unknown {
  if (id === 'virtual:wsrt/packages') return runtime.state.packages
  if (id === 'virtual:wsrt/aliases') return runtime.state.aliases
  if (id === 'virtual:wsrt/graph') return runtime.state.graph
  if (id === 'virtual:wsrt/report') return runtime.inspect()
  return {
    root: runtime.state.root,
    projects: runtime.state.projects,
    packages: runtime.state.packages,
    aliases: runtime.state.aliases,
    graph: runtime.state.graph,
    diagnostics: runtime.state.diagnostics,
  }
}

function artifactDir(runtime: WorkspaceRuntime): string {
  return runtime.config.get('artifacts')?.dir ?? '.wsrt'
}

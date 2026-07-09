import type { WorkspaceGraph, WorkspacePackage } from '@wsrt/types'

export function buildWorkspaceGraph(packages: WorkspacePackage[], includeExternal = false): WorkspaceGraph {
  const names = new Set(packages.map((pkg) => pkg.name))
  const edges = packages.flatMap((pkg) =>
    pkg.dependencies
      .filter((dependency) => includeExternal || names.has(dependency))
      .map((dependency) => ({
        from: pkg.name,
        to: dependency,
        type: names.has(dependency) ? 'workspace' as const : 'external' as const,
      })),
  )
  return {
    nodes: packages.map((pkg) => ({ id: pkg.name, root: pkg.root })),
    edges,
  }
}

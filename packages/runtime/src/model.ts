import path from 'node:path'
import type {
  RuntimeConfigAccess,
  RuntimeDiagnostics,
  RuntimeEventBus,
  RuntimeGraphEdge,
  RuntimeGraphModel,
  RuntimeGraphNode,
  RuntimeGraphQuery,
  RuntimeProject,
  WsrtConfig,
  WsrtDiagnostic,
  WorkspacePackage,
  WorkspaceRuntimeState,
} from '@wsrt/types'

export function createRuntimeDiagnostics(
  state: WorkspaceRuntimeState,
  events: RuntimeEventBus,
): RuntimeDiagnostics {
  return {
    add(diagnostic) {
      state.diagnostics.push(diagnostic)
      events.emit('diagnostic:added', { diagnostic })
      return diagnostic
    },
    list() {
      return state.diagnostics
    },
    byProject(project) {
      const runtimeProject =
        typeof project === 'string'
          ? flattenProjects(state.projects).find((item) => item.name === project)
          : project
      if (!runtimeProject) return []
      return diagnosticsForProject(state.diagnostics, runtimeProject)
    },
    byPackage(pkg) {
      const runtimePackage =
        typeof pkg === 'string' ? state.packages.find((item) => item.name === pkg) : pkg
      if (!runtimePackage) return []
      return diagnosticsForPackage(state.diagnostics, runtimePackage)
    },
  }
}

export function createRuntimeConfigAccess(config: WsrtConfig): RuntimeConfigAccess {
  const get = (<Key extends keyof WsrtConfig>(key?: Key) =>
    key === undefined ? config : config[key]) as RuntimeConfigAccess['get']
  return Object.assign({}, config, { raw: config, get })
}

export function createRuntimeGraphModel(state: WorkspaceRuntimeState): RuntimeGraphModel {
  const model = {
    get nodes() {
      return state.graph.nodes
    },
    get edges() {
      return state.graph.edges
    },
    node(id: string) {
      return graphNodes(state).find((node) => node.id === id)
    },
    query(query: RuntimeGraphQuery = {}) {
      const allNodes = graphNodes(state)
      const allEdges = graphEdges(state)
      const kind = query.kind ?? 'all'
      const direction = query.direction ?? 'both'
      let nodes = kind === 'all' ? allNodes : allNodes.filter((node) => node.kind === kind)
      let edges = allEdges

      if (query.node) {
        edges = allEdges.filter((edge) => {
          if (direction === 'dependencies') return edge.from === query.node
          if (direction === 'dependents') return edge.to === query.node
          return edge.from === query.node || edge.to === query.node
        })
        const ids = new Set([query.node, ...edges.flatMap((edge) => [edge.from, edge.to])])
        nodes = allNodes.filter((node) => ids.has(node.id))
      }

      if (kind !== 'all') {
        const ids = new Set(nodes.map((node) => node.id))
        edges = edges.filter((edge) => ids.has(edge.from) || ids.has(edge.to))
      }

      return { nodes, edges }
    },
    dependencies(name: string) {
      const dependencies = state.graph.edges
        .filter((edge) => edge.from === name)
        .map((edge) => edge.to)
      return state.packages.filter((pkg) => dependencies.includes(pkg.name))
    },
    dependents(name: string) {
      const dependents = state.graph.edges
        .filter((edge) => edge.to === name)
        .map((edge) => edge.from)
      return state.packages.filter((pkg) => dependents.includes(pkg.name))
    },
    forProject(name: string) {
      const project = flattenProjects(state.projects).find((item) => item.name === name)
      if (!project) return undefined
      const packages = relatedPackages(state, project)
      return {
        project,
        packages,
        edges: packages.map((pkg) => ({
          from: `project:${project.name}`,
          to: pkg.name,
          type: 'project' as const,
        })),
      }
    },
    forPackage(name: string) {
      const pkg = state.packages.find((item) => item.name === name)
      if (!pkg) return undefined
      const dependencies = model.dependencies(pkg.name)
      const dependents = model.dependents(pkg.name)
      const edges = graphEdges(state).filter((edge) => edge.from === name || edge.to === name)
      return { package: pkg, dependencies, dependents, edges }
    },
  } satisfies RuntimeGraphModel

  return model
}

export function flattenProjects(projects: RuntimeProject[]): RuntimeProject[] {
  return projects.flatMap((project) => [project, ...flattenProjects(project.processes)])
}

export function diagnosticsForProject(
  diagnostics: WsrtDiagnostic[],
  project: RuntimeProject,
): WsrtDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.project === project.name || diagnostic.source?.startsWith(project.root),
  )
}

export function diagnosticsForPackage(
  diagnostics: WsrtDiagnostic[],
  pkg: WorkspacePackage,
): WsrtDiagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.source?.startsWith(pkg.root)) return true
    const detail = diagnostic.detail
    return Boolean(
      detail && typeof detail === 'object' && 'name' in detail && detail.name === pkg.name,
    )
  })
}

export function relatedPackages(
  state: WorkspaceRuntimeState,
  project: RuntimeProject,
): WorkspacePackage[] {
  const relativeRoot = path.relative(state.root, project.root)
  return state.packages.filter(
    (pkg) =>
      pkg.root.startsWith(project.root) ||
      path.relative(state.root, pkg.root).startsWith(relativeRoot),
  )
}

function graphNodes(state: WorkspaceRuntimeState): RuntimeGraphNode[] {
  return [
    ...state.graph.nodes.map((node) => ({ ...node, kind: node.kind ?? 'package' })),
    ...flattenProjects(state.projects).map((project) => ({
      id: `project:${project.name}`,
      root: project.root,
      kind: 'project' as const,
    })),
  ]
}

function graphEdges(state: WorkspaceRuntimeState): RuntimeGraphEdge[] {
  return [
    ...state.graph.edges,
    ...flattenProjects(state.projects).flatMap((project) =>
      relatedPackages(state, project).map((pkg) => ({
        from: `project:${project.name}`,
        to: pkg.name,
        type: 'project' as const,
      })),
    ),
  ]
}

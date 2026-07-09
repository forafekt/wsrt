import type {
  RuntimeProject,
  WsrtDiagnostic,
  WorkspaceRuntime,
  WorkspacePackage,
} from '@wsrt/types'

export type DashboardOverview = {
  root: string
  configFile?: string
  counts: {
    projects: number
    packages: number
    aliases: number
    exports: number
    graphNodes: number
    graphEdges: number
    diagnostics: number
    errors: number
    warnings: number
    services: number
    runningServices: number
  }
  status: {
    profile: string
    environment: string
    mcp: boolean
    artifacts: number
    plugins: number
    virtualImports: number
  }
}

export type DashboardGraphNode = {
  id: string
  label: string
  kind: 'package' | 'project' | 'service' | 'task' | 'plugin' | 'artifact' | 'diagnostic-source' | string
  root?: string
  diagnostics: number
}

export type DashboardGraphEdge = {
  from: string
  to: string
  type: 'workspace' | 'external' | 'project' | 'service' | 'task' | 'plugin' | 'artifact' | 'diagnostic' | string
}

export type DashboardGraph = {
  nodes: DashboardGraphNode[]
  edges: DashboardGraphEdge[]
}

export type DashboardProjectDetails = RuntimeProject & {
  diagnostics: WsrtDiagnostic[]
  viteConfigFiles: string[]
  aliases: Record<string, string>
  relatedPackages: WorkspacePackage[]
  status: 'idle' | 'running' | 'exited' | 'unknown'
}

export type DashboardPackageDetails = WorkspacePackage & {
  aliases: Record<string, string>
  dependents: string[]
  diagnostics: WsrtDiagnostic[]
  manifestStatus: string[]
  tsconfigStatus: string[]
}

function flattenProjects(projects: RuntimeProject[]): RuntimeProject[] {
  return projects.flatMap((project) => [project, ...flattenProjects(project.processes)])
}

export function dashboardOverview(runtime: WorkspaceRuntime): DashboardOverview {
  const state = runtime.inspect()
  const overview = runtime.query.overview()
  const exportsCount = state.packages.reduce(
    (count, pkg) => count + Object.keys(pkg.exports).length,
    0,
  )
  return {
    root: state.root,
    configFile: state.configFile,
    counts: {
      projects: overview.counts.projects,
      packages: overview.counts.packages,
      aliases: Object.keys(state.aliases).length,
      exports: exportsCount,
      graphNodes: state.graph.nodes.length + flattenProjects(state.projects).length,
      graphEdges: state.graph.edges.length,
      diagnostics: overview.counts.diagnostics,
      errors: overview.counts.errors,
      warnings: overview.counts.warnings,
      services: overview.counts.services,
      runningServices: overview.counts.runningServices,
    },
    status: {
      profile: state.profile.name,
      environment: state.profile.environment,
      mcp: state.mcp.enabled,
      artifacts: state.artifacts.length,
      plugins: state.plugins.names.length,
      virtualImports: state.virtualImports.imports.length,
    },
  }
}

export function dashboardGraph(runtime: WorkspaceRuntime): DashboardGraph {
  const graph = runtime.query.graph()
  const projectNodes = flattenProjects(runtime.state.projects)
  const diagnosticSources = new Map<string, number>()
  for (const diagnostic of runtime.state.diagnostics) {
    const key = diagnostic.source || diagnostic.project || diagnostic.code
    diagnosticSources.set(key, (diagnosticSources.get(key) ?? 0) + 1)
  }
  const baseNodes: DashboardGraphNode[] = graph.nodes.map((node) => ({
    id: node.id,
    label: node.kind === 'project' ? node.id.replace(/^project:/, '') : node.id,
    kind: node.kind,
    root: node.root,
    diagnostics:
      node.kind === 'project'
        ? runtime.diagnostics.byProject(node.id.replace(/^project:/, '')).length
        : runtime.diagnostics.byPackage(node.id).length,
  }))
  const projectGraphNodes: DashboardGraphNode[] = projectNodes
    .filter((project) => !baseNodes.some((node) => node.id === `project:${project.name}`))
    .map((project) => ({
      id: `project:${project.name}`,
      label: project.name,
      kind: 'project',
      root: project.root,
      diagnostics: runtime.diagnostics.byProject(project).length,
    }))
  const serviceNodes: DashboardGraphNode[] = runtime.state.services.map((service) => ({
    id: `service:${service.id}`,
    label: service.name,
    kind: 'service',
    root: service.root,
    diagnostics: service.error ? 1 : 0,
  }))
  const taskNodes: DashboardGraphNode[] = runtime.tasks.list().map((task) => ({
    id: `task:${task.id}`,
    label: task.title ?? task.id,
    kind: 'task',
    diagnostics: 0,
  }))
  const pluginNodes: DashboardGraphNode[] = runtime.state.plugins.names.map((name) => ({
    id: `plugin:${name}`,
    label: name,
    kind: 'plugin',
    diagnostics: 0,
  }))
  const artifactNodes: DashboardGraphNode[] = runtime.state.artifacts.map((artifact) => ({
    id: `artifact:${artifact.kind}:${artifact.file}`,
    label: artifact.kind,
    kind: 'artifact',
    root: artifact.file,
    diagnostics: artifact.status === 'error' ? 1 : 0,
  }))
  const diagnosticNodes: DashboardGraphNode[] = [...diagnosticSources].map(([source, count]) => ({
    id: `diagnostic:${source}`,
    label: source,
    kind: 'diagnostic-source',
    diagnostics: count,
  }))

  const extraEdges: DashboardGraphEdge[] = [
    ...runtime.state.services
      .filter((service) => service.project)
      .map((service) => ({
        from: `project:${service.project}`,
        to: `service:${service.id}`,
        type: 'service' as const,
      })),
    ...runtime.tasks.list().flatMap((task) =>
      runtime.state.plugins.names.map((name) => ({
        from: `plugin:${name}`,
        to: `task:${task.id}`,
        type: 'task' as const,
      })),
    ),
    ...runtime.state.artifacts.map((artifact) => ({
      from: 'runtime',
      to: `artifact:${artifact.kind}:${artifact.file}`,
      type: 'artifact' as const,
    })),
    ...[...diagnosticSources].map(([source]) => ({
      from: source.startsWith('project:') ? source : 'runtime',
      to: `diagnostic:${source}`,
      type: 'diagnostic' as const,
    })),
  ]
  return {
    nodes: [
      { id: 'runtime', label: 'runtime', kind: 'plugin', diagnostics: 0 },
      ...baseNodes,
      ...projectGraphNodes,
      ...serviceNodes,
      ...taskNodes,
      ...pluginNodes,
      ...artifactNodes,
      ...diagnosticNodes,
    ],
    edges: [...graph.edges, ...extraEdges],
  }
}

export function dashboardProject(
  runtime: WorkspaceRuntime,
  name: string,
): DashboardProjectDetails | undefined {
  const project = flattenProjects(runtime.state.projects).find((item) => item.name === name)
  if (!project) return undefined
  const service = runtime.state.services.find((item) => item.project === project.name)
  return {
    ...publicProject(project),
    diagnostics: runtime.diagnostics.byProject(project),
    viteConfigFiles: viteConfigFiles(project),
    aliases: runtime.state.aliases,
    relatedPackages: runtime.graph.forProject(project.name)?.packages ?? [],
    status:
      service?.state === 'running'
        ? 'running'
        : service?.state === 'stopped' || service?.state === 'failed'
          ? 'exited'
          : 'idle',
  }
}

function publicProject(project: RuntimeProject): RuntimeProject {
  return {
    ...project,
    config: { ...project.config, environment: undefined },
    processes: project.processes.map(publicProject),
  }
}

export function dashboardPackage(
  runtime: WorkspaceRuntime,
  name: string,
): DashboardPackageDetails | undefined {
  const pkg = runtime.state.packages.find((item) => item.name === name)
  if (!pkg) return undefined
  const packageGraph = runtime.graph.forPackage(pkg.name)
  return {
    ...pkg,
    aliases: Object.fromEntries(
      Object.entries(runtime.state.aliases).filter(
        ([key]) => key === pkg.name || key.startsWith(`${pkg.name}/`),
      ),
    ),
    dependents: packageGraph?.dependents.map((item) => item.name) ?? [],
    diagnostics: runtime.diagnostics.byPackage(pkg),
    manifestStatus: runtime.state.manifests.files
      .filter((item) => item.file.startsWith(pkg.root))
      .map((item) => `${item.target}:${item.status}`),
    tsconfigStatus: runtime.state.tsconfig.files
      .filter((item) => item.file.startsWith(pkg.root))
      .map((item) => item.status),
  }
}

export function dashboardExports(
  runtime: WorkspaceRuntime,
): Array<{
  name: string
  exports: Record<string, string>
  resolvedExports: Record<string, string>
}> {
  return runtime.state.packages.map((pkg) => ({
    name: pkg.name,
    exports: pkg.exports,
    resolvedExports: pkg.resolvedExports,
  }))
}

export function dashboardServerStatus(
  runtime: WorkspaceRuntime,
): Array<{ name: string; adapter: string; status: string; root: string }> {
  return flattenProjects(runtime.state.projects).map((project) => ({
    name: project.name,
    adapter: project.adapter,
    status:
      runtime.state.services.find((service) => service.project === project.name)?.state ?? 'idle',
    root: project.root,
  }))
}

function viteConfigFiles(project: RuntimeProject): string[] {
  const files =
    typeof project.config.vite?.configFile === 'string' ? [project.config.vite.configFile] : []
  return [
    ...files,
    ...project.processes.flatMap((processProject) => viteConfigFiles(processProject)),
  ]
}

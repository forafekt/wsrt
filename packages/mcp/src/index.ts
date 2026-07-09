import type { McpEntry, McpRuntimeState, WsrtConfig, WorkspaceRuntime } from '@wsrt/types'

export function createMcpState(config: WsrtConfig): McpRuntimeState {
  const mcp = typeof config.mcp === 'object' ? config.mcp : undefined
  const enabled = config.mcp !== false && Boolean(mcp?.enabled)
  const tools = baseTools()
  const resources = baseResources()
  return {
    enabled,
    name: mcp?.name,
    exposeSourcePaths: mcp?.exposeSourcePaths !== false,
    exposeReports: mcp?.exposeReports !== false,
    exposeDiagnostics: mcp?.exposeDiagnostics !== false,
    maxResults: typeof mcp?.maxResults === 'number' ? mcp.maxResults : 100,
    tools,
    resources,
  }
}

export function runMcpTool(
  runtime: WorkspaceRuntime,
  id: string,
  input: Record<string, unknown> = {},
): unknown {
  const limit = runtime.state.mcp.maxResults
  switch (id) {
    case 'workspace.overview':
      return {
        ...runtime.query.overview(),
        projects: runtime.query.overview().counts.projects,
        packages: runtime.query.overview().counts.packages,
        services: runtime.query.overview().counts.services,
        diagnostics: runtime.query.overview().counts.diagnostics,
      }
    case 'workspace.projects':
      return runtime.query.projects()
    case 'workspace.packages': {
      return runtime.query.packages({ search: String(input.query ?? ''), limit })
    }
    case 'workspace.package':
      return runtime.packages.find((pkg) => pkg.name === input.name)
    case 'workspace.imports':
      return runtime.state.aliases
    case 'workspace.exports':
      return runtime.packages.map((pkg) => ({
        name: pkg.name,
        exports: pkg.exports,
        resolvedExports: pkg.resolvedExports,
      }))
    case 'workspace.graph':
      return runtime.query.graph()
    case 'workspace.diagnostics':
      return runtime.query.diagnostics({ limit })
    case 'workspace.project':
      return runtime.projects.find((project) => project.name === input.name)
    case 'workspace.config':
      return runtime.query.config()
    case 'workspace.services':
      return runtime.query.services()
    case 'workspace.serviceHealth':
      if (typeof input.id === 'string')
        return runtime.state.services.find((service) => service.id === input.id)?.health
      return Object.fromEntries(
        runtime.state.services.map((service) => [service.id, service.health]),
      )
    case 'workspace.artifacts':
      return runtime.query.artifacts()
    case 'workspace.events':
      return runtime.query.events({ limit })
    case 'workspace.timeline':
      return runtime.query.timeline(limit)
    case 'workspace.dependencyQuery': {
      const name = String(input.name ?? '')
      const direction = input.direction === 'dependents' ? 'dependents' : 'dependencies'
      if (direction === 'dependents')
        return runtime.graph.dependents(name).slice(0, limit)
      return runtime.graph.dependencies(name).map((pkg) => pkg.name).slice(0, limit)
    }
    case 'workspace.resolveImport':
      return runtime.resolve(String(input.specifier ?? ''))
    default:
      if (id.startsWith('plugin.')) return runtime.query.plugin(id.slice('plugin.'.length))
      throw new Error(`Unknown Workspace Runtime MCP tool "${id}"`)
  }
}

function baseTools(): McpEntry[] {
  return [
    entry(
      'workspace.overview',
      'Workspace overview',
      'Return runtime counts, profile, and high-level status.',
      'tool',
    ),
    entry('workspace.projects', 'Projects', 'Return runtime projects.', 'tool'),
    entry(
      'workspace.packages',
      'Packages',
      'Search or list discovered workspace packages.',
      'tool',
    ),
    entry('workspace.graph', 'Graph', 'Return workspace graph nodes and edges.', 'tool'),
    entry('workspace.diagnostics', 'Diagnostics', 'Return runtime diagnostics.', 'tool'),
    entry('workspace.events', 'Events', 'Return recorded runtime events.', 'tool'),
    entry('workspace.timeline', 'Timeline', 'Return recent runtime timeline entries.', 'tool'),
    entry(
      'workspace.services',
      'Services',
      'Return registered runtime services and lifecycle state.',
      'tool',
    ),
    entry(
      'workspace.serviceHealth',
      'Service health',
      'Return service health by id or for all services.',
      'tool',
    ),
    entry('workspace.artifacts', 'Artifacts', 'Return generated artifact metadata.', 'tool'),
    entry('workspace.config', 'Config', 'Return runtime config and sources.', 'tool'),
    entry('workspace.exports', 'Exports', 'Return package export maps.', 'tool'),
    entry('workspace.imports', 'Imports', 'Return resolved import aliases.', 'tool'),
    entry(
      'workspace.dependencyQuery',
      'Dependency query',
      'Query package dependencies or dependents.',
      'tool',
    ),
    entry(
      'workspace.resolveImport',
      'Resolve import',
      'Resolve one import specifier through Workspace Runtime.',
      'tool',
    ),
  ]
}

function baseResources(): McpEntry[] {
  return [
    entry('workspace://overview', 'Workspace overview', 'Runtime overview resource.', 'resource'),
    entry('workspace://packages', 'Packages', 'Discovered package list resource.', 'resource'),
    entry('workspace://imports', 'Imports', 'Resolved import alias resource.', 'resource'),
    entry(
      'workspace://graph',
      'Dependency graph',
      'Workspace dependency graph resource.',
      'resource',
    ),
    entry('workspace://diagnostics', 'Diagnostics', 'Runtime diagnostics resource.', 'resource'),
    entry('workspace://events', 'Events', 'Recorded runtime events resource.', 'resource'),
    entry('workspace://timeline', 'Timeline', 'Runtime timeline resource.', 'resource'),
    entry(
      'workspace://artifacts',
      'Artifacts',
      'Generated artifact metadata resource.',
      'resource',
    ),
    entry('workspace://services', 'Services', 'Runtime service registry resource.', 'resource'),
  ]
}

function entry(id: string, title: string, description: string, kind: McpEntry['kind']): McpEntry {
  return { id, title, description, kind }
}

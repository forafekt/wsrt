import type {
  DiagnosticLevel,
  RuntimeOverview,
  RuntimeProject,
  RuntimeQuery,
  WorkspaceRuntime,
} from '@wsrt/types'
import { flattenProjects } from './model.js'

export function createRuntimeQuery(runtime: () => WorkspaceRuntime): RuntimeQuery {
  return {
    overview() {
      return runtimeOverview(runtime())
    },
    projects() {
      return flattenProjects(runtime().state.projects).map(publicProject)
    },
    packages(query = {}) {
      const packages = runtime().state.packages
      const search = query.search?.toLowerCase()
      const filtered = search
        ? packages.filter(
            (pkg) =>
              pkg.name.toLowerCase().includes(search) ||
              pkg.root.toLowerCase().includes(search),
          )
        : packages
      return typeof query.limit === 'number' ? filtered.slice(0, query.limit) : filtered
    },
    services() {
      return runtime().state.services
    },
    graph(query) {
      return runtime().graph.query(query)
    },
    diagnostics(query = {}) {
      const diagnostics = query.level
        ? runtime().state.diagnostics.filter((diagnostic) => diagnostic.level === query.level)
        : runtime().state.diagnostics
      return typeof query.limit === 'number' ? diagnostics.slice(0, query.limit) : diagnostics
    },
    artifacts() {
      return runtime().state.artifacts
    },
    events(query = {}) {
      const events = query.name
        ? runtime().timeline.list().filter((entry) => entry.name === query.name)
        : runtime().timeline.list()
      return typeof query.limit === 'number' ? events.slice(-query.limit) : events
    },
    timeline(limit) {
      return runtime().timeline.recent(limit)
    },
    config() {
      const state = runtime().state
      return {
        root: state.root,
        configFile: state.configFile,
        sources: state.configSources,
        config: runtime().config.raw,
      }
    },
    tasks() {
      return runtime().tasks.list()
    },
    cli() {
      return runtime().cli.listGroups()
    },
    plugin(id) {
      const data = runtime().state.pluginData[id]
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const record = data as Record<string, unknown>
        if ('state' in record && Object.keys(record).length === 1) return record.state
      }
      return data
    },
    plugins() {
      return runtime().state.plugins.list()
    },
    pluginsData() {
      return runtime().state.pluginData
    },
  }
}

function publicProject(project: RuntimeProject): RuntimeProject {
  return {
    ...project,
    config: { ...project.config, environment: undefined },
    processes: project.processes.map(publicProject),
  }
}

function runtimeOverview(runtime: WorkspaceRuntime): RuntimeOverview {
  const diagnostics = runtime.state.diagnostics
  return {
    root: runtime.state.root,
    profile: runtime.state.profile,
    configFile: runtime.state.configFile,
    counts: {
      projects: flattenProjects(runtime.state.projects).length,
      packages: runtime.state.packages.length,
      services: runtime.state.services.length,
      runningServices: runtime.state.services.filter((service) => service.state === 'running')
        .length,
      diagnostics: diagnostics.length,
      errors: countDiagnostics(diagnostics, 'error'),
      warnings: countDiagnostics(diagnostics, 'warning'),
      artifacts: runtime.state.artifacts.length,
      events: runtime.timeline.list().length,
      tasks: runtime.tasks.list().length,
      commandGroups: runtime.cli.listGroups().length,
    },
  }
}

function countDiagnostics(
  diagnostics: WorkspaceRuntime['state']['diagnostics'],
  level: DiagnosticLevel,
): number {
  return diagnostics.filter((diagnostic) => diagnostic.level === level).length
}

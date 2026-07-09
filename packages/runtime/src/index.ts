import path from 'node:path'
import { createProjectAdapters } from '@wsrt/adapter-core'
import { generateArtifacts } from '@wsrt/artifacts'
import { loadWsrtConfig } from '@wsrt/config'
import { mergeWsrtConfig } from '@wsrt/config/merge'
import { resolveWsrtConfig } from '@wsrt/config/resolver'
import { createRuntimeEventBus, createRuntimeTimeline } from '@wsrt/events'
import { buildWorkspaceGraph } from '@wsrt/graph'
import { createMcpState } from '@wsrt/mcp'
import {
  applyConfigPlugins,
  createPluginRuntimeState,
  runArtifactsGeneratedPlugins,
  runMcpToolPlugins,
  runRuntimePlugins,
  withFirstPartyPlugins,
} from '@wsrt/plugins'
import { buildAliasMap, resolveSpecifier } from '@wsrt/resolve'
import { createServiceRegistry, serviceKindForAdapter } from '@wsrt/services'
import { syncManifests } from '@wsrt/sync/manifests'
import { syncTsconfigs } from '@wsrt/sync/tsconfig'
import type {
  LoadedWsrtConfig,
  ProjectAdapter,
  ProjectHandle,
  ResolutionResult,
  RuntimeCommandDefinition,
  RuntimeService,
  RuntimeServiceDefinition,
  RuntimeTaskDefinition,
  WsrtConfig,
  WsrtPlugin,
  WorkspaceRuntime,
  WorkspaceRuntimeOptions,
  WorkspaceRuntimeState,
} from '@wsrt/types'
import { createVirtualImportState } from '@wsrt/virtual'
import { registerCoreRuntimeExtensions } from './builtins.js'
import {
  createRuntimeConfigAccess,
  createRuntimeDiagnostics,
  createRuntimeGraphModel,
} from './model.js'
import { discoverWorkspacePackages } from './packages.js'
import { resolveProjects } from './projects.js'
import { createRuntimeQuery } from './query.js'
import {
  createRuntimeCliRegistry,
  createRuntimeCommandRegistry,
  createRuntimeTaskRegistry,
} from './registries.js'

export async function createWorkspaceRuntime(
  options: WorkspaceRuntimeOptions = {},
): Promise<WorkspaceRuntime> {
  const loaded = await loadWsrtConfig(options.root ?? process.cwd(), options.config)
  const mergedConfig = options.inlineConfig
    ? mergeWsrtConfig(loaded.config, options.inlineConfig)
    : loaded.config
  const resolvedConfig = await resolveWsrtConfig(mergedConfig as Record<string, unknown>, {
    source: loaded.configFile ?? loaded.root,
    baseDir: loaded.configFile ? path.dirname(loaded.configFile) : loaded.root,
    root: loaded.root,
    diagnostics: loaded.diagnostics,
  }) as WsrtConfig
  const config = await applyConfigPlugins(withFirstPartyPlugins(resolvedConfig))
  const runtime = createRuntimeFromLoaded(
    { ...loaded, config },
    { adapters: [...(options.adapters ?? []), ...resolvedAdapters(config)] },
  )
  await initializeWorkspaceRuntime(runtime, config)
  return runtime
}

export function createRuntimeFromLoaded(
  loaded: LoadedWsrtConfig,
  options: Pick<WorkspaceRuntimeOptions, 'adapters'> = {},
): WorkspaceRuntime {
  const root = path.resolve(loaded.root)
  const diagnostics = [...loaded.diagnostics]
  const packages = discoverWorkspacePackages(root, loaded.config, diagnostics)
  const aliases = buildAliasMap(root, packages, loaded.config.extraAliases)
  const graph = buildWorkspaceGraph(packages, loaded.config.graph?.includeExternal)
  const projects = resolveProjects(root, loaded.config, diagnostics)
  const tsconfigMode = loaded.config.tsconfig?.mode ?? 'check'
  const manifestMode = loaded.config.manifests?.mode ?? 'check'
  const profile = {
    environment:
      loaded.config.runtime?.environment ??
      (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
    name: loaded.config.runtime?.profile ?? 'default',
  } as const
  const state: WorkspaceRuntimeState = {
    root,
    profile,
    configFile: loaded.configFile,
    configSources: loaded.sources,
    projects,
    packages,
    aliases,
    graph,
    diagnostics,
    reports: { config: loaded.config },
    services: [],
    tsconfig: { enabled: Boolean(loaded.config.tsconfig?.enabled), mode: tsconfigMode, files: [] },
    manifests: {
      enabled: Boolean(loaded.config.manifests?.enabled),
      mode: manifestMode,
      files: [],
    },
    virtualImports: {
      imports: [],
      fallbackDir: path.join(root, '.wsrt/virtual'),
      diagnostics: [],
    },
    artifacts: [],
    timeline: [],
    plugins: createPluginRuntimeState(loaded.config),
    pluginData: {},
    dashboard: { routes: [], pages: [] },
    mcp: createMcpState(loaded.config),
  }
  const timeline = createRuntimeTimeline()
  state.timeline = timeline.list()
  const events = createRuntimeEventBus(timeline)
  const services = createServiceRegistry(events)
  const syncServices = () => {
    state.services = services.list()
  }
  events.on('service:registered', syncServices)
  events.on('service:failed', syncServices)
  events.on('service:started', syncServices)
  events.on('service:stopped', syncServices)
  events.on('service:health', syncServices)
  let runtime: WorkspaceRuntime
  const adapters = createProjectAdapters(options.adapters)
  const runtimeConfig = createRuntimeConfigAccess(loaded.config)
  const runtimeDiagnostics = createRuntimeDiagnostics(state, events)
  const runtimeGraph = createRuntimeGraphModel(state)
  const tasks = createRuntimeTaskRegistry(() => runtime, events)
  const commands = createRuntimeCommandRegistry(() => runtime, events)
  const cli = createRuntimeCliRegistry(() => runtime)
  const query = createRuntimeQuery(() => runtime)
  runtime = {
    state,
    root,
    profile,
    projects: state.projects,
    packages: state.packages,
    graph: runtimeGraph,
    services,
    plugins: state.plugins,
    diagnostics: runtimeDiagnostics,
    artifacts: state.artifacts,
    events,
    timeline,
    query,
    cli,
    tasks,
    commands,
    setPluginData: (plugin, key, data) => {
      const current = state.pluginData[plugin]
      state.pluginData[plugin] =
        current && typeof current === 'object' && !Array.isArray(current)
          ? { ...(current as Record<string, unknown>), [key]: data }
          : { [key]: data }
      events.emit('plugin:data-updated', { plugin, key, data })
    },
    config: runtimeConfig,
    inspect: () => state,
    start: async () => {
      const handles: ProjectHandle[] = []
      for (const project of state.projects) {
        const service = ensureProjectService(runtime, project.name)
        await services.start(service.id)
        if (service.handle) handles.push(service.handle)
      }
      events.emit('runtime:started', { runtime })
      return handles
    },
    stop: async () => {
      await Promise.all(
        services
          .list()
          .filter((service) => service.state === 'running')
          .map((service) => services.stop(service.id)),
      )
      events.emit('runtime:stopped', { runtime })
    },
    resolve: (specifier: string): ResolutionResult =>
      resolveSpecifier(specifier, aliases, packages),
    runProject: async (name: string) => {
      const service = ensureProjectService(runtime, name)
      await services.start(service.id)
      if (!service.handle)
        throw new Error(`Service "${service.id}" did not return a project handle`)
      return service.handle
    },
    syncTsconfig: (mode) => syncTsconfigs(runtime, mode),
    syncManifests: (mode) => syncManifests(runtime, mode),
    generateArtifacts: async () => {
      const artifacts = await generateArtifacts(runtime)
      await runArtifactsGeneratedPlugins(runtime, runtime.config.raw, artifacts)
      events.emit('artifacts:generated', { artifacts })
      return artifacts
    },
    getVirtualModule: (id) => state.virtualImports.imports.find((item) => item.id === id),
  }
  registerCoreRuntimeExtensions(runtime)
  for (const project of state.projects) registerProjectService(runtime, project.name)
  state.services = services.list()
  events.emit('config:loaded', { root, configFile: loaded.configFile })
  for (const project of state.projects) events.emit('project:discovered', { project })
  for (const workspacePackage of state.packages)
    events.emit('package:discovered', { package: workspacePackage })
  events.emit('graph:updated', { graph: state.graph })
  events.emit('runtime:created', { runtime })
  state.virtualImports = createVirtualImportState(runtime)
  return runtime

  function registerProjectService(currentRuntime: WorkspaceRuntime, name: string): RuntimeService {
    const project = state.projects.find((item) => item.name === name)
    if (!project) throw new Error(`Unknown runtime project "${name}"`)
    const adapter = adapters[project.adapter] as ProjectAdapter | undefined
    if (!adapter) throw new Error(`No adapter registered for "${project.adapter}"`)
    const id = `project:${project.name}`
    return services.register({
      id,
      name: project.name,
      kind: serviceKindForAdapter(project.adapter),
      project: project.name,
      adapter: project.adapter,
      root: project.root,
      command: project.config.command,
      environment: project.config.environment,
      metadata: {
        environment: project.environment,
        dependsOn: project.config.dependsOn ?? [],
        processes: project.processes.map((processProject) => processProject.name),
      },
      start: async () => {
        for (const plugin of resolvedPlugins(loaded.config))
          await plugin.beforeDev?.({ runtime: currentRuntime, project })
        const handle = await adapter.start({ runtime: currentRuntime, project })
        for (const plugin of resolvedPlugins(loaded.config))
          await plugin.projectStarted?.({ runtime: currentRuntime, project, handle })
        for (const plugin of resolvedPlugins(loaded.config))
          await plugin.afterDev?.({ runtime: currentRuntime, project, handle })
        const close = handle.close
        handle.close = async () => {
          await close()
          for (const plugin of resolvedPlugins(loaded.config))
            await plugin.projectStopped?.({ runtime: currentRuntime, project, handle })
        }
        return handle
      },
    })
  }

  function ensureProjectService(currentRuntime: WorkspaceRuntime, name: string): RuntimeService {
    return services.get(`project:${name}`) ?? registerProjectService(currentRuntime, name)
  }
}

function resolvedAdapters(config: WsrtConfig): ProjectAdapter[] {
  return (config.adapters ?? []).filter(isProjectAdapter)
}

function isProjectAdapter(value: unknown): value is ProjectAdapter {
  return isRecord(value) && 'name' in value && 'start' in value
}

function resolvedPlugins(config: WsrtConfig): WsrtPlugin[] {
  return (config.plugins ?? []).filter(isWsrtPlugin)
}

function isWsrtPlugin(value: unknown): value is WsrtPlugin {
  return isRecord(value) && 'name' in value
}

function isRuntimeTaskDefinition(value: unknown): value is RuntimeTaskDefinition {
  return isRecord(value) && 'id' in value && 'run' in value
}

function isRuntimeServiceDefinition(value: unknown): value is RuntimeServiceDefinition {
  return isRecord(value) && 'id' in value && 'kind' in value
}

function isRuntimeCommandDefinition(value: unknown): value is RuntimeCommandDefinition {
  return isRecord(value) && 'id' in value && 'run' in value
}

function registerConfigExtensions(runtime: WorkspaceRuntime, config: WsrtConfig): void {
  for (const task of (config.tasks ?? []).filter(isRuntimeTaskDefinition))
    runtime.tasks.register(task)
  for (const service of (config.services ?? []).filter(isRuntimeServiceDefinition))
    runtime.services.register(service)
  for (const action of (config.actions ?? []).filter(isRuntimeCommandDefinition))
    runtime.commands.register(action)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export async function initializeWorkspaceRuntime(
  runtime: WorkspaceRuntime,
  config: WsrtConfig,
): Promise<void> {
  registerConfigExtensions(runtime, config)
  await runRuntimePlugins(runtime, config)
  await runMcpToolPlugins(runtime, config, runtime.state.mcp.tools)
}

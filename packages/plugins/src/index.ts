import type {
  McpEntry,
  RuntimeArtifact,
  WsrtConfig,
  WsrtPlugin,
  WsrtPluginMetadata,
  WorkspaceRuntime,
} from '@wsrt/types'
import { dashboardPlugin, type DashboardPluginOptions } from '@wsrt/plugin-dashboard'
import { gitPlugin } from '@wsrt/plugin-git'
import { typeScriptPlugin } from '@wsrt/plugin-typescript'
import { workspacePlugin } from '@wsrt/plugin-workspace'

export function pluginNames(config: WsrtConfig): string[] {
  return resolvedPlugins(config).map((plugin) => plugin.name)
}

export function pluginMetadata(config: WsrtConfig): WsrtPluginMetadata[] {
  return resolvedPlugins(config).map((plugin) => normalizePluginMetadata(plugin))
}

export function createPluginRuntimeState(config: WsrtConfig): {
  names: string[]
  hooks: Record<string, string[]>
  metadata: WsrtPluginMetadata[]
  list: () => WsrtPluginMetadata[]
} {
  const metadata = pluginMetadata(config)
  return {
    names: pluginNames(config),
    hooks: pluginHooks(config),
    metadata,
    list: () => metadata,
  }
}

export function pluginHooks(config: WsrtConfig): Record<string, string[]> {
  const hooks: Record<string, string[]> = {}
  for (const plugin of resolvedPlugins(config)) {
    for (const key of Object.keys(plugin) as Array<keyof WsrtPlugin>) {
      if (key === 'name' || typeof plugin[key] !== 'function') continue
      hooks[String(key)] = [...(hooks[String(key)] ?? []), plugin.name]
    }
  }
  return hooks
}

function normalizePluginMetadata(plugin: WsrtPlugin): WsrtPluginMetadata {
  const metadata = plugin.metadata ?? {}
  return {
    name: metadata.name ?? plugin.name,
    version: metadata.version,
    description: metadata.description,
    homepage: metadata.homepage,
    repository: metadata.repository,
    capabilities: metadata.capabilities,
  }
}

export async function applyConfigPlugins(config: WsrtConfig): Promise<WsrtConfig> {
  let current = config
  for (const plugin of resolvedPlugins(config)) {
    const next = await plugin.config?.(current)
    if (next) current = next
  }
  return current
}

export async function runRuntimePlugins(
  runtime: WorkspaceRuntime,
  config: WsrtConfig,
): Promise<void> {
  const context = { runtime }
  for (const plugin of resolvedPlugins(config)) await plugin.configResolved?.(config, context)
  for (const plugin of resolvedPlugins(config))
    await plugin.packagesDiscovered?.(runtime.state.packages, context)
  for (const plugin of resolvedPlugins(config))
    await plugin.aliasesResolved?.(runtime.state.aliases, context)
  for (const plugin of resolvedPlugins(config)) await plugin.graphBuilt?.(runtime.graph, context)
  for (const plugin of resolvedPlugins(config))
    await plugin.diagnostics?.(runtime.diagnostics.list(), context)
  for (const plugin of resolvedPlugins(config)) await plugin.runtimeCreated?.(context)
}

export async function runArtifactsGeneratedPlugins(
  runtime: WorkspaceRuntime,
  config: WsrtConfig,
  artifacts: RuntimeArtifact[],
): Promise<void> {
  for (const plugin of resolvedPlugins(config))
    await plugin.artifactsGenerated?.(artifacts, { runtime })
}

export async function runMcpToolPlugins(
  runtime: WorkspaceRuntime,
  config: WsrtConfig,
  tools: McpEntry[],
): Promise<void> {
  for (const plugin of resolvedPlugins(config)) await plugin.mcpTools?.(tools, { runtime })
}

export function withFirstPartyPlugins(config: WsrtConfig): WsrtConfig {
  const plugins = [
    ...firstPartyPlugins(config),
    ...resolvedPlugins(config),
  ]
  const seen = new Set<string>()
  return {
    ...config,
    plugins: plugins.filter((plugin) => {
      if (seen.has(plugin.name)) return false
      seen.add(plugin.name)
      return true
    }),
  }
}

function resolvedPlugins(config: WsrtConfig): WsrtPlugin[] {
  return (config.plugins ?? []).filter(isWsrtPlugin)
}

function isWsrtPlugin(value: unknown): value is WsrtPlugin {
  return isRecord(value) && 'name' in value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function firstPartyPlugins(config: WsrtConfig): WsrtPlugin[] {
  const plugins = resolvedPlugins(config)
  return [
    workspacePlugin(),
    gitPlugin(),
    typeScriptPlugin(),
    ...(dashboardEnabledByConfig(config) && !plugins.some((plugin) => plugin.name === 'dashboard')
      ? [dashboardPlugin(dashboardOptions(config.dashboard))]
      : []),
  ]
}

function dashboardEnabledByConfig(config: WsrtConfig): boolean {
  return config.dashboard === true || (isRecord(config.dashboard) && config.dashboard.enabled !== false)
}

function dashboardOptions(config: WsrtConfig['dashboard']): DashboardPluginOptions {
  return isRecord(config) ? config as DashboardPluginOptions : {}
}

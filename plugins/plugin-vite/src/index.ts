import type { Alias, Plugin, ResolvedConfig } from 'vite'
import type { WsrtVitePluginOptions, WorkspaceRuntime } from '@wsrt/types'
import type { IncomingMessage, ServerResponse } from 'node:http'

export default function wsrt(options: WsrtVitePluginOptions = {}): Plugin {
  let resolvedConfig: ResolvedConfig | undefined
  return {
    name: 'wsrt',
    enforce: 'pre',
    config() {
      options.diagnostics?.push({
        level: 'info',
        code: 'vite.plugin.manual',
        message: 'Manual WSRT Vite plugin detected',
      })
      return {
        resolve: {
          alias: options.runtime ? createViteAliasEntries(options.runtime.state.aliases) : [],
        },
      }
    },
    configResolved(config) {
      resolvedConfig = config
      if (!options.runtime) return
      for (const [find, replacement] of Object.entries(options.runtime.state.aliases)) {
        options.runtime.diagnostics.add({
          level: 'info',
          code: 'vite.alias.injected',
          message: `Injected Vite alias ${find}`,
          detail: { find, replacement, projectRoot: config.root },
        })
      }
    },
    resolveId(id) {
      if (options.runtime?.getVirtualModule(id)) return `\0${id}`
      if (!options.runtime || shouldSkipResolve(id)) return null
      const resolved = options.runtime.resolve(id)
      if (!resolved.resolved) {
        if (isBareSpecifier(id)) {
          options.runtime.diagnostics.add({
            level: 'warning',
            code: 'vite.resolve.failed',
            message: `WSRT could not resolve ${id}`,
            detail: { id, root: resolvedConfig?.root, source: resolved.source },
          })
        }
        return null
      }
      options.runtime.diagnostics.add({
        level: 'info',
        code: 'vite.resolve.success',
        message: `Resolved ${id} to ${resolved.resolved}`,
        detail: resolved,
      })
      return resolved.resolved
    },
    load(id) {
      if (!options.runtime || !id.startsWith('\0virtual:wsrt')) return null
      return options.runtime.getVirtualModule(id.slice(1))?.contents ?? null
    },
    configureServer(server) {
      const dashboard = options.runtime ? dashboardRequestHandler(options.runtime) : undefined
      if (dashboard) server.httpServer?.once('close', dashboard.close)
      server.middlewares.use((request, response, next) => {
        if (dashboard?.handle(request, response)) return
        next()
      })
      server.middlewares.use('/__wsrt/state', (_request, response) => {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(options.runtime?.inspect() ?? { diagnostics: options.diagnostics ?? [] }, null, 2))
      })
    },
  }
}

export { wsrt }

 type DashboardRequestHandler = {
    handle: (request: IncomingMessage, response: ServerResponse) => boolean;
    close: () => void;
}

function dashboardRequestHandler(runtime: WorkspaceRuntime): DashboardRequestHandler | undefined {
  const api = runtime.query.plugin('dashboard')
  if (!isRecord(api)) return undefined
  const dashboardApi = api.api
  if (!isRecord(dashboardApi) || typeof dashboardApi.createRequestHandler !== 'function') return undefined
  return dashboardApi.createRequestHandler(runtime)
}

export function hasWsrtVitePlugin(plugins: unknown): boolean {
  return flattenPlugins(plugins).some((plugin) => plugin.name === 'wsrt')
}

export function flattenPlugins(plugins: unknown): Array<{ name: string }> {
  if (!plugins) return []
  if (Array.isArray(plugins)) return plugins.flatMap((plugin) => flattenPlugins(plugin))
  if (typeof plugins === 'object' && 'name' in plugins && typeof plugins.name === 'string') return [plugins as { name: string }]
  return []
}

export function createViteAliasEntries(aliases: Record<string, string>): Alias[] {
  return Object.entries(aliases)
    .sort(([a], [b]) => b.length - a.length)
    .map(([find, replacement]) => ({ find: exactSpecifierPattern(find), replacement }))
}

function exactSpecifierPattern(specifier: string): RegExp {
  return new RegExp(`^${escapeRegExp(specifier)}$`)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function shouldSkipResolve(id: string): boolean {
  return (
    id.startsWith('\0') ||
    id.startsWith('/') ||
    id.startsWith('.') ||
    id.includes('?') ||
    (id.startsWith('virtual:') && !id.startsWith('virtual:wsrt'))
  )
}

function isBareSpecifier(id: string): boolean {
  return !id.startsWith('\0') && !id.startsWith('/') && !id.startsWith('.') && !id.includes(':')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

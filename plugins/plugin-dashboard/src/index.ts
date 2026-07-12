/** biome-ignore-all lint/correctness/noVoidTypeReturn: Node HTTP handlers use void-returning callbacks. */
import { readFileSync } from 'node:fs'
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ServerConfig,
  WsrtPlugin,
  WorkspaceRuntime,
  WorkspaceRuntimeState,
  WsrtConfig,
} from '@wsrt/types'
import {
  dashboardExports,
  dashboardGraph,
  dashboardOverview,
  dashboardPackage,
  dashboardProject,
  dashboardServerStatus,
} from './api.js'
export { controlPlaneDashboardOperation, controlPlaneDashboardSnapshot } from './api.js'
import { dashboardHtml } from './app/dashboard-html.js'
import type { DashboardPluginPage, DashboardRoute } from './types/index.js'

export type DashboardHandle = {
  url: string
  close: () => Promise<void>
}

export type DashboardRequestHandler = {
  handle: (request: IncomingMessage, response: ServerResponse) => boolean
  close: () => void
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const dashboardClientDir = join(__dirname, 'app/client')

export type DashboardPluginOptions = ServerConfig & {
  enabled?: boolean
  path?: string
  pages?: DashboardPluginPage[]
  routes?: DashboardRoute[]
}

export type DashboardPluginApi = {
  createRequestHandler: (runtime: WorkspaceRuntime, options?: { basePath?: string }) => DashboardRequestHandler
  start: (runtime: WorkspaceRuntime, options?: DashboardPluginOptions) => Promise<DashboardHandle>
  routes: DashboardRoute[]
  pages: DashboardPluginPage[]
}

export default function dashboardPlugin(options: DashboardPluginOptions = {}): WsrtPlugin {
  const enabled = options.enabled ?? true
  const pages = options.pages ?? []
  const routes = options.routes ?? []
  return {
    name: 'dashboard',
    config(config) {
      if (!enabled) return config
      // const legacy = dashboardConfig(config)
      return {
        ...config,
      }
    },
    async runtimeCreated({ runtime }) {
      if (!enabled) return
      // const config = dashboardConfig(runtime.config.get('dashboard'))
      const basePath = options.path ?? '/__wsrt'
      runtime.state.dashboard = {
        routes: baseDashboardRoutes(runtime.state, routes),
        pages: pages,
      }

      await runDashboardRoutePlugins(runtime, runtime.config.raw)
      await runDashboardPagePlugins(runtime, runtime.config.raw)
      runtime.setPluginData('dashboard', 'api', {
        createRequestHandler: createDashboardRequestHandler,
        start: startDashboard,
        routes: runtime.state.dashboard.routes,
        pages: runtime.state.dashboard.pages,
      } satisfies DashboardPluginApi)
      runtime.services.register({
        id: 'dashboard',
        name: 'Dashboard',
        kind: 'custom',
        url: dashboardUrl({
          host: options.host,
          port: options.port,
          basePath,
        }),
        start: async () => {
          const dashboard = await startDashboard(runtime, {
            host: options.host,
            port: options.port ,
            basePath,
          })
          return {
            name: 'dashboard',
            adapter: 'dashboard',
            url: dashboard.url,
            status: 'running',
            metadata: {},
            close: dashboard.close,
          }
        },
      })
      runtime.commands.register({
        id: 'dashboard',
        title: 'Start dashboard service',
        description: 'Start the registered dashboard runtime service.',
        run: async ({ runtime: currentRuntime }) => currentRuntime.services.start('dashboard'),
      })
    },
  }
}

export { dashboardPlugin }

function dashboardClientAsset(response: ServerResponse, pathname: string, basePath: string): void {
  const relativePath = pathname.slice(`${basePath}/client/`.length).replace(/^\/+/, '')

  const filePath = normalize(join(dashboardClientDir, relativePath))

  if (!filePath.startsWith(dashboardClientDir)) {
    response.statusCode = 403
    response.end('Forbidden')
    return
  }

  try {
    const asset = readFileSync(filePath)

    response.setHeader('content-type', dashboardAssetContentType(filePath))
    response.end(asset)
  } catch {
    response.statusCode = 404
    response.end('Not found')
  }
}

function dashboardAssetContentType(filePath: string): string {
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8'
  if (filePath.endsWith('.svg')) return 'image/svg+xml; charset=utf-8'
  return 'application/octet-stream'
}

function baseDashboardRoutes(state: WorkspaceRuntimeState, additionalRoutes: DashboardRoute[]): DashboardRoute[] {
  const routes: DashboardRoute[] = [
    { id: 'overview', label: 'Overview', path: '#overview' },
    { id: 'projects', label: 'Projects', path: '#projects' },
    { id: 'packages', label: 'Packages', path: '#packages' },
    { id: 'graph', label: 'Graph', path: '#graph' },
    { id: 'diagnostics', label: 'Diagnostics', path: '#diagnostics' },
    { id: 'sync', label: 'Sync', path: '#sync' },
    { id: 'virtual', label: 'Virtual Imports', path: '#virtual' },
    { id: 'plugins', label: 'Plugins', path: '#plugins' },
    { id: 'artifacts', label: 'Artifacts', path: '#artifacts' },
    { id: 'mcp', label: 'MCP', path: '#mcp' },
    ...additionalRoutes,
  ]
  return state.projects.some((project) => project.adapter === 'vite')
    ? [
        ...routes.slice(0, 2),
        { id: 'vite-targets', label: 'Vite Targets', path: '#vite-targets' },
        ...routes.slice(2),
      ]
    : routes
}

function dashboardUrl(options: { host?: string; port?: number; basePath?: string }): string {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 5177
  const basePath = normalizeBasePath(options.basePath ?? '/__wsrt')
  return `http://${host}:${port}${basePath}`
}

// function dashboardConfig(config: unknown): DashboardPluginOptions {
//   return isRecord(config) ? config as DashboardPluginOptions : {}
// }

async function runDashboardRoutePlugins(
  runtime: WorkspaceRuntime,
  config: WsrtConfig,
): Promise<void> {
  for (const plugin of resolvedPlugins(config)) await plugin.custom?.({ runtime })
}

async function runDashboardPagePlugins(
  runtime: WorkspaceRuntime,
  config: WsrtConfig,
): Promise<void> {
  runtime.state.dashboard.pages.splice(0, runtime.state.dashboard.pages.length)
  for (const plugin of resolvedPlugins(config)) await plugin.custom?.({ runtime })
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

export async function startDashboard(
  runtime: WorkspaceRuntime,
  options: { host?: string; port?: number; basePath?: string } = {},
): Promise<DashboardHandle> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 5177
  const basePath = normalizeBasePath(options.basePath ?? '/__wsrt')
  const dashboard = createDashboardRequestHandler(runtime, { basePath })
  const server = http.createServer((request, response) => {
    if (dashboard.handle(request, response)) return
    response.statusCode = 404
    response.end('Not found')
  })
  await listen(server, port, host)
  return {
    url: `http://${host}:${addressPort(server)}${basePath}`,
    close: () =>
      new Promise((resolve, reject) => {
        dashboard.close()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

export function createDashboardRequestHandler(
  runtime: WorkspaceRuntime,
  options: { basePath?: string } = {},
): DashboardRequestHandler {
  const basePath = normalizeBasePath(options.basePath ?? '/__wsrt')
  const clients = new Set<ServerResponse>()
  const interval = setInterval(() => {
    const payload = `event: state\ndata: ${JSON.stringify({ signature: dashboardSignature(runtime) })}\n\n`
    for (const client of clients) client.write(payload)
  }, 2000)
  interval.unref()
  return {
    handle(request, response) {
      response.setHeader('access-control-allow-origin', '*')
      response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
      response.setHeader('access-control-allow-headers', 'content-type')
      if (request.method === 'OPTIONS') {
        response.statusCode = 204
        response.end()
        return true
      }

      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

      if (url.pathname === `${basePath}/state`) {
        json(response, runtime.inspect())
        return true
      }

      if (url.pathname === `${basePath}/events`) {
        events(response, clients)
        return true
      }

      if (url.pathname.startsWith(`${basePath}/api/`)) {
        void api(runtime, request, response, stripApiPrefix(url.pathname, basePath))
        return true
      }

      if (url.pathname.startsWith(`${basePath}/client/`)) {
        dashboardClientAsset(response, url.pathname, basePath)
        return true
      }

      if (isDashboardRoute(url.pathname, basePath)) {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(dashboardHtml(basePath))
        return true
      }

      return false
    },
    close() {
      clearInterval(interval)
      for (const client of clients) client.end()
    },
  }
}

async function api(
  runtime: WorkspaceRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  route: string,
): Promise<void> {
  if (request.method === 'POST' && route.startsWith('/actions/')) {
    return actionApi(runtime, request, response, route)
  }
  if (request.method !== 'GET') {
    response.statusCode = 405
    return json(response, { error: 'Method not allowed' })
  }
  if (route === '/overview') return json(response, dashboardOverview(runtime))
  if (route === '/projects') return json(response, runtime.query.projects())
  if (route.startsWith('/projects/'))
    return maybeJson(
      response,
      dashboardProject(runtime, decodeURIComponent(route.slice('/projects/'.length))),
    )
  if (route === '/packages') return json(response, runtime.query.packages())
  if (route.startsWith('/packages/'))
    return maybeJson(
      response,
      dashboardPackage(runtime, decodeURIComponent(route.slice('/packages/'.length))),
    )
  if (route === '/graph') return json(response, dashboardGraph(runtime))
  if (route === '/aliases') return json(response, runtime.state.aliases)
  if (route === '/exports') return json(response, dashboardExports(runtime))
  if (route === '/diagnostics') return json(response, runtime.query.diagnostics())
  if (route === '/config') {
    return json(response, {
      ...runtime.query.config(),
      mergedConfig: runtime.config.raw,
      diagnostics: runtime.state.diagnostics.filter((diagnostic) =>
        diagnostic.code.startsWith('config.'),
      ),
    })
  }
  if (route === '/artifacts') return json(response, runtime.query.artifacts())
  if (route === '/services') return json(response, runtime.query.services())
  if (route === '/events') return json(response, runtime.query.events())
  if (route === '/timeline') return json(response, runtime.query.timeline())
  if (route === '/tasks') return json(response, runtime.query.tasks())
  if (route === '/mcp') return json(response, runtime.state.mcp)
  if (route === '/plugins') {
    return json(response, {
      ...runtime.state.plugins,
      metadata: runtime.query.plugins(),
    })
  }
  if (route === '/plugin-data') return json(response, runtime.state.pluginData)
  if (route === '/plugin-pages') {
    await runDashboardPagePlugins(runtime, runtime.config.raw)
    return json(response, runtime.state.dashboard.pages)
  }
  if (route.startsWith('/plugin-data/'))
    return maybeJson(response, runtime.query.plugin(decodeURIComponent(route.slice('/plugin-data/'.length))))
  if (route === '/virtual') return json(response, runtime.state.virtualImports)
  if (route === '/server-status') return json(response, dashboardServerStatus(runtime))
  response.statusCode = 404
  json(response, { error: `Unknown dashboard API route ${route}` })
}

async function actionApi(
  runtime: WorkspaceRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  route: string,
): Promise<void> {
  try {
    const body = await readJson(request)
    const id = typeof body.id === 'string' ? body.id : ''

    if (route === '/actions/service/start') {
      const service = await runtime.services.start(id)
      runtime.events.emit('dashboard:action', { action: route, id, status: 'ok' })
      return json(response, { ok: true, service })
    }
    if (route === '/actions/service/stop') {
      const service = await runtime.services.stop(id)
      runtime.events.emit('dashboard:action', { action: route, id, status: 'ok' })
      return json(response, { ok: true, service })
    }
    if (route === '/actions/service/restart') {
      const service = await runtime.services.restart(id)
      runtime.events.emit('dashboard:action', { action: route, id, status: 'ok' })
      return json(response, { ok: true, service })
    }
    if (route === '/actions/service/health') {
      const health = await runtime.services.health(id)
      runtime.events.emit('dashboard:action', { action: route, id, status: 'ok' })
      return json(response, { ok: true, health })
    }
    if (route === '/actions/service/logs') {
      const logs = await runtime.services.logs(id)
      runtime.events.emit('dashboard:action', { action: route, id, status: 'ok' })
      return json(response, { ok: true, logs })
    }
    if (route === '/actions/task/run') {
      const result = await runtime.tasks.run(id, {
        args: Array.isArray(body.args) ? body.args.map(String) : [],
        input: body.input,
      })
      runtime.events.emit('dashboard:action', { action: route, id, status: 'ok' })
      return json(response, { ok: true, result })
    }
    if (route === '/actions/command/run') {
      const result = await runtime.commands.run(id, {
        args: Array.isArray(body.args) ? body.args.map(String) : [],
        input: body.input,
      })
      runtime.events.emit('dashboard:action', { action: route, id, status: 'ok' })
      return json(response, { ok: true, result })
    }
    if (route === '/actions/graph/export') {
      const graph = dashboardGraph(runtime)
      runtime.events.emit('dashboard:action', { action: route, status: 'ok' })
      return json(response, { ok: true, graph })
    }
    if (route === '/actions/config/reload') {
      runtime.events.emit('dashboard:action', { action: route, status: 'unsupported' })
      return json(response, { ok: false, error: 'Config reload is not supported by this runtime instance yet.' })
    }

    response.statusCode = 404
    return json(response, { error: `Unknown dashboard action ${route}` })
  } catch (cause) {
    runtime.events.emit('dashboard:action', { action: route, status: 'failed' })
    response.statusCode = 500
    return json(response, { error: cause instanceof Error ? cause.message : String(cause) })
  }
}

function readJson(request: IncomingMessage): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 1_000_000) {
        reject(new Error('Request body is too large'))
        request.destroy()
      }
    })
    request.on('end', () => {
      if (!body.trim()) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch (cause) {
        reject(cause)
      }
    })
    request.on('error', reject)
  })
}

function maybeJson(response: ServerResponse, value: unknown): void {
  if (value === undefined) {
    response.statusCode = 404
    json(response, { error: 'Not found' })
    return
  }
  json(response, value)
}

function json(response: ServerResponse, value: unknown): void {
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value, null, 2))
}

function events(response: ServerResponse, clients: Set<ServerResponse>): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  })
  response.write(`event: state\ndata: ${JSON.stringify({ connected: true, signature: '' })}\n\n`)
  clients.add(response)
  response.on('close', () => clients.delete(response))
}

function stripApiPrefix(pathname: string, basePath: string): string {
  if (pathname.startsWith(`${basePath}/api`)) return pathname.slice(`${basePath}/api`.length) || '/'
  return pathname
}

function isDashboardRoute(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname === `${basePath}/` || pathname.startsWith(`${basePath}/`)
}

function normalizeBasePath(value: string): string {
  const withSlash = value.startsWith('/') ? value : `/${value}`
  return withSlash.endsWith('/') && withSlash !== '/' ? withSlash.slice(0, -1) : withSlash
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function addressPort(server: Server): number {
  const address = server.address()
  return typeof address === 'object' && address ? address.port : 5177
}

function dashboardSignature(runtime: WorkspaceRuntime): string {
  const state = runtime.inspect()
  return [
    state.projects.length,
    state.packages.length,
    Object.keys(state.aliases).length,
    state.graph.nodes.length,
    state.graph.edges.length,
    state.diagnostics.length,
    state.artifacts.length,
    state.timeline.length,
    runtime.tasks.list().length,
    Object.keys(state.pluginData).length,
    // state.dashboard.pages.length,
    state.services
      .map((service) => `${service.id}:${service.state}:${service.health.status}`)
      .join(','),
  ].join(':')
}

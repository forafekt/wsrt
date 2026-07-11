import { apiBase, basePath } from './lib/html.js'
import { state } from './state.js'

export async function get(path: string): Promise<any> {
  const response = await fetch(apiBase() + path)
  if (!response.ok) throw new Error(path + ' returned ' + response.status)
  return response.json()
}

export async function post(path: string, body: Record<string, unknown> = {}): Promise<any> {
  const response = await fetch(apiBase() + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || path + ' returned ' + response.status)
  return payload
}

export async function refreshAll(): Promise<void> {
  const entries = await Promise.all([
    ['overview', get('/overview')],
    ['projects', get('/projects')],
    ['packages', get('/packages')],
    ['graph', get('/graph')],
    ['aliases', get('/aliases')],
    ['exports', get('/exports')],
    ['diagnostics', get('/diagnostics')],
    ['services', get('/services')],
    ['tasks', get('/tasks')],
    ['timeline', get('/timeline')],
    ['config', get('/config')],
    ['artifacts', get('/artifacts')],
    ['mcp', get('/mcp')],
    ['plugins', get('/plugins')],
    ['pluginData', get('/plugin-data')],
    ['pluginPages', get('/plugin-pages')],
    ['virtualImports', get('/virtual')],
    ['serverStatus', get('/server-status')],
  ].map(async ([key, promise]) => [key, await promise]))

  state.data = Object.fromEntries(entries)
}

export async function refreshRuntimeData(keys: string[] = []): Promise<void> {
  const loaders: Record<string, () => Promise<any>> = {
    overview: () => get('/overview'),
    projects: () => get('/projects'),
    packages: () => get('/packages'),
    graph: () => get('/graph'),
    aliases: () => get('/aliases'),
    exports: () => get('/exports'),
    diagnostics: () => get('/diagnostics'),
    services: () => get('/services'),
    tasks: () => get('/tasks'),
    timeline: () => get('/timeline'),
    config: () => get('/config'),
    artifacts: () => get('/artifacts'),
    mcp: () => get('/mcp'),
    plugins: () => get('/plugins'),
    pluginData: () => get('/plugin-data'),
    pluginPages: () => get('/plugin-pages'),
    virtualImports: () => get('/virtual'),
    serverStatus: () => get('/server-status'),
  }
  const selected = keys.length ? keys : Object.keys(loaders)
  const entries = await Promise.all(
    selected
      .filter((key) => loaders[key])
      .map(async (key) => [key, await loaders[key]()] as const),
  )
  state.data = { ...state.data, ...Object.fromEntries(entries) }
}

export async function runAction(path: string, body: Record<string, unknown> = {}): Promise<any> {
  const result = await post(path, body)
  await refreshRuntimeData(['overview', 'services', 'serverStatus', 'tasks', 'timeline', 'graph', 'pluginData', 'pluginPages'])
  window.dispatchEvent(new CustomEvent('wsrt:data-changed'))
  return result
}

export function connectEvents(onChange: () => void): () => void {
  if (!window.EventSource) return () => {}

  const events = new EventSource(basePath().replace(/\/$/, '') + '/events')

  events.addEventListener('open', () => {
    if (!state.connected) {
      state.connected = true
      onChange()
    }
  })

  events.addEventListener('error', () => {
    if (state.connected) {
      state.connected = false
      onChange()
    }
  })

  events.addEventListener('state', (event) => {
    let message: any = {}
    try { message = JSON.parse((event as MessageEvent).data || '{}') } catch {}

    if (!state.connected) {
      state.connected = true
      onChange()
    }

    if (!message.signature) return
    if (!state.liveSignature) {
      state.liveSignature = message.signature
      return
    }
    if (message.signature === state.liveSignature) return

    state.liveSignature = message.signature
    clearTimeout(state.refreshTimer)
    state.refreshTimer = window.setTimeout(async () => {
      const beforeRoute = state.route
      await refreshAll()
      state.route = beforeRoute
      onChange()
    }, 250)
  })

  return () => events.close()
}

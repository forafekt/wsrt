import './components/wsrt-app.js'
import './components/wsrt-sidebar.js'
import './components/wsrt-topbar.js'
import './components/wsrt-graph.js'
import { runAction } from './api.js'
import { go } from './router.js'

type DashboardActionDetail = {
  action?: string
  id?: string
  value?: string
}

window.addEventListener('wsrt:go', ((event: CustomEvent<string>) => {
  if (event.detail) go(event.detail)
}) as EventListener)

window.addEventListener('wsrt:action', (async (event: Event) => {
  const detail = (event as CustomEvent<DashboardActionDetail>).detail || {}
  const id = detail.id
  if (!id) return
  const body = detail.value ? { id, value: detail.value } : { id }
  if (detail.action === 'service:start') await runAction('/actions/service/start', body)
  if (detail.action === 'service:stop') await runAction('/actions/service/stop', body)
  if (detail.action === 'service:restart') await runAction('/actions/service/restart', body)
  if (detail.action === 'service:health') await runAction('/actions/service/health', body)
  if (detail.action === 'service:logs') await runAction('/actions/service/logs', body)
  if (detail.action === 'task:run') await runAction('/actions/task/run', body)
  if (detail.action === 'command:run') await runAction('/actions/command/run', body)
  if (detail.action === 'graph:export') await runAction('/actions/graph/export', {})
  if (detail.action === 'config:reload') await runAction('/actions/config/reload', {})
}) as EventListener)

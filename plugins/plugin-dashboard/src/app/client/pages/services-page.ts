import { badge, button, copyButton, esc, head, kv } from '../lib/html.js'
import { state } from '../state.js'

type DashboardService = {
  id: string
  name?: string
  kind?: string
  state?: string
  health?: { status?: string; checkedAt?: string; message?: string }
  adapter?: string
  project?: string
  root?: string
  url?: string
  command?: string
  logs?: Array<{ timestamp?: string; level?: string; message?: string }>
  metrics?: Array<{ name?: string; value?: unknown; unit?: string }>
  metadata?: Record<string, unknown>
  error?: string
}

export function servicesPage(): string {
  const services = (state.data.services || []) as DashboardService[]
  return head('Services', 'Lifecycle controls, health, logs, metrics, and runtime service context.') +
    '<div class="grid">' +
    metricCard('Registered', services.length) +
    metricCard('Running', services.filter((service) => service.state === 'running').length) +
    metricCard('Healthy', services.filter((service) => service.health?.status === 'healthy').length) +
    metricCard('Failed', services.filter((service) => service.state === 'failed').length) +
    '</div>' +
    '<div class="service-grid">' + (services.length ? services.map(serviceCard).join('') : '<div class="empty">No runtime services are registered.</div>') + '</div>'
}

function serviceCard(service: DashboardService): string {
  const running = service.state === 'running' || service.state === 'starting'
  const stopped = service.state === 'stopped' || service.state === 'registered' || service.state === 'failed'
  const endpoint = service.url || service.command || ''
  const logs = service.logs?.slice(-3).reverse() ?? []
  const metrics = service.metrics?.slice(0, 4) ?? []

  return '<section class="card service-card">' +
    '<div class="card-head"><div><h3>' + esc(service.name || service.id) + '</h3><p class="muted">' + esc(service.id) + '</p></div><div class="badge-row">' + badge(service.kind || 'service') + badge(service.state || 'unknown') + badge(service.health?.status || 'unknown') + '</div></div>' +
    '<div class="control-row">' +
    button('Start', 'service:start', service.id, !stopped) +
    button('Stop', 'service:stop', service.id, !running) +
    button('Restart', 'service:restart', service.id, !service.id) +
    button('Health', 'service:health', service.id) +
    button('Logs', 'service:logs', service.id) +
    '</div>' +
    '<div class="split compact"><div>' +
    kv({
      Adapter: service.adapter || 'unknown',
      Project: service.project || 'none',
      Endpoint: endpoint || 'none',
      Root: service.root || '',
      'Last check': service.health?.checkedAt ? new Date(service.health.checkedAt).toLocaleTimeString() : 'never',
    }) +
    '</div><div class="stack">' +
    (endpoint ? '<div class="inline-actions">' + (service.url ? '<a class="control-button" href="' + esc(service.url) + '" target="_blank" rel="noreferrer">Open</a>' : '') + copyButton(endpoint) + '</div>' : '<div class="empty small">No endpoint or command.</div>') +
    (service.error || service.health?.message ? '<div class="notice error-box">' + esc(service.error || service.health?.message) + '</div>' : '') +
    '</div></div>' +
    '<details><summary>Logs and metrics</summary><div class="split compact"><div>' + logList(logs) + '</div><div>' + metricList(metrics, service.metadata) + '</div></div></details>' +
    '</section>'
}

function logList(logs: DashboardService['logs']): string {
  if (!logs?.length) return '<div class="empty small">No logs loaded. Use Logs to refresh if the service exposes logs.</div>'
  return '<ol class="timeline compact-list">' + logs.map((log) => '<li><span>' + esc(log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '') + '</span><strong>' + esc(log.level || 'log') + '</strong><p>' + esc(log.message || '') + '</p></li>').join('') + '</ol>'
}

function metricList(metrics: DashboardService['metrics'], metadata?: Record<string, unknown>): string {
  if (metrics?.length) {
    return '<dl class="kv">' + metrics.map((metric) => '<dt>' + esc(metric.name || 'metric') + '</dt><dd>' + esc(metric.value) + ' ' + esc(metric.unit || '') + '</dd>').join('') + '</dl>'
  }
  const keys = Object.keys(metadata || {}).slice(0, 5)
  if (!keys.length) return '<div class="empty small">No metrics or metadata exposed.</div>'
  return '<dl class="kv">' + keys.map((key) => '<dt>' + esc(key) + '</dt><dd>' + esc(metadata?.[key]) + '</dd>').join('') + '</dl>'
}

function metricCard(label: string, value: unknown): string {
  return `<div class="card metric"><strong>${String(value ?? 0)}</strong><span>${label}</span></div>`
}

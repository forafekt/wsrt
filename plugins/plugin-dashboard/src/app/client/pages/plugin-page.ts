import { badge, button, copyButton, esc, head, kv, metric, table } from '../lib/html.js'
import { state } from '../state.js'

type PluginPage = {
  id: string
  title: string
  subtitle?: string
  plugin: string
  widgets: PluginWidget[]
}

type PluginWidget =
  | { kind: 'metric'; label: string; value: unknown }
  | { kind: 'key-values'; title: string; values: Record<string, unknown> }
  | { kind: 'table'; title: string; headers: string[]; rows: unknown[][] }
  | { kind: 'badges'; title: string; values: unknown[] }
  | { kind: 'actions'; title: string; actions: Array<{ label: string; action: string; id?: string; value?: string; disabled?: boolean }> }
  | { kind: 'json'; title: string; data: unknown }

export function pluginPage(id: string): string {
  const page = ((state.data.pluginPages || []) as PluginPage[]).find((item) => item.id === id)
  if (!page) return `${head('Plugin page', `No plugin dashboard page was registered for ${id}`)}<div class="empty">No page data is available.</div>`
  const metrics = page.widgets.filter((widget) => widget.kind === 'metric')
  const sections = page.widgets.filter((widget) => widget.kind !== 'metric')
  return head(page.title, page.subtitle || page.plugin) +
    (metrics.length ? `<div class="grid">${metrics.map((widget) => metric(widget.label, widget.value)).join('')}</div>` : '') +
    `<div class="plugin-sections">${sections.map(renderWidget).join('')}</div>`
}

function renderWidget(widget: PluginWidget): string {
  if (widget.kind === 'key-values') return card(widget.title, kv(widget.values))
  if (widget.kind === 'table') return card(widget.title, table(widget.headers, widget.rows, true))
  if (widget.kind === 'badges') return card(widget.title, widget.values.length ? widget.values.map((value) => badge(value)).join(' ') : '<div class="empty small">None</div>')
  if (widget.kind === 'actions') {
    return card(widget.title, `<div class="control-row">${widget.actions.map((action) =>
      action.action === 'copy'
        ? copyButton(action.value ?? action.id ?? '')
        : button(action.label, action.action, action.id, action.disabled),
    ).join('')}</div>`)
  }
  if (widget.kind === 'json') return card(widget.title, `<details><summary>Raw data</summary><pre>${esc(JSON.stringify(widget.data, null, 2))}</pre></details>`)
  return ''
}

function card(title: string, body: string): string {
  return `<section class="card"><h3>${esc(title)}</h3>${body}</section>`
}

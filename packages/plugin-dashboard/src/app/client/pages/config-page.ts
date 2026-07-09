import { badge, button, copyButton, esc, head, table } from '../lib/html.js'
import { state } from '../state.js'

export function configPage(): string {
  const config = state.data.config || {}
  const merged = config.mergedConfig || config.config || {}
  const sections = Object.entries(merged)

  return head('Config', 'Merged runtime configuration, source files, diagnostics, and override context.') +
    '<div class="control-row">' + button('Reload config', 'config:reload', 'runtime') + copyButton(JSON.stringify(merged, null, 2)) + '</div>' +
    '<div class="config-board">' +
    '<div class="stack"><div class="card"><h3>Sources</h3>' + table(['Kind', 'File'], (config.sources || []).map((source: any) => [badge(source.kind), source.file]), true) + '</div>' +
    '<div class="card"><h3>Config diagnostics</h3>' + diagnostics(config.diagnostics || []) + '</div></div>' +
    '<div class="stack"><div class="card"><h3>Merged sections</h3><div class="section-grid">' + (sections.length ? sections.map(sectionCard).join('') : '<div class="empty small">No config sections.</div>') + '</div></div>' +
    '<details class="card"><summary>Advanced raw JSON</summary><pre>' + esc(JSON.stringify(merged, null, 2)) + '</pre></details></div>' +
    '</div>'
}

function sectionCard([key, value]: [string, unknown]): string {
  const summary = Array.isArray(value)
    ? value.length + ' item(s)'
    : value && typeof value === 'object'
      ? Object.keys(value).length + ' key(s)'
      : String(value ?? '')
  return '<article class="section-card"><div><strong>' + esc(key) + '</strong><span>' + esc(summary) + '</span></div>' + copyButton(JSON.stringify(value, null, 2)) + '</article>'
}

function diagnostics(rows: any[]): string {
  if (!rows.length) return '<div class="empty small">No config diagnostics.</div>'
  return '<div class="stack">' + rows.map((diagnostic) => '<article class="notice"><div>' + badge(diagnostic.level) + ' <strong>' + esc(diagnostic.code) + '</strong></div><p>' + esc(diagnostic.message) + '</p><small>' + esc(diagnostic.source || '') + '</small></article>').join('') + '</div>'
}

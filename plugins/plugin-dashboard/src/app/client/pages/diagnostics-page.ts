import { badge, copyButton, esc, head } from '../lib/html.js'
import { matches, state } from '../state.js'

type Diagnostic = {
  level?: string
  code?: string
  message?: string
  source?: string
  project?: string
  package?: string
  suggestion?: string
}

export function diagnosticsPage(): string {
  const diagnostics = filteredDiagnostics()
  return head('Diagnostics', 'Severity grouping, source context, and actionable runtime issues.') +
    '<div class="filters"><select id="severity"><option value="">All severities</option><option value="error"' + selected('error') + '>Errors</option><option value="warning"' + selected('warning') + '>Warnings</option><option value="info"' + selected('info') + '>Info</option></select></div>' +
    '<div class="grid">' +
    metricCard('Errors', count('error')) +
    metricCard('Warnings', count('warning')) +
    metricCard('Info', count('info')) +
    metricCard('Visible', diagnostics.length) +
    '</div>' +
    '<div class="diagnostics-board"><div class="card"><h3>Grouped by source</h3>' + sourceGroups(diagnostics) + '</div><div class="stack">' +
    (diagnostics.length ? diagnostics.map(diagnosticCard).join('') : '<div class="empty">No diagnostics match the current filters.</div>') +
    '</div></div>'
}

function filteredDiagnostics(): Diagnostic[] {
  return ((state.data.diagnostics || []) as Diagnostic[]).filter((diagnostic) =>
    (!state.severity || diagnostic.level === state.severity) &&
    matches((diagnostic.level || '') + (diagnostic.code || '') + (diagnostic.message || '') + (diagnostic.source || '') + (diagnostic.project || '') + (diagnostic.package || '')),
  )
}

function diagnosticCard(diagnostic: Diagnostic): string {
  const context = diagnostic.project || diagnostic.package || diagnostic.source || 'runtime'
  return '<article class="card diagnostic-card ' + esc(diagnostic.level || '') + '">' +
    '<div class="card-head"><div>' + badge(diagnostic.level || 'info') + ' <strong>' + esc(diagnostic.code || 'diagnostic') + '</strong></div>' + copyButton((diagnostic.code || '') + ' ' + (diagnostic.message || '')) + '</div>' +
    '<p>' + esc(diagnostic.message || '') + '</p>' +
    '<dl class="kv"><dt>Context</dt><dd>' + esc(context) + '</dd><dt>Source</dt><dd>' + esc(diagnostic.source || '') + '</dd><dt>Suggested action</dt><dd>' + esc(diagnostic.suggestion || 'Inspect the related project/package/config entry.') + '</dd></dl>' +
    '</article>'
}

function sourceGroups(diagnostics: Diagnostic[]): string {
  const grouped = diagnostics.reduce<Record<string, number>>((acc, diagnostic) => {
    const key = diagnostic.source || diagnostic.project || diagnostic.package || 'runtime'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  return Object.keys(grouped).length
    ? '<div class="pill-grid">' + Object.entries(grouped).map(([key, value]) => '<span title="' + esc(key) + '">' + esc(key) + '<strong>' + value + '</strong></span>').join('') + '</div>'
    : '<div class="empty small">No grouped diagnostics.</div>'
}

function selected(level: string): string {
  return state.severity === level ? ' selected' : ''
}

function count(level: string): number {
  return ((state.data.diagnostics || []) as Diagnostic[]).filter((diagnostic) => diagnostic.level === level).length
}

function metricCard(label: string, value: unknown): string {
  return `<div class="card metric"><strong>${String(value ?? 0)}</strong><span>${label}</span></div>`
}

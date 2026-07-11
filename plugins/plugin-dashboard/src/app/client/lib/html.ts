export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char)
}

export function escAttr(value: unknown): string {
  return esc(value).replace(/"/g, '&quot;')
}

export function badge(value: unknown): string {
  const text = esc(value ?? '')
  return `<span class="badge ${text}">${text}</span>`
}

export function button(label: string, action: string, id?: string, disabled = false): string {
  return `<button class="control-button" data-action="${escAttr(action)}"${id ? ` data-id="${escAttr(id)}"` : ''}${disabled ? ' disabled' : ''}>${esc(label)}</button>`
}

export function copyButton(value: unknown): string {
  return `<button class="subtle-button" data-copy="${escAttr(value ?? '')}">Copy</button>`
}

export function link(href: string, label: unknown): string {
  return `<a data-link href="${routeHref(href)}">${esc(label)}</a>`
}

export function head(title: unknown, subtitle?: unknown): string {
  return `<div class="page-head"><div class="page-title"><h2>${esc(title)}</h2><p>${esc(subtitle || '')}</p></div></div>`
}

export function metric(label: unknown, value: unknown): string {
  return `<div class="card metric"><strong>${esc(value ?? 0)}</strong><span>${esc(label)}</span></div>`
}

export function cards(items: string[]): string {
  return items.length ? `<div class="grid">${items.join('')}</div>` : '<div class="empty">No matching items.</div>'
}

export function table(headers: string[], rows: unknown[][], trusted = false): string {
  return rows.length
    ? `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderCell(cell, trusted)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">No rows to display.</div>'
}

export function renderCell(cell: unknown, trusted = false): string {
  const value = String(cell ?? '')
  if (trusted || isInternalHtml(value)) return value
  return esc(value)
}

export function isInternalHtml(value: string): boolean {
  return value.startsWith('<span class="badge ') || value.startsWith('<a ') || value.startsWith('<pre>') || value.startsWith('<button ')
}

export function diagnosticsTable(rows: any[]): string {
  return table(['Severity', 'Code', 'Message', 'Source'], (rows || []).map((d) => [badge(d.level), d.code, d.message, d.source || d.project || '']), true)
}

export function kv(values: Record<string, unknown>): string {
  return `<dl class="kv">${Object.entries(values).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v ?? '')}</dd>`).join('')}</dl>`
}

export function list(items: unknown[]): string {
  return items.length ? `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>` : '<div class="empty">None</div>'
}

export function simplePage(title: string, description: string, body: string): string {
  return head(title, description) + body
}

export function basePath(): string {
  return window.__WSRT_BASE__ || '/__wsrt'
}

export function apiBase(): string {
  return basePath().replace(/\/$/, '') + '/api'
}

export function routeHref(route: string): string {
  return basePath().replace(/\/$/, '') + (route === '/' ? '/' : route)
}

export function normalizeRoute(pathname: string): string {
  const cleanBase = basePath().replace(/\/$/, '')
  const route = pathname.startsWith(cleanBase) ? pathname.slice(cleanBase.length) || '/' : pathname
  return route || '/'
}

export function isActive(href: string, current: string): boolean {
  return href === '/' ? current === '/' : current === href || current.startsWith(href + '/')
}

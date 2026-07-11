import { badge, copyButton, esc, head } from '../lib/html.js'
import { matches, state } from '../state.js'

type TimelineEntry = {
  id: number
  timestamp: string
  name: string
  summary: string
  detail?: unknown
}

export function timelinePage(): string {
  const entries = ((state.data.timeline || []) as TimelineEntry[]).slice().reverse()
  const names = [...new Set(entries.map((entry) => entry.name))].sort()
  const filtered = entries.filter((entry) =>
    (!state.eventType || entry.name === state.eventType) &&
    matches(entry.name + entry.summary + JSON.stringify(entry.detail || {})),
  )

  return head('Timeline', 'Runtime events, dashboard actions, and service/task activity.') +
    '<div class="filters"><select id="event-type"><option value="">All event types</option>' +
    names.map((name) => '<option value="' + esc(name) + '"' + (state.eventType === name ? ' selected' : '') + '>' + esc(name) + '</option>').join('') +
    '</select></div>' +
    '<div class="timeline-board">' +
    '<div class="card"><h3>Activity</h3>' +
    (filtered.length ? '<ol class="timeline">' + filtered.map(eventItem).join('') + '</ol>' : '<div class="empty">No events match the current filters.</div>') +
    '</div><div class="card"><h3>Groups</h3>' + groups(entries) + '</div></div>'
}

function eventItem(entry: TimelineEntry): string {
  const detail = entry.detail === undefined ? '' : '<details><summary>Details</summary><pre>' + esc(JSON.stringify(entry.detail, null, 2)) + '</pre></details>'
  return '<li class="' + eventClass(entry.name) + '">' +
    '<span>' + esc(relativeTime(entry.timestamp)) + '</span>' +
    '<strong>' + badge(entry.name) + '</strong>' +
    '<p>' + esc(entry.summary) + '</p>' +
    '<div class="inline-actions">' + copyButton(entry.summary) + '</div>' +
    detail +
    '</li>'
}

function groups(entries: TimelineEntry[]): string {
  const prefixes = entries.reduce<Record<string, number>>((acc, entry) => {
    const key = entry.name.split(':')[0] || 'runtime'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  return '<div class="pill-grid">' + Object.entries(prefixes).map(([key, value]) => '<span>' + esc(key) + '<strong>' + value + '</strong></span>').join('') + '</div>'
}

function eventClass(name: string): string {
  if (name.includes('failed') || name.includes('error')) return 'event-error'
  if (name.includes('stopping') || name.includes('warning')) return 'event-warning'
  if (name.includes('completed') || name.includes('started') || name.includes('health')) return 'event-ok'
  return ''
}

function relativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(delta)) return value
  if (delta < 60_000) return Math.max(0, Math.round(delta / 1000)) + 's ago'
  if (delta < 3_600_000) return Math.round(delta / 60_000) + 'm ago'
  return new Date(value).toLocaleString()
}

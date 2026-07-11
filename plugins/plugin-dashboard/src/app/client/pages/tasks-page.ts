import { badge, button, esc, head, table } from '../lib/html.js'
import { state } from '../state.js'

type RuntimeTask = {
  id: string
  title?: string
  description?: string
}

type TimelineEntry = {
  timestamp: string
  name: string
  summary?: string
  detail?: { id?: string }
}

export function tasksPage(): string {
  const tasks = (state.data.tasks || []) as RuntimeTask[]
  const timeline = (state.data.timeline || []) as TimelineEntry[]
  return head('Tasks', 'Registered runtime workflows, execution controls, and recent run history.') +
    '<div class="grid">' +
    metricCard('Registered', tasks.length) +
    metricCard('Started events', timeline.filter((event) => event.name === 'task:started').length) +
    metricCard('Completed events', timeline.filter((event) => event.name === 'task:completed').length) +
    metricCard('Failed events', timeline.filter((event) => event.name === 'task:failed').length) +
    '</div>' +
    '<div class="task-grid">' + (tasks.length ? tasks.map((task) => taskCard(task, timeline)).join('') : '<div class="empty">No runtime tasks are registered.</div>') + '</div>'
}

function taskCard(task: RuntimeTask, timeline: TimelineEntry[]): string {
  const history = timeline
    .filter((event) => event.name.startsWith('task:') && (event.detail?.id === task.id || event.summary?.includes(task.id)))
    .slice(-5)
    .reverse()

  return '<section class="card task-card">' +
    '<div class="card-head"><div><h3>' + esc(task.title || task.id) + '</h3><p class="muted">' + esc(task.id) + '</p></div>' + badge(lastStatus(history)) + '</div>' +
    '<p>' + esc(task.description || 'No description provided by the task definition.') + '</p>' +
    '<div class="control-row">' + button('Run', 'task:run', task.id) + '<button class="control-button" disabled title="Task cancellation is not exposed by RuntimeTaskRegistry yet.">Cancel</button></div>' +
    '<div class="card-section"><h4>Recent runs</h4>' +
    (history.length ? table(['Time', 'Event', 'Summary'], history.map((event) => [new Date(event.timestamp).toLocaleTimeString(), badge(event.name), event.summary || '']), true) : '<div class="empty small">No recorded runs yet.</div>') +
    '</div></section>'
}

function lastStatus(history: TimelineEntry[]): string {
  const latest = history[0]?.name
  if (latest === 'task:completed') return 'completed'
  if (latest === 'task:failed') return 'failed'
  if (latest === 'task:started') return 'running'
  return 'idle'
}

function metricCard(label: string, value: unknown): string {
  return `<div class="card metric"><strong>${String(value ?? 0)}</strong><span>${label}</span></div>`
}

import type { DashboardState } from './types.js'
import { normalizeRoute } from './lib/html.js'

export const navItems = [
  ['/', 'Overview'],
  ['/projects', 'Projects'],
  ['/packages', 'Packages'],
  ['/graph', 'Graph'],
  ['/aliases', 'Aliases'],
  ['/exports', 'Exports'],
  ['/diagnostics', 'Diagnostics'],
  ['/services', 'Services'],
  ['/tasks', 'Tasks'],
  ['/timeline', 'Timeline'],
  ['/config', 'Config'],
  ['/artifacts', 'Artifacts'],
  ['/mcp', 'MCP'],
  ['/plugins', 'Plugins'],
  ['/virtual', 'Virtual Imports'],
  ['/settings', 'Settings'],
] as const

export const state: DashboardState = {
  data: {},
  route: normalizeRoute(location.pathname),
  query: '',
  theme: initialTheme(),
  connected: false,
  liveSignature: '',
  refreshTimer: 0,
  graph: { selected: null, filter: '', scale: 1, x: 0, y: 0 },
}

document.documentElement.dataset.theme = state.theme

export function initialTheme(): 'dark' | 'light' {
  const stored = localStorage.getItem('wsrt.theme')
  if (stored === 'dark' || stored === 'light') return stored
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function toggleTheme(): void {
  state.theme = state.theme === 'dark' ? 'light' : 'dark'
  localStorage.setItem('wsrt.theme', state.theme)
  document.documentElement.dataset.theme = state.theme
  window.dispatchEvent(new CustomEvent('wsrt:theme-changed'))
}

export function matches(value: unknown): boolean {
  return !state.query || String(value).toLowerCase().includes(state.query)
}

export function filter<T>(items: T[], project: (item: T) => string): T[] {
  return items.filter((item) => matches(project(item)))
}

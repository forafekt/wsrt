import { state } from './state.js'
import { normalizeRoute } from './lib/html.js'
import { overviewPage } from './pages/overview-page.js'
import { projectsPage, projectPage } from './pages/projects-page.js'
import { packagesPage, packagePage } from './pages/packages-page.js'
import { graphPage } from './pages/graph-page.js'
import { aliasesPage } from './pages/aliases-page.js'
import { exportsPage } from './pages/exports-page.js'
import { diagnosticsPage } from './pages/diagnostics-page.js'
import { servicesPage } from './pages/services-page.js'
import { tasksPage } from './pages/tasks-page.js'
import { timelinePage } from './pages/timeline-page.js'
import { configPage } from './pages/config-page.js'
import { mcpPage } from './pages/mcp-page.js'
import { pluginsPage } from './pages/plugins-page.js'
import { virtualPage } from './pages/virtual.js'
import { settingsPage } from './pages/settings-page.js'
import { artifactsPage } from './pages/artifacts-page.js'
import { pluginPage } from './pages/plugin-page.js'
import { head } from './lib/html.js'

export function renderRoute(): string {
  const route = state.route
  if (route === '/') return overviewPage()
  if (route === '/projects') return projectsPage()
  if (route.startsWith('/projects/')) return projectPage(decodeURIComponent(route.slice('/projects/'.length)))
  if (route === '/packages') return packagesPage()
  if (route.startsWith('/packages/')) return packagePage(decodeURIComponent(route.slice('/packages/'.length)))
  if (route === '/graph') return graphPage()
  if (route === '/aliases') return aliasesPage()
  if (route === '/exports') return exportsPage()
  if (route === '/diagnostics') return diagnosticsPage()
  if (route === '/services') return servicesPage()
  if (route === '/tasks') return tasksPage()
  if (route === '/timeline') return timelinePage()
  if (route === '/config') return configPage()
  if (route === '/artifacts') return artifactsPage()
  if (route === '/mcp') return mcpPage()
  if (route === '/plugins') return pluginsPage()
  if (route === '/virtual') return virtualPage()
  if (route === '/settings') return settingsPage()
  if (route.startsWith('/plugin/')) return pluginPage(decodeURIComponent(route.slice('/plugin/'.length)))
  return `${head('Not found', `No dashboard route exists for ${route}`)}<div class="empty">Use the sidebar to choose a dashboard page.</div>`
}

export function navigate(event: Event): void {
  event.preventDefault()
  go((event.currentTarget as HTMLAnchorElement).getAttribute('href') || '/')
}

export function go(href: string): void {
  history.pushState(null, '', href)
  state.route = normalizeRoute(location.pathname)
  window.dispatchEvent(new CustomEvent('wsrt:route-changed'))
}

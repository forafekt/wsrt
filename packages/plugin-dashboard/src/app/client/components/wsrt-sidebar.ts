import { navigate } from '../router.js'
import { isActive, routeHref } from '../lib/html.js'
import { navItems, state } from '../state.js'

type PluginNavPage = {
  id: string
  title?: string
}

export class WSRTSidebar extends HTMLElement {
  connectedCallback(): void {
    this.render()
    this.addEventListener('wsrt:render', () => this.render())
  }

  render(): void {
    const overview = state.data.overview
    const counts: Record<string, unknown> = {
      '/projects': overview?.counts.projects,
      '/packages': overview?.counts.packages,
      '/services': overview?.counts.services,
      '/diagnostics': overview?.counts.diagnostics,
      '/artifacts': overview?.status.artifacts,
      '/plugins': overview?.status.plugins,
      '/virtual': overview?.status.virtualImports,
    }
    const environment = overview?.status.environment || 'development'
    const pluginNav = ((state.data.pluginPages || []) as PluginNavPage[]).map((page) => [
      `/plugin/${encodeURIComponent(page.id)}`,
      page.title || page.id,
    ] as const)
    const nav = [...navItems, ...pluginNav].map(([href, label]) => {
      const count = counts[href]
      return `<a class="${isActive(href, state.route) ? 'active' : ''}" href="${routeHref(href)}" data-link><span>${label}</span>${count === undefined ? '' : `<small>${count}</small>`}</a>`
    }).join('')
    const connectionClass = state.connected ? 'ok' : 'warning'
    const connectionText = state.connected ? 'Live updates connected' : 'Live updates pending'

    this.className = 'sidebar'
    this.innerHTML = `<div class="brand"><div class="brand-mark">R</div><div><h1>Workspace Runtime</h1><span>${environment} profile</span></div></div><nav class="nav">${nav}</nav><div class="sidebar-footer"><div class="connection"><span class="dot ${connectionClass}"></span><span>${connectionText}</span></div><span>${overview?.root || ''}</span></div>`

    this.querySelectorAll('[data-link]').forEach((link) => {
      link.addEventListener('click', navigate)
    })
  }
}

customElements.define('wsrt-sidebar', WSRTSidebar)

import { connectEvents, refreshAll } from '../api.js'
import { renderRoute } from '../router.js'
import { state } from '../state.js'
import { esc } from '../lib/html.js'

export class WSRTApp extends HTMLElement {
  private cleanup: Array<() => void> = []

  connectedCallback(): void {
    this.start().catch((error) => {
      this.renderError(error)
    })
  }

  disconnectedCallback(): void {
    for (const dispose of this.cleanup.splice(0)) dispose()
  }

  async start(): Promise<void> {
    this.renderShell()
    await refreshAll()
    this.cleanup.push(connectEvents(() => this.render()))
    this.render()

    const onPopstate = () => {
      state.route = location.pathname
      this.render()
    }
    const onRouteChanged = () => this.render()
    const onDataChanged = () => this.render()
    window.addEventListener('popstate', onPopstate)
    window.addEventListener('wsrt:route-changed', onRouteChanged)
    window.addEventListener('wsrt:data-changed', onDataChanged)
    this.cleanup.push(
      () => window.removeEventListener('popstate', onPopstate),
      () => window.removeEventListener('wsrt:route-changed', onRouteChanged),
      () => window.removeEventListener('wsrt:data-changed', onDataChanged),
    )
  }

  renderShell(): void {
    this.className = 'shell'
    this.innerHTML = '<wsrt-sidebar></wsrt-sidebar><main class="main"><wsrt-topbar></wsrt-topbar><div class="content" id="content"></div></main>'
  }

  render(): void {
    this.querySelector('wsrt-sidebar')?.dispatchEvent(new CustomEvent('wsrt:render', { bubbles: false }))
    const content = this.querySelector('#content')
    if (!content) return

    try {
      content.innerHTML = renderRoute()
      this.bindPage(content)
    } catch (error: any) {
      content.innerHTML = '<div class="card error-box"><pre>' + esc(error.stack || String(error)) + '</pre></div>'
    }
  }

  bindPage(root: Element): void {
    root.querySelectorAll('[data-go]').forEach((card) => card.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('wsrt:go', { detail: (card as HTMLElement).dataset.go }))
    }))

    const severity = root.querySelector<HTMLSelectElement>('#severity')
    if (severity) severity.addEventListener('change', () => {
      state.severity = severity.value
      this.render()
    })

    const eventType = root.querySelector<HTMLSelectElement>('#event-type')
    if (eventType) eventType.addEventListener('change', () => {
      state.eventType = eventType.value
      this.render()
    })

    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action
        if (!action) return
        window.dispatchEvent(
          new CustomEvent('wsrt:action', {
            detail: {
              action,
              id: button.dataset.id,
              value: button.dataset.value,
            },
          }),
        )
      })
    })

    root.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
      button.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(button.dataset.copy || '')
        button.textContent = 'Copied'
        window.setTimeout(() => { button.textContent = 'Copy' }, 900)
      })
    })

    const settingsTheme = root.querySelector('#settings-theme')
    if (settingsTheme) settingsTheme.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('wsrt:toggle-theme'))
    })
  }

  renderError(error: any): void {
    this.className = 'loading-shell'
    this.innerHTML = '<div class="card error-box"><pre>' + esc(error.stack || String(error)) + '</pre></div>'
  }
}

customElements.define('wsrt-app', WSRTApp)

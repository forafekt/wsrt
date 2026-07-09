import { refreshAll } from '../api.js'
import { toggleTheme, state } from '../state.js'

export class WSRTTopbar extends HTMLElement {
  private cleanup: Array<() => void> = []

  connectedCallback(): void {
    this.className = 'topbar'
    this.innerHTML = '<div class="search"><input id="command-search" placeholder="Search projects, packages, diagnostics" aria-label="Search"></div><div class="actions"><button class="icon-button" id="refresh" title="Refresh">↻</button><button class="icon-button" id="theme" title="Toggle theme">◐</button></div>'

    this.querySelector<HTMLInputElement>('#command-search')?.addEventListener('input', (event) => {
      state.query = (event.target as HTMLInputElement).value.toLowerCase()
      window.dispatchEvent(new CustomEvent('wsrt:data-changed'))
    })

    this.querySelector('#refresh')?.addEventListener('click', async () => {
      await refreshAll()
      window.dispatchEvent(new CustomEvent('wsrt:data-changed'))
    })

    this.querySelector('#theme')?.addEventListener('click', toggleTheme)
    window.addEventListener('wsrt:toggle-theme', toggleTheme)
    this.cleanup.push(() => window.removeEventListener('wsrt:toggle-theme', toggleTheme))

    const onKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        this.querySelector<HTMLInputElement>('#command-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKeydown)
    this.cleanup.push(() => window.removeEventListener('keydown', onKeydown))
  }

  disconnectedCallback(): void {
    for (const dispose of this.cleanup.splice(0)) dispose()
  }
}

customElements.define('wsrt-topbar', WSRTTopbar)

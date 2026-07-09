import { head } from '../lib/html.js'

export function settingsPage(): string {
  return head('Settings', 'Dashboard preferences.') + '<div class="card"><h3>Appearance</h3><p class="muted">Theme preference is persisted locally and falls back to system preference.</p><button class="icon-button" id="settings-theme">◐</button></div>'
}

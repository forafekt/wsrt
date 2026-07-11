import { colors } from '@wsrt/ansi-tools'
import type { State } from '../core/mod.ts'

export const unicode = isUnicodeSupported()
export const isCI = (): boolean => Deno.env.get('CI') === 'true'
export const isTTY = (): boolean => {
  return Deno.stdout.isTerminal()
}
export const unicodeOr = (c: string, fallback: string) => (unicode ? c : fallback)
export const S_STEP_ACTIVE = unicodeOr('◆', '*')
export const S_STEP_CANCEL = unicodeOr('■', 'x')
export const S_STEP_ERROR = unicodeOr('▲', 'x')
export const S_STEP_SUBMIT = unicodeOr('◇', 'o')

export const S_BAR_START = unicodeOr('┌', 'T')
export const S_BAR = unicodeOr('│', '|')
export const S_BAR_END = unicodeOr('└', '—')
export const S_BAR_START_RIGHT = unicodeOr('┐', 'T')
export const S_BAR_END_RIGHT = unicodeOr('┘', '—')

export const S_RADIO_ACTIVE = unicodeOr('●', '>')
export const S_RADIO_INACTIVE = unicodeOr('○', ' ')
export const S_CHECKBOX_ACTIVE = unicodeOr('◻', '[•]')
export const S_CHECKBOX_SELECTED = unicodeOr('◼', '[+]')
export const S_CHECKBOX_INACTIVE = unicodeOr('◻', '[ ]')
export const S_PASSWORD_MASK = unicodeOr('▪', '•')

export const S_BAR_H = unicodeOr('─', '-')
export const S_CORNER_TOP_RIGHT = unicodeOr('╮', '+')
export const S_CONNECT_LEFT = unicodeOr('├', '+')
export const S_CORNER_BOTTOM_RIGHT = unicodeOr('╯', '+')
export const S_CORNER_BOTTOM_LEFT = unicodeOr('╰', '+')
export const S_CORNER_TOP_LEFT = unicodeOr('╭', '+')

export const S_INFO = unicodeOr('●', '•')
export const S_SUCCESS = unicodeOr('◆', '*')
export const S_WARN = unicodeOr('▲', '!')
export const S_ERROR = unicodeOr('■', 'x')

export const symbol = (state: State) => {
  switch (state) {
    case 'initial':
    case 'active':
      return colors.cyan(S_STEP_ACTIVE)
    case 'cancel':
      return colors.red(S_STEP_CANCEL)
    case 'error':
      return colors.yellow(S_STEP_ERROR)
    case 'submit':
      return colors.green(S_STEP_SUBMIT)
  }
}

export const symbolBar = (state: State) => {
  switch (state) {
    case 'initial':
    case 'active':
      return colors.cyan(S_BAR)
    case 'cancel':
      return colors.red(S_BAR)
    case 'error':
      return colors.yellow(S_BAR)
    case 'submit':
      return colors.green(S_BAR)
  }
}

export interface CommonOptions {
  input?: typeof Deno.stdin
  output?: typeof Deno.stdout
  signal?: AbortSignal
  withGuide?: boolean
}

export function isUnicodeSupported() {
  const TERM = Deno.env.get('TERM')
  const TERM_PROGRAM = Deno.env.get('TERM_PROGRAM')
  const WT_SESSION = Deno.env.get('WT_SESSION')
  const TERMINUS_SUBLIME = Deno.env.get('TERMINUS_SUBLIME')
  const ConEmuTask = Deno.env.get('ConEmuTask')
  const TERMINAL_EMULATOR = Deno.env.get('TERMINAL_EMULATOR')

  if (Deno.build.os !== 'windows') {
    return TERM !== 'linux' // Linux console (kernel)
  }

  return (
    Boolean(WT_SESSION) || // Windows Terminal
    Boolean(TERMINUS_SUBLIME) || // Terminus (<0.2.27)
    ConEmuTask === '{cmd::Cmder}' || // ConEmu and cmder
    TERM_PROGRAM === 'Terminus-Sublime' ||
    TERM_PROGRAM === 'vscode' ||
    TERM === 'xterm-256color' ||
    TERM === 'alacritty' ||
    TERM === 'rxvt-unicode' ||
    TERM === 'rxvt-unicode-256color' ||
    TERMINAL_EMULATOR === 'JetBrains-JediTerm'
  )
}

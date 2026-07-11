import { colors } from '@wsrt/ansi-tools'
import { settings } from '../core/mod.ts'
import {
  type CommonOptions,
  S_BAR,
  S_ERROR,
  S_INFO,
  S_STEP_SUBMIT,
  S_SUCCESS,
  S_WARN,
} from './common.ts'

const encoder = new TextEncoder()

export interface LogMessageOptions extends CommonOptions {
  symbol?: string
  spacing?: number
  secondarySymbol?: string
}

export const log = {
  message: (
    message: string | string[] = [],
    {
      symbol = colors.gray(S_BAR),
      secondarySymbol = colors.gray(S_BAR),
      output = Deno.stdout,
      spacing = 1,
      withGuide,
    }: LogMessageOptions = {},
  ) => {
    const parts: string[] = []
    const hasGuide = (withGuide ?? settings.withGuide) !== false
    const spacingString = !hasGuide ? '' : secondarySymbol
    const prefix = !hasGuide ? '' : `${symbol}  `
    const secondaryPrefix = !hasGuide ? '' : `${secondarySymbol}  `

    for (let i = 0; i < spacing; i++) {
      parts.push(spacingString)
    }

    const messageParts = Array.isArray(message) ? message : message.split('\n')
    if (messageParts.length > 0) {
      const [firstLine, ...lines] = messageParts
      if (firstLine.length > 0) {
        parts.push(`${prefix}${firstLine}`)
      } else {
        parts.push(hasGuide ? symbol : '')
      }
      for (const ln of lines) {
        if (ln.length > 0) {
          parts.push(`${secondaryPrefix}${ln}`)
        } else {
          parts.push(hasGuide ? secondarySymbol : '')
        }
      }
    }
    output.writeSync(encoder.encode(`${parts.join('\n')}\n`))
  },
  info: (message: string, opts?: LogMessageOptions) => {
    log.message(message, { ...opts, symbol: colors.blue(S_INFO) })
  },
  success: (message: string, opts?: LogMessageOptions) => {
    log.message(message, { ...opts, symbol: colors.green(S_SUCCESS) })
  },
  step: (message: string, opts?: LogMessageOptions) => {
    log.message(message, { ...opts, symbol: colors.green(S_STEP_SUBMIT) })
  },
  warn: (message: string, opts?: LogMessageOptions) => {
    log.message(message, { ...opts, symbol: colors.yellow(S_WARN) })
  },
  /** alias for `log.warn()`. */
  warning: (message: string, opts?: LogMessageOptions) => {
    log.warn(message, opts)
  },
  error: (message: string, opts?: LogMessageOptions) => {
    log.message(message, { ...opts, symbol: colors.red(S_ERROR) })
  },
}

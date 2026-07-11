import { colors } from '@wsrt/ansi-tools'
import { settings, TextController } from '../core/mod.ts'
import { type CommonOptions, S_BAR, S_BAR_END, symbol } from './common.ts'

export interface TextOptions extends CommonOptions {
  message: string
  placeholder?: string
  defaultValue?: string
  initialValue?: string
  validate?: (value: string | undefined) => string | Error | undefined
}

export const text = (opts: TextOptions) => {
  return new TextController({
    validate: opts.validate,
    placeholder: opts.placeholder,
    defaultValue: opts.defaultValue,
    initialValue: opts.initialValue,
    output: opts.output,
    signal: opts.signal,
    input: opts.input,
    render() {
      const hasGuide = (opts?.withGuide ?? settings.withGuide) !== false
      const titlePrefix = `${hasGuide ? `${colors.gray(S_BAR)}\n` : ''}${symbol(this.state)}  `
      const title = `${titlePrefix}${opts.message}\n`
      const placeholder = opts.placeholder
        ? colors.inverse(opts.placeholder[0]) + colors.dim(opts.placeholder.slice(1))
        : colors.inverse(colors.hidden('_'))
      const userInput = !this.userInput ? placeholder : this.userInputWithCursor
      const value = this.value ?? ''

      switch (this.state) {
        case 'error': {
          const errorText = this.error ? `  ${colors.yellow(this.error)}` : ''
          const errorPrefix = hasGuide ? `${colors.yellow(S_BAR)}  ` : ''
          const errorPrefixEnd = hasGuide ? colors.yellow(S_BAR_END) : ''
          return `${title.trim()}\n${errorPrefix}${userInput}\n${errorPrefixEnd}${errorText}\n`
        }
        case 'submit': {
          const valueText = value ? `  ${colors.dim(value)}` : ''
          const submitPrefix = hasGuide ? colors.gray(S_BAR) : ''
          return `${title}${submitPrefix}${valueText}`
        }
        case 'cancel': {
          const valueText = value ? `  ${colors.strikethrough(colors.dim(value))}` : ''
          const cancelPrefix = hasGuide ? colors.gray(S_BAR) : ''
          return `${title}${cancelPrefix}${valueText}${value.trim() ? `\n${cancelPrefix}` : ''}`
        }
        default: {
          const defaultPrefix = hasGuide ? `${colors.cyan(S_BAR)}  ` : ''
          const defaultPrefixEnd = hasGuide ? colors.cyan(S_BAR_END) : ''
          return `${title}${defaultPrefix}${userInput}\n${defaultPrefixEnd}\n`
        }
      }
    },
  }).prompt() as Promise<string | symbol>
}

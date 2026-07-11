import { colors } from '@wsrt/ansi-tools'
import { ConfirmController } from '../core/mod.ts'
import {
  type CommonOptions,
  S_BAR,
  S_BAR_END,
  S_RADIO_ACTIVE,
  S_RADIO_INACTIVE,
  symbol,
} from './common.ts'

export interface ConfirmOptions extends CommonOptions {
  message: string
  active?: string
  inactive?: string
  initialValue?: boolean
}
export const confirm = (opts: ConfirmOptions) => {
  const active = opts.active ?? 'Yes'
  const inactive = opts.inactive ?? 'No'
  return new ConfirmController({
    active,
    inactive,
    signal: opts.signal,
    input: opts.input,
    output: opts.output,
    initialValue: opts.initialValue ?? true,
    render() {
      const title = `${colors.gray(S_BAR)}\n${symbol(this.state)}  ${opts.message}\n`
      const value = this.value ? active : inactive

      switch (this.state) {
        case 'submit':
          return `${title}${colors.gray(S_BAR)}  ${colors.dim(value)}`
        case 'cancel':
          return `${title}${colors.gray(S_BAR)}  ${colors.strikethrough(
            colors.dim(value),
          )}\n${colors.gray(S_BAR)}`
        default: {
          return `${title}${colors.cyan(S_BAR)}  ${
            this.value
              ? `${colors.green(S_RADIO_ACTIVE)} ${active}`
              : `${colors.dim(S_RADIO_INACTIVE)} ${colors.dim(active)}`
          } ${colors.dim('/')} ${
            !this.value
              ? `${colors.green(S_RADIO_ACTIVE)} ${inactive}`
              : `${colors.dim(S_RADIO_INACTIVE)} ${colors.dim(inactive)}`
          }\n${colors.cyan(S_BAR_END)}\n`
        }
      }
    },
  }).prompt() as Promise<boolean | symbol>
}

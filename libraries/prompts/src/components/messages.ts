import { colors } from '@wsrt/ansi-tools'
import { type CommonOptions, S_BAR, S_BAR_END, S_BAR_START } from './common.ts'

const encoder = new TextEncoder()

export const cancel = (message = '', opts?: CommonOptions) => {
  const output = opts?.output ?? Deno.stdout
  output.writeSync(encoder.encode(`${colors.gray(S_BAR_END)}  ${colors.red(message)}\n\n`))
}

export const intro = (title = '', opts?: CommonOptions) => {
  const output = opts?.output ?? Deno.stdout
  output.writeSync(encoder.encode(`${colors.gray(S_BAR_START)}  ${title}\n`))
}

export const outro = (message = '', opts?: CommonOptions) => {
  const output = opts?.output ?? Deno.stdout
  output.writeSync(
    encoder.encode(`${colors.gray(S_BAR)}\n${colors.gray(S_BAR_END)}  ${message}\n\n`),
  )
}

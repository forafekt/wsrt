import { cursor as ansiCursor } from '@wsrt/ansi-tools'
import Prompt, { type PromptOptions } from './prompt.ts'

const encoder = new TextEncoder()

export interface ConfirmOptions extends PromptOptions<boolean, ConfirmController> {
  active: string
  inactive: string
  initialValue?: boolean
}

export default class ConfirmController extends Prompt<boolean> {
  get cursor() {
    return this.value ? 0 : 1
  }

  private get _value() {
    return this.cursor === 0
  }

  constructor(opts: ConfirmOptions) {
    super(opts, false)
    this.value = !!opts.initialValue

    this.on('userInput', () => {
      this.value = this._value
    })

    this.on('confirm', (confirm) => {
      this.output.writeSync(encoder.encode(ansiCursor.move(0, -1)))
      this.value = confirm
      this.state = 'submit'
      this.close()
    })

    this.on('cursor', () => {
      this.value = !this.value
    })
  }
}

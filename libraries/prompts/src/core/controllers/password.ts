import { colors } from '@wsrt/ansi-tools'
import Prompt, { type PromptOptions } from './prompt.ts'

export interface PasswordOptions extends PromptOptions<string, PasswordController> {
  mask?: string
}
export default class PasswordController extends Prompt<string> {
  private _mask = '•'
  get cursor() {
    return this._cursor
  }
  get masked() {
    return this.userInput.replaceAll(/./g, this._mask)
  }
  get userInputWithCursor() {
    if (this.state === 'submit' || this.state === 'cancel') {
      return this.masked
    }
    const userInput = this.userInput
    if (this.cursor >= userInput.length) {
      return `${this.masked}${colors.inverse(colors.hidden('_'))}`
    }
    const masked = this.masked
    const s1 = masked.slice(0, this.cursor)
    const s2 = masked.slice(this.cursor)
    return `${s1}${colors.inverse(s2[0])}${s2.slice(1)}`
  }
  clear() {
    this._clearUserInput()
  }
  constructor({ mask, ...opts }: PasswordOptions) {
    super(opts)
    this._mask = mask ?? '•'
    this.on('userInput', (input) => {
      this._setValue(input)
    })
  }
}

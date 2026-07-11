import { EventEmitter } from 'node:events'
import type { WorkerPoolEventMap } from './types.js'

export class TypedEventEmitter<Events extends Record<string, unknown[]>> {
  private readonly emitter = new EventEmitter()

  on<Event extends keyof Events & string>(
    event: Event,
    listener: (...args: Events[Event]) => void,
  ): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  off<Event extends keyof Events & string>(
    event: Event,
    listener: (...args: Events[Event]) => void,
  ): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
    return this
  }

  once<Event extends keyof Events & string>(
    event: Event,
    listener: (...args: Events[Event]) => void,
  ): this {
    this.emitter.once(event, listener as (...args: unknown[]) => void)
    return this
  }

  emit<Event extends keyof Events & string>(event: Event, ...args: Events[Event]): boolean {
    return this.emitter.emit(event, ...args)
  }
}

export type WorkerPoolEventEmitter = TypedEventEmitter<WorkerPoolEventMap>

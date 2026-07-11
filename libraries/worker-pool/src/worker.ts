import { parentPort } from 'node:worker_threads'
import { JobCancelledError, WorkerTaskNotFoundError } from './errors.js'
import { serializeError } from './serializer.js'
import type { WorkerTaskContext, WorkerTaskRegistry } from './types.js'
import type { ParentToWorkerMessage } from './worker-protocol.js'

export function defineWorkerTasks(tasks: WorkerTaskRegistry): void {
  if (!parentPort) {
    throw new Error('defineWorkerTasks() must be called inside a worker_threads Worker')
  }

  const port = parentPort
  const controllers = new Map<number, AbortController>()
  const heartbeat = setInterval(() => port.postMessage({ type: 'heartbeat' }), 1_000)
  heartbeat.unref()

  port.on('message', async (message: ParentToWorkerMessage) => {
    if (message.type === 'shutdown') {
      clearInterval(heartbeat)
      process.exit(0)
    }

    if (message.type === 'cancel') {
      controllers.get(message.jobId)?.abort()
      return
    }

    const controller = new AbortController()
    controllers.set(message.jobId, controller)

    const context: WorkerTaskContext = {
      signal: controller.signal,
      jobId: message.jobId,
      attempt: message.attempt,
      throwIfAborted() {
        if (controller.signal.aborted) {
          throw new JobCancelledError()
        }
      },
    }

    try {
      const task = tasks[message.taskName]
      if (!task) {
        throw new WorkerTaskNotFoundError(message.taskName)
      }
      context.throwIfAborted()
      const result = await task(message.payload, context)
      context.throwIfAborted()
      port.postMessage({ type: 'result', jobId: message.jobId, result })
    } catch (error) {
      port.postMessage({ type: 'error', jobId: message.jobId, error: serializeError(error) })
    } finally {
      controllers.delete(message.jobId)
    }
  })

  port.postMessage({ type: 'ready' })
}

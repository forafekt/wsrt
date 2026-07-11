import type { SerializedError } from './serializer.js'

export type ParentToWorkerMessage =
  | {
      type: 'run'
      jobId: number
      taskName: string
      payload: unknown
      attempt: number
    }
  | {
      type: 'cancel'
      jobId: number
    }
  | {
      type: 'shutdown'
    }

export type WorkerToParentMessage =
  | {
      type: 'ready'
    }
  | {
      type: 'heartbeat'
    }
  | {
      type: 'result'
      jobId: number
      result: unknown
    }
  | {
      type: 'error'
      jobId: number
      error: SerializedError
    }

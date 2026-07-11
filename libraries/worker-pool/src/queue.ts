import { QueueFullError } from './errors.js'
import type { JobOptions, JobSnapshot, JobState, QueueFullPolicy, TaskDefaults } from './types.js'

export type QueuedJob = {
  id: number
  taskName: string
  payload: unknown
  state: JobState
  attempt: number
  maxAttempts: number
  priority: number
  queuedAt: number
  startedAt?: number
  completedAt?: number
  options: Required<Pick<JobOptions, 'priority'>> & Omit<JobOptions, 'priority'>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  abortCleanup?: () => void
}

export type EnqueueResult = {
  accepted: boolean
  dropped?: QueuedJob
  error?: Error
}

export class PriorityJobQueue {
  private readonly jobs: QueuedJob[] = []
  private sequence = 0
  private readonly sequenceById = new Map<number, number>()

  constructor(
    private readonly maxQueueSize: number,
    private readonly queueFullPolicy: QueueFullPolicy,
  ) {}

  get size(): number {
    return this.jobs.length
  }

  enqueue(job: QueuedJob): EnqueueResult {
    if (this.jobs.length >= this.maxQueueSize) {
      if (this.queueFullPolicy === 'reject') {
        return { accepted: false, error: new QueueFullError() }
      }

      if (this.queueFullPolicy === 'drop-newest') {
        return { accepted: false, dropped: job }
      }

      const dropped = this.removeOldest()
      this.insert(job)
      return { accepted: true, dropped }
    }

    this.insert(job)
    return { accepted: true }
  }

  dequeueReady(
    activeByTask: Map<string, number>,
    limits: Map<string, number>,
  ): QueuedJob | undefined {
    for (let index = 0; index < this.jobs.length; index += 1) {
      const job = this.jobs[index]
      if (!job) continue
      const limit = limits.get(job.taskName)
      if (limit !== undefined && (activeByTask.get(job.taskName) ?? 0) >= limit) continue
      this.jobs.splice(index, 1)
      this.sequenceById.delete(job.id)
      return job
    }
    return undefined
  }

  remove(jobId: number): QueuedJob | undefined {
    const index = this.jobs.findIndex((job) => job.id === jobId)
    if (index === -1) return undefined
    const [job] = this.jobs.splice(index, 1)
    this.sequenceById.delete(jobId)
    return job
  }

  drain(): QueuedJob[] {
    const jobs = this.jobs.splice(0)
    this.sequenceById.clear()
    return jobs
  }

  snapshot(): JobSnapshot[] {
    return this.jobs.map(snapshotJob)
  }

  private removeOldest(): QueuedJob | undefined {
    let oldestIndex = -1
    let oldestSequence = Number.POSITIVE_INFINITY
    for (let index = 0; index < this.jobs.length; index += 1) {
      const sequence = this.sequenceById.get(this.jobs[index]?.id ?? -1) ?? Number.POSITIVE_INFINITY
      if (sequence < oldestSequence) {
        oldestSequence = sequence
        oldestIndex = index
      }
    }
    if (oldestIndex === -1) return undefined
    const [job] = this.jobs.splice(oldestIndex, 1)
    if (job) this.sequenceById.delete(job.id)
    return job
  }

  private insert(job: QueuedJob): void {
    this.sequenceById.set(job.id, this.sequence++)
    this.jobs.push(job)
    this.jobs.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return (this.sequenceById.get(a.id) ?? 0) - (this.sequenceById.get(b.id) ?? 0)
    })
  }
}

export function snapshotJob(job: QueuedJob): JobSnapshot {
  return {
    id: job.id,
    taskName: job.taskName,
    state: job.state,
    attempt: job.attempt,
    maxAttempts: job.maxAttempts,
    priority: job.priority,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  }
}

export function mergeJobOptions(
  defaults: TaskDefaults | undefined,
  poolTimeoutMs: number | undefined,
  options: JobOptions,
): JobOptions {
  return {
    timeoutMs: options.timeoutMs ?? defaults?.timeoutMs ?? poolTimeoutMs,
    priority: options.priority ?? defaults?.priority ?? 0,
    retries: options.retries ?? defaults?.retries ?? 0,
    delayMs: options.delayMs ?? defaults?.delayMs ?? 0,
    exponentialBackoff: options.exponentialBackoff ?? defaults?.exponentialBackoff ?? false,
    maxDelayMs: options.maxDelayMs ?? defaults?.maxDelayMs,
    signal: options.signal,
    transferList: options.transferList,
  }
}

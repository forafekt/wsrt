import type { TransferListItem } from 'node:worker_threads'

export type TaskDefinition<Input = unknown, Output = unknown> = {
  input: Input
  output: Output
}

export type TaskMap = Record<string, TaskDefinition>
export type TaskName<Tasks extends TaskMap> = Extract<keyof Tasks, string>
export type TaskInput<Tasks extends TaskMap, Name extends TaskName<Tasks>> = Tasks[Name]['input']
export type TaskOutput<Tasks extends TaskMap, Name extends TaskName<Tasks>> = Tasks[Name]['output']

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'

export type QueueFullPolicy = 'reject' | 'drop-oldest' | 'drop-newest'
export type ShutdownMode = 'graceful' | 'drain' | 'force'

export type RetryOptions = {
  retries?: number
  delayMs?: number
  exponentialBackoff?: boolean
  maxDelayMs?: number
}

export type JobOptions = RetryOptions & {
  timeoutMs?: number
  priority?: number
  signal?: AbortSignal
  transferList?: TransferListItem[]
}

export type TaskDefaults = RetryOptions & {
  timeoutMs?: number
  priority?: number
  concurrency?: number
}

export type WorkerPoolLogger = {
  debug?: (message: string, fields?: Record<string, unknown>) => void
  info?: (message: string, fields?: Record<string, unknown>) => void
  warn?: (message: string, fields?: Record<string, unknown>) => void
  error?: (message: string, fields?: Record<string, unknown>) => void
}

export type WorkerPoolOptions<Tasks extends TaskMap = TaskMap> = {
  worker: URL | string
  workers?: number
  minWorkers?: number
  maxWorkers?: number
  maxQueueSize?: number
  queueFullPolicy?: QueueFullPolicy
  defaultTimeoutMs?: number
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  taskDefaults?: Partial<Record<TaskName<Tasks>, TaskDefaults>>
  logger?: WorkerPoolLogger
}

export type JobSnapshot<Name extends string = string> = {
  id: number
  taskName: Name
  state: JobState
  attempt: number
  maxAttempts: number
  priority: number
  queuedAt: number
  startedAt?: number
  completedAt?: number
}

export type WorkerSnapshot = {
  id: number
  ready: boolean
  busy: boolean
  currentJobId?: number
}

export type WorkerPoolMetrics = {
  queueSize: number
  activeWorkers: number
  idleWorkers: number
  completedJobs: number
  failedJobs: number
  cancelledJobs: number
  timedOutJobs: number
  retriedJobs: number
  workerRestarts: number
  averageWaitMs: number
  averageRunMs: number
}

export type WorkerTaskContext = {
  signal: AbortSignal
  jobId: number
  attempt: number
  throwIfAborted: () => void
}

export type WorkerTaskHandler<Input = unknown, Output = unknown> = (
  input: Input,
  context: WorkerTaskContext,
) => Output | Promise<Output>

export type WorkerTaskRegistry = Record<string, WorkerTaskHandler>

export interface WorkerPool<Tasks extends TaskMap = TaskMap> {
  ready(): Promise<void>
  run<Name extends TaskName<Tasks>>(
    taskName: Name,
    payload: TaskInput<Tasks, Name>,
    options?: JobOptions,
  ): Promise<TaskOutput<Tasks, Name>>
  metrics(): WorkerPoolMetrics
  shutdown(mode?: ShutdownMode): Promise<void>
  on<Event extends keyof WorkerPoolEventMap>(
    event: Event,
    listener: (...args: WorkerPoolEventMap[Event]) => void,
  ): this
  off<Event extends keyof WorkerPoolEventMap>(
    event: Event,
    listener: (...args: WorkerPoolEventMap[Event]) => void,
  ): this
}

export type WorkerPoolEventMap = {
  'job:queued': [JobSnapshot]
  'job:started': [JobSnapshot]
  'job:completed': [JobSnapshot, unknown]
  'job:failed': [JobSnapshot, Error]
  'job:cancelled': [JobSnapshot]
  'job:timeout': [JobSnapshot]
  'worker:spawned': [WorkerSnapshot]
  'worker:ready': [WorkerSnapshot]
  'worker:exit': [WorkerSnapshot, number]
  'worker:error': [WorkerSnapshot, Error]
  'worker:restarted': [WorkerSnapshot]
  'pool:drained': []
  'pool:closed': []
}

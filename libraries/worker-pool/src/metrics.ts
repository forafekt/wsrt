import type { WorkerPoolMetrics } from './types.js'

export class MetricsTracker {
  completedJobs = 0
  failedJobs = 0
  cancelledJobs = 0
  timedOutJobs = 0
  retriedJobs = 0
  workerRestarts = 0

  private totalWaitMs = 0
  private waitSamples = 0
  private totalRunMs = 0
  private runSamples = 0

  recordWait(ms: number): void {
    this.totalWaitMs += ms
    this.waitSamples += 1
  }

  recordRun(ms: number): void {
    this.totalRunMs += ms
    this.runSamples += 1
  }

  snapshot(queueSize: number, activeWorkers: number, idleWorkers: number): WorkerPoolMetrics {
    return {
      queueSize,
      activeWorkers,
      idleWorkers,
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
      cancelledJobs: this.cancelledJobs,
      timedOutJobs: this.timedOutJobs,
      retriedJobs: this.retriedJobs,
      workerRestarts: this.workerRestarts,
      averageWaitMs: this.waitSamples === 0 ? 0 : this.totalWaitMs / this.waitSamples,
      averageRunMs: this.runSamples === 0 ? 0 : this.totalRunMs / this.runSamples,
    }
  }
}

import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import {
	JobCancelledError,
	JobTimeoutError,
	QueueFullError,
	WorkerPoolClosedError,
} from "./errors.js";
import { TypedEventEmitter } from "./events.js";
import { normalizeLogger } from "./logger.js";
import { MetricsTracker } from "./metrics.js";
import { mergeJobOptions, PriorityJobQueue, type QueuedJob, snapshotJob } from "./queue.js";
import { reconstructError } from "./serializer.js";
import type {
	JobOptions,
	ShutdownMode,
	TaskMap,
	TaskName,
	WorkerPool,
	WorkerPoolEventMap,
	WorkerPoolMetrics,
	WorkerPoolOptions,
	WorkerSnapshot,
} from "./types.js";
import type { WorkerToParentMessage } from "./worker-protocol.js";

type WorkerSlot = {
	id: number;
	worker: Worker;
	ready: boolean;
	busy: boolean;
	closing: boolean;
	currentJob?: QueuedJob;
	lastHeartbeat: number;
	timeout?: NodeJS.Timeout;
};

export class WorkerPoolImpl<Tasks extends TaskMap = TaskMap>
	extends TypedEventEmitter<WorkerPoolEventMap>
	implements WorkerPool<Tasks>
{
	private readonly workerUrl: URL | string;
	private readonly minWorkers: number;
	private readonly maxWorkers: number;
	private readonly heartbeatIntervalMs: number;
	private readonly heartbeatTimeoutMs: number;
	private readonly queue: PriorityJobQueue;
	private readonly metricsTracker = new MetricsTracker();
	private readonly workers = new Map<number, WorkerSlot>();
	private readonly activeByTask = new Map<string, number>();
	private readonly taskConcurrency = new Map<string, number>();
	private readonly logger: ReturnType<typeof normalizeLogger>;
	private readonly startupWaiters: Array<() => void> = [];
	private readonly drainWaiters: Array<() => void> = [];
	private nextJobId = 1;
	private nextWorkerId = 1;
	private closed = false;
	private acceptingJobs = true;
	private healthTimer: NodeJS.Timeout;

	constructor(private readonly options: WorkerPoolOptions<Tasks>) {
		super();
		this.workerUrl = options.worker;
		const defaultWorkers = Math.max(1, availableParallelism() - 1);
		const fixedWorkers = options.workers;
		this.minWorkers =
			fixedWorkers ?? Math.max(0, options.minWorkers ?? Math.min(1, defaultWorkers));
		this.maxWorkers =
			fixedWorkers ?? Math.max(this.minWorkers, options.maxWorkers ?? defaultWorkers);
		this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 1_000;
		this.heartbeatTimeoutMs =
			options.heartbeatTimeoutMs ?? Math.max(5_000, this.heartbeatIntervalMs * 5);
		this.queue = new PriorityJobQueue(
			options.maxQueueSize ?? Number.POSITIVE_INFINITY,
			options.queueFullPolicy ?? "reject",
		);
		this.logger = normalizeLogger(options.logger);

		for (const [taskName, defaults] of Object.entries(options.taskDefaults ?? {})) {
			if (defaults?.concurrency !== undefined) {
				this.taskConcurrency.set(taskName, defaults.concurrency);
			}
		}

		for (let index = 0; index < this.minWorkers; index += 1) {
			this.spawnWorker();
		}

		this.healthTimer = setInterval(() => this.checkWorkerHealth(), this.heartbeatIntervalMs);
		this.healthTimer.unref();
	}

	ready(): Promise<void> {
		if (this.readyWorkerCount() >= this.minWorkers) return Promise.resolve();
		return new Promise((resolve) => this.startupWaiters.push(resolve));
	}

	run<Name extends TaskName<Tasks>>(
		taskName: Name,
		payload: Tasks[Name]["input"],
		options: JobOptions = {},
	): Promise<Tasks[Name]["output"]> {
		if (this.closed || !this.acceptingJobs) {
			return Promise.reject(new WorkerPoolClosedError());
		}

		const mergedOptions = mergeJobOptions(
			this.options.taskDefaults?.[taskName],
			this.options.defaultTimeoutMs,
			options,
		);
		const jobId = this.nextJobId++;
		const maxAttempts = Math.max(1, (mergedOptions.retries ?? 0) + 1);

		return new Promise((resolve, reject) => {
			const job: QueuedJob = {
				id: jobId,
				taskName,
				payload,
				state: "queued",
				attempt: 1,
				maxAttempts,
				priority: mergedOptions.priority ?? 0,
				queuedAt: Date.now(),
				options: { ...mergedOptions, priority: mergedOptions.priority ?? 0 },
				resolve,
				reject,
			};

			if (mergedOptions.signal) {
				if (mergedOptions.signal.aborted) {
					reject(new JobCancelledError());
					return;
				}
				const abort = () => this.cancelJob(job);
				mergedOptions.signal.addEventListener("abort", abort, { once: true });
				job.abortCleanup = () => mergedOptions.signal?.removeEventListener("abort", abort);
			}

			const result = this.queue.enqueue(job);
			if (!result.accepted) {
				job.abortCleanup?.();
				reject(result.error ?? new QueueFullError());
				return;
			}

			if (result.dropped) {
				this.cancelQueuedJob(result.dropped);
			}

			this.emit("job:queued", snapshotJob(job));
			this.dispatch();
		});
	}

	metrics(): WorkerPoolMetrics {
		const activeWorkers = [...this.workers.values()].filter((worker) => worker.busy).length;
		const idleWorkers = [...this.workers.values()].filter(
			(worker) => worker.ready && !worker.busy,
		).length;
		return this.metricsTracker.snapshot(this.queue.size, activeWorkers, idleWorkers);
	}

	async shutdown(mode: ShutdownMode = "graceful"): Promise<void> {
		if (this.closed) return;
		this.acceptingJobs = false;

		if (mode === "force") {
			this.closed = true;
			for (const job of this.queue.drain()) this.cancelQueuedJob(job);
			await Promise.all([...this.workers.values()].map((slot) => this.terminateWorker(slot, true)));
			this.finishClose();
			return;
		}

		if (mode === "graceful" || mode === "drain") {
			await this.waitForDrain();
		}

		const slots = [...this.workers.values()];
		const exits = slots.map((slot) => this.waitForWorkerExit(slot));
		for (const slot of slots) {
			slot.closing = true;
			slot.worker.postMessage({ type: "shutdown" });
		}
		await Promise.all(exits);
		this.finishClose();
	}

	private spawnWorker(): WorkerSlot {
		const id = this.nextWorkerId++;
		const worker = new Worker(this.workerUrl);
		const slot: WorkerSlot = {
			id,
			worker,
			ready: false,
			busy: false,
			closing: false,
			lastHeartbeat: Date.now(),
		};
		this.workers.set(id, slot);
		worker.on("message", (message: WorkerToParentMessage) =>
			this.handleWorkerMessage(slot, message),
		);
		worker.on("error", (error) => this.handleWorkerError(slot, error));
		worker.on("exit", (code) => this.handleWorkerExit(slot, code));
		this.emit("worker:spawned", this.snapshotWorker(slot));
		return slot;
	}

	private handleWorkerMessage(slot: WorkerSlot, message: WorkerToParentMessage): void {
		if (message.type === "ready") {
			slot.ready = true;
			slot.lastHeartbeat = Date.now();
			this.emit("worker:ready", this.snapshotWorker(slot));
			this.resolveReadyWaiters();
			this.dispatch();
			return;
		}

		if (message.type === "heartbeat") {
			slot.lastHeartbeat = Date.now();
			return;
		}

		const job = slot.currentJob;
		if (!job || job.id !== message.jobId) return;

		if (message.type === "result") {
			this.completeJob(slot, job, message.result);
			return;
		}

		this.failJob(slot, job, reconstructError(message.error));
	}

	private handleWorkerError(slot: WorkerSlot, error: Error): void {
		this.logger.error("Worker pool worker error", { workerId: slot.id, error });
		this.emit("worker:error", this.snapshotWorker(slot), error);
	}

	private handleWorkerExit(slot: WorkerSlot, code: number): void {
		this.emit("worker:exit", this.snapshotWorker(slot), code);
		this.workers.delete(slot.id);
		if (slot.timeout) clearTimeout(slot.timeout);

		if (slot.currentJob) {
			this.failJobWithoutWorker(slot.currentJob, new Error(`Worker exited with code ${code}`));
		}

		if (!this.closed && !slot.closing && this.workers.size < this.minWorkers) {
			this.restartWorker();
		}
		this.dispatch();
		this.resolveDrainWaiters();
	}

	private dispatch(): void {
		if (this.closed) return;
		this.scaleForDemand();

		for (const slot of this.workers.values()) {
			if (!slot.ready || slot.busy || slot.closing) continue;
			const job = this.queue.dequeueReady(this.activeByTask, this.taskConcurrency);
			if (!job) break;
			this.startJob(slot, job);
		}
		this.resolveDrainWaiters();
	}

	private scaleForDemand(): void {
		const idle = [...this.workers.values()].filter(
			(worker) => worker.ready && !worker.busy && !worker.closing,
		).length;
		if (this.queue.size > idle && this.workers.size < this.maxWorkers) {
			const needed = Math.min(this.maxWorkers - this.workers.size, this.queue.size - idle);
			for (let index = 0; index < needed; index += 1) this.spawnWorker();
		}
	}

	private startJob(slot: WorkerSlot, job: QueuedJob): void {
		job.state = "running";
		job.startedAt = Date.now();
		slot.busy = true;
		slot.currentJob = job;
		this.activeByTask.set(job.taskName, (this.activeByTask.get(job.taskName) ?? 0) + 1);
		this.metricsTracker.recordWait(job.startedAt - job.queuedAt);
		this.emit("job:started", snapshotJob(job));

		if (job.options.timeoutMs && job.options.timeoutMs > 0) {
			slot.timeout = setTimeout(
				() => this.timeoutJob(slot, job, job.options.timeoutMs ?? 0),
				job.options.timeoutMs,
			);
		}

		slot.worker.postMessage(
			{
				type: "run",
				jobId: job.id,
				taskName: job.taskName,
				payload: job.payload,
				attempt: job.attempt,
			},
			job.options.transferList,
		);
	}

	private completeJob(slot: WorkerSlot, job: QueuedJob, result: unknown): void {
		this.releaseWorker(slot, job);
		job.state = "completed";
		job.completedAt = Date.now();
		job.abortCleanup?.();
		this.metricsTracker.completedJobs += 1;
		if (job.startedAt) this.metricsTracker.recordRun(job.completedAt - job.startedAt);
		job.resolve(result);
		this.emit("job:completed", snapshotJob(job), result);
		this.dispatch();
	}

	private failJob(slot: WorkerSlot, job: QueuedJob, error: Error): void {
		this.releaseWorker(slot, job);
		this.retryOrReject(job, error);
		this.dispatch();
	}

	private failJobWithoutWorker(job: QueuedJob, error: Error): void {
		this.decrementActive(job.taskName);
		if (job.startedAt) this.metricsTracker.recordRun(Date.now() - job.startedAt);
		this.retryOrReject(job, error);
	}

	private retryOrReject(job: QueuedJob, error: Error): void {
		if (job.attempt < job.maxAttempts && job.state !== "cancelled" && job.state !== "timeout") {
			job.attempt += 1;
			job.state = "queued";
			job.startedAt = undefined;
			job.queuedAt = Date.now();
			this.metricsTracker.retriedJobs += 1;
			const delay = this.retryDelay(job);
			setTimeout(() => {
				if (this.closed) {
					this.rejectJob(job, new WorkerPoolClosedError());
					return;
				}
				const result = this.queue.enqueue(job);
				if (!result.accepted) {
					this.rejectJob(job, result.error ?? new QueueFullError());
					return;
				}
				if (result.dropped) this.cancelQueuedJob(result.dropped);
				this.emit("job:queued", snapshotJob(job));
				this.dispatch();
			}, delay).unref();
			return;
		}

		this.rejectJob(job, error);
	}

	private rejectJob(job: QueuedJob, error: Error): void {
		job.state = "failed";
		job.completedAt = Date.now();
		job.abortCleanup?.();
		this.metricsTracker.failedJobs += 1;
		job.reject(error);
		this.emit("job:failed", snapshotJob(job), error);
	}

	private timeoutJob(slot: WorkerSlot, job: QueuedJob, timeoutMs: number): void {
		if (slot.currentJob?.id !== job.id) return;
		this.releaseWorker(slot, job);
		job.state = "timeout";
		job.completedAt = Date.now();
		job.abortCleanup?.();
		this.metricsTracker.timedOutJobs += 1;
		const error = new JobTimeoutError(timeoutMs);
		job.reject(error);
		this.emit("job:timeout", snapshotJob(job));
		this.recycleWorker(slot);
		this.dispatch();
	}

	private cancelJob(job: QueuedJob): void {
		if (job.state === "queued") {
			const queued = this.queue.remove(job.id);
			if (queued) this.cancelQueuedJob(queued);
			return;
		}

		for (const slot of this.workers.values()) {
			if (slot.currentJob?.id === job.id) {
				slot.worker.postMessage({ type: "cancel", jobId: job.id });
				this.releaseWorker(slot, job);
				job.state = "cancelled";
				job.completedAt = Date.now();
				job.abortCleanup?.();
				this.metricsTracker.cancelledJobs += 1;
				job.reject(new JobCancelledError());
				this.emit("job:cancelled", snapshotJob(job));
				this.recycleWorker(slot);
				this.dispatch();
				return;
			}
		}
	}

	private cancelQueuedJob(job: QueuedJob): void {
		job.state = "cancelled";
		job.completedAt = Date.now();
		job.abortCleanup?.();
		this.metricsTracker.cancelledJobs += 1;
		job.reject(new JobCancelledError());
		this.emit("job:cancelled", snapshotJob(job));
	}

	private releaseWorker(slot: WorkerSlot, job: QueuedJob): void {
		if (slot.timeout) {
			clearTimeout(slot.timeout);
			slot.timeout = undefined;
		}
		slot.currentJob = undefined;
		slot.busy = false;
		this.decrementActive(job.taskName);
	}

	private recycleWorker(slot: WorkerSlot): void {
		slot.closing = true;
		this.terminateWorker(slot, true).catch((error: unknown) => {
			this.logger.warn("Failed to recycle worker", { workerId: slot.id, error });
		});
		if (!this.closed) this.restartWorker();
	}

	private restartWorker(): void {
		const slot = this.spawnWorker();
		this.metricsTracker.workerRestarts += 1;
		this.emit("worker:restarted", this.snapshotWorker(slot));
	}

	private async terminateWorker(slot: WorkerSlot, closing: boolean): Promise<void> {
		slot.closing = closing;
		if (slot.timeout) clearTimeout(slot.timeout);
		await slot.worker.terminate();
	}

	private waitForWorkerExit(slot: WorkerSlot): Promise<void> {
		return new Promise((resolve) => {
			if (!this.workers.has(slot.id)) {
				resolve();
				return;
			}
			slot.worker.once("exit", () => resolve());
		});
	}

	private checkWorkerHealth(): void {
		if (this.closed) return;
		const now = Date.now();
		for (const slot of this.workers.values()) {
			if (now - slot.lastHeartbeat <= this.heartbeatTimeoutMs) continue;
			this.logger.warn("Worker heartbeat timed out; restarting worker", { workerId: slot.id });
			if (slot.currentJob) {
				this.failJob(slot, slot.currentJob, new Error("Worker heartbeat timed out"));
			}
			this.recycleWorker(slot);
		}
	}

	private retryDelay(job: QueuedJob): number {
		const base = job.options.delayMs ?? 0;
		if (!job.options.exponentialBackoff) return base;
		const delay = base * 2 ** Math.max(0, job.attempt - 2);
		return job.options.maxDelayMs ? Math.min(delay, job.options.maxDelayMs) : delay;
	}

	private decrementActive(taskName: string): void {
		const next = Math.max(0, (this.activeByTask.get(taskName) ?? 1) - 1);
		if (next === 0) this.activeByTask.delete(taskName);
		else this.activeByTask.set(taskName, next);
	}

	private readyWorkerCount(): number {
		return [...this.workers.values()].filter((worker) => worker.ready).length;
	}

	private resolveReadyWaiters(): void {
		if (this.readyWorkerCount() < this.minWorkers) return;
		for (const resolve of this.startupWaiters.splice(0)) resolve();
	}

	private waitForDrain(): Promise<void> {
		if (this.queue.size === 0 && [...this.workers.values()].every((worker) => !worker.busy)) {
			this.emit("pool:drained");
			return Promise.resolve();
		}
		return new Promise((resolve) => this.drainWaiters.push(resolve));
	}

	private resolveDrainWaiters(): void {
		if (this.queue.size !== 0 || [...this.workers.values()].some((worker) => worker.busy)) return;
		if (this.drainWaiters.length > 0) {
			this.emit("pool:drained");
			for (const resolve of this.drainWaiters.splice(0)) resolve();
		}
	}

	private finishClose(): void {
		this.closed = true;
		clearInterval(this.healthTimer);
		this.workers.clear();
		this.emit("pool:closed");
	}

	private snapshotWorker(slot: WorkerSlot): WorkerSnapshot {
		return {
			id: slot.id,
			ready: slot.ready,
			busy: slot.busy,
			currentJobId: slot.currentJob?.id,
		};
	}
}

export function createWorkerPool<Tasks extends TaskMap = TaskMap>(
	options: WorkerPoolOptions<Tasks>,
): WorkerPool<Tasks> {
	return new WorkerPoolImpl(options);
}

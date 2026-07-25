export class WorkerPoolError extends Error {
	constructor(
		message: string,
		public readonly code: string,
	) {
		super(message);
		this.name = "WorkerPoolError";
	}
}

export class QueueFullError extends WorkerPoolError {
	constructor() {
		super("Worker pool queue is full", "QUEUE_FULL");
		this.name = "QueueFullError";
	}
}

export class JobCancelledError extends WorkerPoolError {
	constructor(message = "Worker pool job was cancelled") {
		super(message, "JOB_CANCELLED");
		this.name = "JobCancelledError";
	}
}

export class JobTimeoutError extends WorkerPoolError {
	constructor(timeoutMs: number) {
		super(`Worker pool job timed out after ${timeoutMs}ms`, "JOB_TIMEOUT");
		this.name = "JobTimeoutError";
	}
}

export class WorkerPoolClosedError extends WorkerPoolError {
	constructor() {
		super("Worker pool is closed", "POOL_CLOSED");
		this.name = "WorkerPoolClosedError";
	}
}

export class WorkerTaskNotFoundError extends WorkerPoolError {
	constructor(taskName: string) {
		super(`Worker task "${taskName}" is not registered`, "TASK_NOT_FOUND");
		this.name = "WorkerTaskNotFoundError";
	}
}

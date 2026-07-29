import {
	type DependencyCondition,
	defaultDependencyCondition,
	type SystemEdge,
	type SystemGraph,
} from "@wsrt/graph";

export const lifecycleStates = [
	"discovered",
	"unresolved",
	"resolving",
	"resolved",
	"validating",
	"invalid",
	"preparing",
	"prepared",
	"blocked",
	"starting",
	"running",
	"ready",
	"healthy",
	"degraded",
	"unhealthy",
	"stopping",
	"stopped",
	"failed",
	"destroying",
	"destroyed",
] as const;

export type LifecycleState = (typeof lifecycleStates)[number];

export type LifecycleEvent = {
	id: string;
	type: "lifecycle.transition";
	timestamp: string;
	source: string;
	correlationId: string;
	causationId?: string;
	payload: { from: LifecycleState; to: LifecycleState; error?: string };
};

export type LifecycleHandler = {
	start(context: LifecycleContext): Promise<void>;
	stop(context: LifecycleContext): Promise<void>;
	ready?(context: LifecycleContext): Promise<void>;
};

export type LifecycleContext = {
	signal: AbortSignal;
	nodeId: string;
	correlationId: string;
};

export type LifecycleOptions = {
	timeoutMs?: number;
	retries?: number;
	onEvent?: (event: LifecycleEvent) => void;
	/**
	 * Resolves once `nodeId` is observed healthy. Health is owned by the control
	 * plane, so `healthy` dependencies degrade to `ready` when this is absent.
	 */
	awaitHealthy?: (nodeId: string, signal: AbortSignal) => Promise<void>;
	/** Bound on a `healthy` wait, which no other timeout covers. */
	healthyTimeoutMs?: number;
};

/** Raised when a node never started because a dependency condition was not met. */
export class LifecycleBlockedError extends Error {
	constructor(
		readonly nodeId: string,
		readonly dependencyId: string,
		readonly condition: DependencyCondition,
		cause: unknown,
	) {
		super(
			`${nodeId} is blocked: dependency ${dependencyId} did not reach "${condition}": ${
				cause instanceof Error ? cause.message : String(cause)
			}`,
			{ cause },
		);
		this.name = "LifecycleBlockedError";
	}
}

type Milestone = {
	readonly promise: Promise<void>;
	resolve(): void;
	reject(cause: unknown): void;
};

type NodeMilestones = { readonly running: Milestone; readonly ready: Milestone };

function milestone(): Milestone {
	let resolve: () => void = () => {};
	let reject: (cause: unknown) => void = () => {};
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	// A milestone may be observed by no dependant at all; never leave it unhandled.
	void promise.catch(() => {});
	return { promise, resolve, reject };
}

const transitions: Partial<Record<LifecycleState, readonly LifecycleState[]>> = {
	discovered: ["resolving", "resolved", "invalid"],
	resolved: ["validating", "preparing", "starting", "blocked"],
	validating: ["resolved", "invalid"],
	preparing: ["prepared", "failed"],
	prepared: ["starting", "blocked"],
	blocked: ["starting", "stopping", "failed", "blocked"],
	starting: ["running", "ready", "failed"],
	running: ["ready", "healthy", "degraded", "unhealthy", "stopping", "failed"],
	ready: ["healthy", "degraded", "unhealthy", "stopping", "failed"],
	healthy: ["degraded", "unhealthy", "stopping", "failed"],
	degraded: ["healthy", "unhealthy", "stopping", "failed"],
	unhealthy: ["healthy", "degraded", "stopping", "failed"],
	stopping: ["stopped", "failed"],
	stopped: ["starting", "destroying", "blocked"],
	failed: ["starting", "stopping", "destroying", "blocked"],
	destroying: ["destroyed", "failed"],
};

export class LifecycleEngine {
	readonly #states = new Map<string, LifecycleState>();
	readonly #handlers = new Map<string, LifecycleHandler>();
	readonly #milestones = new Map<string, NodeMilestones>();
	constructor(
		readonly graph: SystemGraph,
		readonly options: LifecycleOptions = {},
	) {
		for (const node of graph.nodes()) this.#states.set(node.id, "resolved");
	}
	register(nodeId: string, handler: LifecycleHandler): this {
		if (!this.graph.node(nodeId)) throw new Error(`Unknown lifecycle node: ${nodeId}`);
		this.#handlers.set(nodeId, handler);
		return this;
	}
	state(nodeId: string): LifecycleState {
		const state = this.#states.get(nodeId);
		if (!state) throw new Error(`Unknown lifecycle node: ${nodeId}`);
		return state;
	}
	/** Records an externally observed process exit in the authoritative lifecycle. */
	processExited(nodeId: string, expected: boolean, correlationId: string): void {
		const state = this.state(nodeId);
		if (expected) {
			if (["stopping", "stopped", "resolved"].includes(state)) return;
			this.#transition(nodeId, "stopping", correlationId);
			this.#transition(nodeId, "stopped", correlationId);
			return;
		}
		if (state !== "failed")
			this.#transition(nodeId, "failed", correlationId, new Error("Process exited unexpectedly"));
	}
	/**
	 * Starts `ids`, gating every node on the condition declared by each of its
	 * dependency edges rather than on a shared stage barrier. Independent nodes
	 * therefore proceed as soon as their own dependencies are satisfied.
	 */
	async start(
		ids: Iterable<string> = this.#handlers.keys(),
		signal = new AbortController().signal,
	): Promise<void> {
		const selected = new Set(ids);
		// Scheduling is dependency-driven, but planning still owns cycle detection.
		this.graph.plan([...selected]);
		const pending = new Map<string, Promise<void>>();
		const begin = (id: string): Promise<void> => {
			let started = pending.get(id);
			if (!started) {
				started = this.#startOne(id, selected, signal, begin);
				pending.set(id, started);
				void started.catch(() => {});
			}
			return started;
		};
		const settled = await Promise.allSettled([...selected].map((id) => begin(id)));
		const failures = settled.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (!failures.length) return;
		throw failures.length === 1
			? failures[0]
			: new AggregateError(failures, failures.map(describe).join("; "));
	}
	async stop(
		ids: Iterable<string> = this.#handlers.keys(),
		signal = new AbortController().signal,
	): Promise<void> {
		const selected = [...ids];
		for (const stage of this.graph.shutdownPlan(selected).stages)
			await Promise.all(stage.map((id) => this.#stopOne(id, signal)));
	}
	/** Waits for one dependency edge to satisfy its declared condition. */
	async #awaitDependency(
		edge: SystemEdge,
		signal: AbortSignal,
		begin: (id: string) => Promise<void>,
	): Promise<void> {
		const condition = edge.condition ?? defaultDependencyCondition;
		const completion = begin(edge.to);
		try {
			// `completed` observes termination only; a failed dependency still admits.
			if (condition === "completed") return void (await completion.catch(() => {}));
			const milestones = this.#milestonesOf(edge.to);
			if (condition === "started") return await milestones.running.promise;
			// `ready` and `successful` are both the dependency's own readiness gate:
			// a service that passed readiness, or a task that exited successfully.
			await milestones.ready.promise;
			if (condition !== "healthy" || !this.options.awaitHealthy) return;
			await withTimeout(
				this.options.awaitHealthy(edge.to, signal),
				this.options.healthyTimeoutMs ?? 30_000,
				signal,
			);
		} catch (cause) {
			throw new LifecycleBlockedError(edge.from, edge.to, condition, cause);
		}
	}
	#milestonesOf(id: string): NodeMilestones {
		const existing = this.#milestones.get(id);
		if (existing) return existing;
		const created = { running: milestone(), ready: milestone() };
		this.#milestones.set(id, created);
		return created;
	}
	async #startOne(
		id: string,
		selected: ReadonlySet<string>,
		signal: AbortSignal,
		begin: (id: string) => Promise<void>,
	): Promise<void> {
		const handler = this.#handlers.get(id);
		if (!handler) return;
		// Publish this attempt's milestones before awaiting, so dependants that
		// resolve `begin(id)` synchronously observe the current run.
		const milestones = { running: milestone(), ready: milestone() };
		this.#milestones.set(id, milestones);
		const edges = this.graph
			.dependencyEdges(id)
			.filter((edge) => selected.has(edge.to) && this.#handlers.has(edge.to));
		try {
			await Promise.all(edges.map((edge) => this.#awaitDependency(edge, signal, begin)));
		} catch (cause) {
			const blocked =
				cause instanceof LifecycleBlockedError && cause.nodeId === id
					? cause
					: new LifecycleBlockedError(id, "unknown", defaultDependencyCondition, cause);
			const correlationId = crypto.randomUUID();
			if (transitions[this.state(id)]?.includes("blocked"))
				this.#transition(id, "blocked", correlationId, blocked);
			milestones.running.reject(blocked);
			milestones.ready.reject(blocked);
			throw blocked;
		}
		const correlationId = crypto.randomUUID();
		this.#transition(id, "starting", correlationId);
		try {
			await this.#attempt(() => handler.start({ signal, nodeId: id, correlationId }), signal);
			this.#transition(id, "running", correlationId);
			milestones.running.resolve();
			if (handler.ready) {
				const ready = handler.ready;
				await this.#attempt(() => ready({ signal, nodeId: id, correlationId }), signal);
				this.#transition(id, "ready", correlationId);
			}
			milestones.ready.resolve();
		} catch (cause) {
			milestones.running.reject(cause);
			milestones.ready.reject(cause);
			let failure = cause;
			// A start may already own resources even when readiness or the operation is cancelled.
			// Roll it back with a fresh signal so cancellation cannot prevent cleanup.
			try {
				await this.#attempt(
					() =>
						handler.stop({
							signal: new AbortController().signal,
							nodeId: id,
							correlationId,
						}),
					new AbortController().signal,
				);
			} catch (rollbackCause) {
				failure = new AggregateError([cause, rollbackCause], `Failed to start and roll back ${id}`);
			}
			if (this.state(id) !== "failed") this.#transition(id, "failed", correlationId, failure);
			throw failure;
		}
	}
	async #stopOne(id: string, signal: AbortSignal): Promise<void> {
		const handler = this.#handlers.get(id);
		if (!handler || ["resolved", "stopped"].includes(this.state(id))) return;
		const correlationId = crypto.randomUUID();
		this.#transition(id, "stopping", correlationId);
		try {
			await this.#attempt(() => handler.stop({ signal, nodeId: id, correlationId }), signal);
			this.#transition(id, "stopped", correlationId);
			this.#milestones.delete(id);
		} catch (cause) {
			if (this.state(id) !== "failed") this.#transition(id, "failed", correlationId, cause);
			throw cause;
		}
	}
	async #attempt(operation: () => Promise<void>, signal: AbortSignal): Promise<void> {
		let last: unknown;
		for (let attempt = 0; attempt <= (this.options.retries ?? 0); attempt++) {
			try {
				await withTimeout(operation(), this.options.timeoutMs ?? 30_000, signal);
				return;
			} catch (cause) {
				last = cause;
			}
		}
		throw last;
	}
	#transition(id: string, to: LifecycleState, correlationId: string, cause?: unknown): void {
		const from = this.state(id);
		if (!transitions[from]?.includes(to))
			throw new Error(`Invalid lifecycle transition for ${id}: ${from} -> ${to}`);
		this.#states.set(id, to);
		this.options.onEvent?.({
			id: crypto.randomUUID(),
			type: "lifecycle.transition",
			timestamp: new Date().toISOString(),
			source: id,
			correlationId,
			payload: {
				from,
				to,
				...(cause ? { error: cause instanceof Error ? cause.message : String(cause) } : {}),
			},
		});
	}
}

function describe(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) {
		void promise.catch(() => {});
		throw signal.reason ?? new Error("Operation cancelled");
	}
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`Lifecycle operation timed out after ${timeoutMs}ms`)),
			timeoutMs,
		);
	});
	let rejectCancellation: (cause: unknown) => void = () => {};
	const abort = () => rejectCancellation(signal.reason ?? new Error("Operation cancelled"));
	const cancelled = new Promise<never>((_, reject) => {
		rejectCancellation = reject;
		signal.addEventListener("abort", abort, { once: true });
	});
	try {
		return await Promise.race([promise, timeout, cancelled]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		signal.removeEventListener("abort", abort);
	}
}

export { defaultDependencyCondition };

export type { DependencyCondition };

import type { DependencyCondition, SystemGraph } from "@wsrt/graph";

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
};

const transitions: Partial<Record<LifecycleState, readonly LifecycleState[]>> =
	{
		discovered: ["resolving", "resolved", "invalid"],
		resolved: ["validating", "preparing", "starting"],
		validating: ["resolved", "invalid"],
		preparing: ["prepared", "failed"],
		prepared: ["starting"],
		blocked: ["starting", "stopping", "failed"],
		starting: ["running", "ready", "failed"],
		running: [
			"ready",
			"healthy",
			"degraded",
			"unhealthy",
			"stopping",
			"failed",
		],
		ready: ["healthy", "degraded", "unhealthy", "stopping", "failed"],
		healthy: ["degraded", "unhealthy", "stopping", "failed"],
		degraded: ["healthy", "unhealthy", "stopping", "failed"],
		unhealthy: ["healthy", "degraded", "stopping", "failed"],
		stopping: ["stopped", "failed"],
		stopped: ["starting", "destroying"],
		failed: ["starting", "stopping", "destroying"],
		destroying: ["destroyed", "failed"],
	};

export class LifecycleEngine {
	readonly #states = new Map<string, LifecycleState>();
	readonly #handlers = new Map<string, LifecycleHandler>();
	constructor(
		readonly graph: SystemGraph,
		readonly options: LifecycleOptions = {},
	) {
		for (const node of graph.nodes()) this.#states.set(node.id, "resolved");
	}
	register(nodeId: string, handler: LifecycleHandler): this {
		if (!this.graph.node(nodeId))
			throw new Error(`Unknown lifecycle node: ${nodeId}`);
		this.#handlers.set(nodeId, handler);
		return this;
	}
	state(nodeId: string): LifecycleState {
		const state = this.#states.get(nodeId);
		if (!state) throw new Error(`Unknown lifecycle node: ${nodeId}`);
		return state;
	}
	async start(
		ids: Iterable<string> = this.#handlers.keys(),
		signal = new AbortController().signal,
	): Promise<void> {
		const selected = [...ids];
		for (const stage of this.graph.plan(selected).stages)
			await Promise.all(stage.map((id) => this.#startOne(id, signal)));
	}
	async stop(
		ids: Iterable<string> = this.#handlers.keys(),
		signal = new AbortController().signal,
	): Promise<void> {
		const selected = [...ids];
		for (const stage of this.graph.shutdownPlan(selected).stages)
			await Promise.all(stage.map((id) => this.#stopOne(id, signal)));
	}
	async #startOne(id: string, signal: AbortSignal): Promise<void> {
		const handler = this.#handlers.get(id);
		if (!handler) return;
		const correlationId = crypto.randomUUID();
		this.#transition(id, "starting", correlationId);
		try {
			await this.#attempt(
				() => handler.start({ signal, nodeId: id, correlationId }),
				signal,
			);
			this.#transition(id, "running", correlationId);
			if (handler.ready) {
				await this.#attempt(
					() => handler.ready!({ signal, nodeId: id, correlationId }),
					signal,
				);
				this.#transition(id, "ready", correlationId);
			}
		} catch (cause) {
			this.#transition(id, "failed", correlationId, cause);
			throw cause;
		}
	}
	async #stopOne(id: string, signal: AbortSignal): Promise<void> {
		const handler = this.#handlers.get(id);
		if (!handler || ["resolved", "stopped"].includes(this.state(id))) return;
		const correlationId = crypto.randomUUID();
		this.#transition(id, "stopping", correlationId);
		try {
			await this.#attempt(
				() => handler.stop({ signal, nodeId: id, correlationId }),
				signal,
			);
			this.#transition(id, "stopped", correlationId);
		} catch (cause) {
			this.#transition(id, "failed", correlationId, cause);
			throw cause;
		}
	}
	async #attempt(
		operation: () => Promise<void>,
		signal: AbortSignal,
	): Promise<void> {
		let last: unknown;
		for (let attempt = 0; attempt <= (this.options.retries ?? 0); attempt++) {
			try {
				await withTimeout(
					operation(),
					this.options.timeoutMs ?? 30_000,
					signal,
				);
				return;
			} catch (cause) {
				last = cause;
			}
		}
		throw last;
	}
	#transition(
		id: string,
		to: LifecycleState,
		correlationId: string,
		cause?: unknown,
	): void {
		const from = this.state(id);
		if (!transitions[from]?.includes(to))
			throw new Error(
				`Invalid lifecycle transition for ${id}: ${from} -> ${to}`,
			);
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
				...(cause
					? { error: cause instanceof Error ? cause.message : String(cause) }
					: {}),
			},
		});
	}
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) throw signal.reason ?? new Error("Operation cancelled");
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(new Error(`Lifecycle operation timed out after ${timeoutMs}ms`)),
			timeoutMs,
		);
	});
	const cancelled = new Promise<never>((_, reject) =>
		signal.addEventListener(
			"abort",
			() => reject(signal.reason ?? new Error("Operation cancelled")),
			{ once: true },
		),
	);
	try {
		return await Promise.race([promise, timeout, cancelled]);
	} finally {
		clearTimeout(timer!);
	}
}

export type { DependencyCondition };

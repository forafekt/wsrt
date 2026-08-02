import type { NormalizedExecutable } from "@wsrt/config";
import type { ControlPlaneState } from "./control-plane-state.js";
import type { EventJournal } from "./event-journal.js";
import type { HealthState } from "./types.js";

export class HealthManager {
	readonly #monitors = new Map<string, AbortController>();
	readonly #generations = new Map<string, number>();
	readonly #restartControllers = new Map<string, AbortController>();
	readonly #waiters = new Map<string, Set<{ resolve(): void; reject(cause: unknown): void }>>();

	constructor(
		private readonly state: ControlPlaneState,
		private readonly events: EventJournal,
		private readonly changed: () => void,
		private readonly restartNode: (id: string) => Promise<void>,
	) {}

	awaitHealthy(nodeId: string, signal: AbortSignal): Promise<void> {
		if ((this.state.health.get(nodeId) ?? "unknown") === "healthy") return Promise.resolve();
		if (this.state.disposed)
			return Promise.reject(
				new Error(`Control plane was disposed while waiting for ${nodeId} to become healthy`),
			);
		return new Promise<void>((resolve, reject) => {
			const waiters = this.#waiters.get(nodeId) ?? new Set();
			this.#waiters.set(nodeId, waiters);
			const waiter = {
				resolve: () => {
					release();
					resolve();
				},
				reject: (cause: unknown) => {
					release();
					reject(cause);
				},
			};
			const abort = () =>
				waiter.reject(signal.reason ?? new DOMException("Operation cancelled", "AbortError"));
			const release = () => {
				waiters.delete(waiter);
				if (!waiters.size) this.#waiters.delete(nodeId);
				signal.removeEventListener("abort", abort);
			};
			waiters.add(waiter);
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort, { once: true });
		});
	}

	set(id: string, health: HealthState): void {
		if (health === "healthy") this.#settle(id);
		const old = this.state.health.get(id) ?? "unknown";
		if (old === health) return;
		this.state.health.set(id, health);
		if (health === "degraded") this.events.emit("node.health.degraded", id, id, {});
		if (health === "unhealthy") this.events.emit("node.health.unhealthy", id, id, {});
		if (health === "healthy" && ["degraded", "unhealthy"].includes(old))
			this.events.emit("node.health.recovered", id, id, {});
		this.changed();
	}

	startMonitor(item: NormalizedExecutable, check: (signal: AbortSignal) => Promise<void>): void {
		this.stopMonitor(item.id);
		const controller = new AbortController();
		const generation = (this.#generations.get(item.id) ?? 0) + 1;
		this.#generations.set(item.id, generation);
		this.#monitors.set(item.id, controller);
		this.set(item.id, "checking");
		void this.#monitor(item, check, controller, generation);
	}

	stopMonitor(id: string): void {
		this.#generations.set(id, (this.#generations.get(id) ?? 0) + 1);
		this.#monitors.get(id)?.abort();
		this.#monitors.delete(id);
	}

	cancelRestart(id: string, reason: string): void {
		const controller = this.#restartControllers.get(id);
		if (!controller) return;
		controller.abort(new DOMException(reason, "AbortError"));
		this.#restartControllers.delete(id);
	}

	async dispose(): Promise<void> {
		for (const controller of this.#monitors.values()) controller.abort();
		for (const controller of this.#restartControllers.values())
			controller.abort(new DOMException("Control plane disposed", "AbortError"));
		for (const id of [...this.#waiters.keys()])
			this.#settle(id, new DOMException("Control plane disposed", "AbortError"));
		this.#monitors.clear();
	}

	async #monitor(
		item: NormalizedExecutable,
		check: (signal: AbortSignal) => Promise<void>,
		controller: AbortController,
		generation: number,
	): Promise<void> {
		while (!controller.signal.aborted && this.state.handles.get(item.id)?.running) {
			let diagnostic: string | undefined;
			try {
				await check(controller.signal);
			} catch (cause) {
				diagnostic = cause instanceof Error ? cause.message : String(cause);
			}
			if (
				controller.signal.aborted ||
				this.#generations.get(item.id) !== generation ||
				this.state.disposed
			)
				break;
			const previous = this.state.healthDetails.get(item.id) ?? {
				restartCount: 0,
				consecutiveSuccesses: 0,
				consecutiveFailures: 0,
				restartPending: false,
				currentRestartAttempt: 0,
			};
			const successes = diagnostic ? 0 : previous.consecutiveSuccesses + 1;
			const failures = diagnostic ? previous.consecutiveFailures + 1 : 0;
			const health: HealthState = diagnostic
				? failures >= (item.healthcheck?.unhealthyThreshold ?? 3)
					? "unhealthy"
					: "degraded"
				: successes >= (item.healthcheck?.healthyThreshold ?? 1)
					? "healthy"
					: "checking";
			this.state.healthDetails.set(item.id, {
				...previous,
				consecutiveSuccesses: successes,
				consecutiveFailures: failures,
				lastCheckAt: new Date().toISOString(),
				lastHealthDiagnostic: diagnostic,
			});
			this.set(item.id, health);
			if (
				health === "unhealthy" &&
				item.restart.policy !== "never" &&
				item.restart.restartOnUnhealthy
			)
				void this.restartNode(item.id);
			try {
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(
						resolve,
						item.healthcheck && "intervalMs" in item.healthcheck
							? (item.healthcheck.intervalMs ?? 5000)
							: 5000,
					);
					controller.signal.addEventListener(
						"abort",
						() => {
							clearTimeout(timer);
							reject(controller.signal.reason);
						},
						{ once: true },
					);
				});
			} catch {
				break;
			}
		}
	}

	#settle(id: string, cause?: unknown): void {
		for (const waiter of [...(this.#waiters.get(id) ?? [])])
			cause === undefined ? waiter.resolve() : waiter.reject(cause);
	}
}

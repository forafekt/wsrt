import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	ProcessHandle,
	RuntimeInstance,
	RuntimeProvider,
} from "@wsrt/capabilities";
import {
	compileSystemGraph,
	loadSystemDefinition,
	type NormalizedExecutable,
	type NormalizedSystemDefinition,
	type SystemDiagnostic,
} from "@wsrt/config";
import type { ExecutionPlan, SystemGraph, SystemNode } from "@wsrt/graph";
import {
	LifecycleEngine,
	type LifecycleEvent,
	type LifecycleState,
} from "@wsrt/lifecycle";
import { NodeRuntimeProvider } from "@wsrt/runtime-node";
import { RustRuntimeProvider } from "@wsrt/runtime-rust";

export type WorkspaceEvent =
	| LifecycleEvent
	| {
			id: string;
			type: string;
			timestamp: string;
			source: string;
			correlationId: string;
			payload: unknown;
	  };
export type ArtifactRecord = {
	id: string;
	type: string;
	producer?: string;
	consumers: readonly string[];
	location?: string;
	status:
		| "pending"
		| "invalid"
		| "generating"
		| "ready"
		| "unchanged"
		| "failed";
	hash?: string;
	size?: number;
	createdAt?: string;
	updatedAt?: string;
	invalidatedAt?: string;
	sourceOperationId?: string;
	diagnostics?: readonly SystemDiagnostic[];
	metadata: Readonly<Record<string, unknown>>;
};
export type OperationResult = {
	operationId: string;
	nodes: readonly string[];
	states: Readonly<Record<string, LifecycleState>>;
	status: "completed" | "partially-completed" | "failed" | "cancelled";
	results: readonly NodeOperationResult[];
};
export type NodeOperationResult = {
	nodeId: string;
	status:
		| "completed"
		| "already-satisfied"
		| "blocked"
		| "failed"
		| "cancelled"
		| "rolled-back"
		| "cleanup-failed";
	changed: boolean;
	diagnostics: readonly SystemDiagnostic[];
};
export type HealthState =
	| "unknown"
	| "checking"
	| "healthy"
	| "degraded"
	| "unhealthy";
export type OperationSnapshot = {
	id: string;
	type: "start" | "stop" | "restart" | "task" | "dispose";
	status:
		| "pending"
		| "running"
		| "completed"
		| "partially-completed"
		| "failed"
		| "cancelled";
	requestedNodes: readonly string[];
	affectedNodes: readonly string[];
	startedAt?: string;
	completedAt?: string;
	correlationId: string;
	diagnostics: readonly SystemDiagnostic[];
	results: readonly NodeOperationResult[];
};
export type NodeSnapshot = {
	id: string;
	kind: SystemNode["kind"];
	state: LifecycleState;
	health: HealthState;
	runtime?: string;
	pid?: number;
	restartCount: number;
	consecutiveSuccesses: number;
	consecutiveFailures: number;
	lastCheckAt?: string;
	lastSuccessfulCheckAt?: string;
	lastFailedCheckAt?: string;
	lastHealthDiagnostic?: string;
	healthProviderId?: string;
	exit?: {
		code: number | null;
		signal: string | null;
		timestamp: string;
		expected: boolean;
		duringManualStop: boolean;
	};
	restartPending: boolean;
	currentRestartAttempt: number;
	nextRestartAt?: string;
};
export type ControlPlaneSnapshot = {
	revision: number;
	generatedAt: string;
	workspace: { name: string; root: string };
	nodes: readonly NodeSnapshot[];
	operations: readonly OperationSnapshot[];
	artifacts: readonly ArtifactRecord[];
	diagnostics: readonly SystemDiagnostic[];
	events: { size: number };
	plugins: readonly string[];
	providers: readonly { id: string; kind: "runtime" }[];
};
export type ControlPlaneOptions = {
	root?: string;
	config?: string;
	providers?: RuntimeProvider[];
	allowMutations?: boolean;
};
export class WsrtControlPlane {
	readonly #events: WorkspaceEvent[] = [];
	readonly #artifacts = new Map<string, ArtifactRecord>();
	readonly #handles = new Map<string, ProcessHandle>();
	readonly #runtimes = new Map<string, RuntimeInstance>();
	readonly #operations: OperationSnapshot[] = [];
	readonly #subscribers = new Set<(snapshot: ControlPlaneSnapshot) => void>();
	readonly #health = new Map<string, HealthState>();
	readonly #healthDetails = new Map<
		string,
		Omit<NodeSnapshot, "id" | "kind" | "state" | "health" | "runtime" | "pid">
	>();
	readonly #monitors = new Map<string, AbortController>();
	readonly #generations = new Map<string, number>();
	readonly #restartControllers = new Map<string, AbortController>();
	readonly #operationControllers = new Map<string, AbortController>();
	readonly #nodeOperations = new Map<string, string>();
	readonly #manualStops = new Set<string>();
	#disposed = false;
	#revision = 0;
	#definition?: NormalizedSystemDefinition;
	#graph?: SystemGraph;
	#engine?: LifecycleEngine;
	#diagnostics: SystemDiagnostic[] = [];
	#providerIds: string[] = [];
	constructor(readonly options: ControlPlaneOptions = {}) {}
	async load(): Promise<NormalizedSystemDefinition> {
		const loaded = await loadSystemDefinition(
			this.options.root,
			this.options.config,
		);
		this.#diagnostics = [...loaded.diagnostics];
		if (!loaded.definition)
			throw new Error(this.#diagnostics.map((d) => d.message).join("\n"));
		this.#definition = loaded.definition;
		this.#graph = compileSystemGraph(loaded.definition);
		for (const issue of this.#graph.validate())
			this.#diagnostics.push({
				code: `graph.${issue.code}`,
				severity: "error",
				message: issue.message,
				source: {
					file: loaded.definition.sourceFile,
					path: issue.path.join("."),
				},
			});
		const providers = this.options.providers ?? [new NodeRuntimeProvider(), new RustRuntimeProvider()];
		this.#providerIds = providers.map((provider) => provider.id).sort();
		for (const runtime of Object.values(loaded.definition.runtimes)) {
			if (this.#runtimes.has(runtime.provider)) continue;
			const provider = providers.find((item) => item.id === runtime.provider);
			if (!provider)
				throw new Error(`Runtime provider not registered: ${runtime.provider}`);
			this.#runtimes.set(runtime.provider, await provider.create());
		}
		this.#engine = new LifecycleEngine(this.#graph, {
			onEvent: (event) => {
				this.#events.push(event);
				this.#changed();
			},
		});
		for (const executable of loaded.definition.executables)
			this.#engine.register(executable.id, this.#handler(executable));
		for (const artifact of loaded.definition.artifacts)
			this.#artifacts.set(artifact.id, {
				id: artifact.id,
				type: artifact.type,
				producer: artifact.producer,
				consumers: artifact.consumers,
				location: artifact.location,
				status: "pending",
				metadata: artifact.metadata,
			});
		return loaded.definition;
	}
	definition(): NormalizedSystemDefinition {
		return required(this.#definition, "Control plane is not loaded");
	}
	graph(): SystemGraph {
		return required(this.#graph, "Control plane is not loaded");
	}
	validate(): readonly SystemDiagnostic[] {
		return this.#diagnostics;
	}
	plan(ids?: readonly string[]): ExecutionPlan {
		return this.graph().plan(ids ? this.#closure(ids) : this.#executableIds());
	}
	getNode(id: string): SystemNode | undefined {
		return this.graph().node(id);
	}
	getNodeState(id: string): LifecycleState | undefined {
		try {
			return this.#engine?.state(id);
		} catch {
			return undefined;
		}
	}
	getDependencies(id: string) {
		return this.graph().dependencies(id);
	}
	getConsumers(id: string) {
		return this.graph().consumers(id);
	}
	listEvents() {
		return [...this.#events];
	}
	listArtifacts() {
		return [...this.#artifacts.values()];
	}
	snapshot(): ControlPlaneSnapshot {
		const definition = this.definition();
		const nodes = definition.executables
			.map((item) =>
				Object.freeze({
					id: item.id,
					kind: item.kind,
					state: this.getNodeState(item.id) ?? "resolved",
					health: this.#health.get(item.id) ?? "unknown",
					runtime: item.runtime,
					pid: this.#handles.get(item.id)?.pid,
					restartCount: 0,
					consecutiveSuccesses: 0,
					consecutiveFailures: 0,
					restartPending: false,
					currentRestartAttempt: 0,
					...this.#healthDetails.get(item.id),
				}),
			)
			.sort((a, b) => a.id.localeCompare(b.id));
		return Object.freeze({
			revision: this.#revision,
			generatedAt: new Date().toISOString(),
			workspace: Object.freeze({
				name: definition.name,
				root: definition.root,
			}),
			nodes: Object.freeze(nodes),
			operations: Object.freeze(
				this.#operations.map((item) =>
					Object.freeze({
						...item,
						requestedNodes: Object.freeze([...item.requestedNodes]),
						affectedNodes: Object.freeze([...item.affectedNodes]),
						diagnostics: Object.freeze([...item.diagnostics]),
						results: Object.freeze(
							item.results.map((result) =>
								Object.freeze({
									...result,
									diagnostics: Object.freeze([...result.diagnostics]),
								}),
							),
						),
					}),
				),
			),
			artifacts: Object.freeze(
				this.listArtifacts()
					.sort((a, b) => a.id.localeCompare(b.id))
					.map((item) =>
						Object.freeze({
							...item,
							consumers: Object.freeze([...item.consumers]),
							diagnostics: Object.freeze([...(item.diagnostics ?? [])]),
							metadata: Object.freeze({ ...item.metadata }),
						}),
					),
			),
			diagnostics: Object.freeze([...this.#diagnostics]),
			events: Object.freeze({ size: this.#events.length }),
			plugins: Object.freeze(
				definition.plugins
					.map((plugin) =>
						typeof plugin === "string" ? plugin : plugin.provider,
					)
					.sort(),
			),
			providers: Object.freeze(
				this.#providerIds.map((id) =>
					Object.freeze({ id, kind: "runtime" as const }),
				),
			),
		});
	}
	subscribeSnapshots(
		listener: (snapshot: ControlPlaneSnapshot) => void,
	): () => void {
		this.#subscribers.add(listener);
		if (!this.#disposed) {
			try {
				listener(this.snapshot());
			} catch {}
		}
		return () => this.#subscribers.delete(listener);
	}
	listOperations(): readonly OperationSnapshot[] {
		return Object.freeze([...this.#operations]);
	}
	getOperation(id: string): OperationSnapshot | undefined {
		return this.#operations.find((item) => item.id === id);
	}
	cancelOperation(id: string): boolean {
		const controller = this.#operationControllers.get(id);
		if (!controller || controller.signal.aborted) return false;
		controller.abort(new DOMException("Operation cancelled", "AbortError"));
		this.#event("operation.cancelled", id, id, { operationId: id });
		return true;
	}
	async start(ids?: readonly string[]): Promise<OperationResult> {
		this.#assertMutable();
		const targets =
			ids?.map((id) => this.#resolve(id)) ?? this.#longRunningIds();
		const selected = this.#closure(targets);
		return this.#operate("start", targets, selected, async (signal) =>
			required(this.#engine, "Control plane is not loaded").start(
				selected,
				signal,
			),
		);
	}
	async stop(ids?: readonly string[]): Promise<OperationResult> {
		this.#assertMutable();
		const targets =
			ids?.map((id) => this.#resolve(id)) ?? this.#executableIds();
		const selected = this.#dependants(targets);
		for (const node of selected) {
			this.#manualStops.add(node);
			this.#cancelRestart(node, "manual stop");
			this.#stopMonitor(node);
		}
		return this.#operate("stop", targets, selected, async (signal) =>
			required(this.#engine, "Control plane is not loaded").stop(
				selected,
				signal,
			),
		);
	}
	async restart(ids: readonly string[]): Promise<OperationResult> {
		this.#assertMutable();
		const targets = ids.map((id) => this.#resolve(id)),
			selected = this.#dependants(targets);
		for (const node of selected) {
			this.#manualStops.add(node);
			this.#cancelRestart(node, "manual restart");
			this.#stopMonitor(node);
		}
		return this.#operate("restart", targets, selected, async (signal) => {
			await required(this.#engine, "Control plane is not loaded").stop(
				selected,
				signal,
			);
			for (const node of selected) this.#manualStops.delete(node);
			await required(this.#engine, "Control plane is not loaded").start(
				this.#closure(targets),
				signal,
			);
		});
	}
	async runTask(id: string): Promise<OperationResult> {
		const resolved = this.#resolve(id, "task");
		return this.#operate(
			"task",
			[resolved],
			this.#closure([resolved]),
			async (signal) =>
				required(this.#engine, "Control plane is not loaded").start(
					this.#closure([resolved]),
					signal,
				),
		);
	}
	async dispose(): Promise<void> {
		this.#disposed = true;
		for (const controller of this.#operationControllers.values())
			controller.abort(
				new DOMException("Control plane disposed", "AbortError"),
			);
		for (const controller of this.#monitors.values()) controller.abort();
		for (const controller of this.#restartControllers.values())
			controller.abort(
				new DOMException("Control plane disposed", "AbortError"),
			);
		this.#monitors.clear();
		if (this.#engine)
			await this.#engine.stop(this.#executableIds()).catch(() => {});
		await Promise.all(
			[...this.#runtimes.values()].map((runtime) => runtime.dispose()),
		);
		this.#runtimes.clear();
		this.#subscribers.clear();
	}
	#handler(item: NormalizedExecutable) {
		const runtime = () =>
			required(
				this.#runtimes.get(this.definition().runtimes[item.runtime].provider),
				`Runtime unavailable: ${item.runtime}`,
			);
		return {
			start: async ({ signal }: { signal: AbortSignal }) => {
				if (!item.command) return;
				const handle = runtime().capabilities.require("spawn").spawn({
					command: item.command.command,
					args: item.command.args,
					cwd: item.root,
					environment: item.environment,
					shell: item.command.shell,
					signal,
				});
				this.#handles.set(item.id, handle);
				if (item.kind === "task") {
					await this.#invalidateOutputs(item);
					const exit = await handle.exit;
					if (exit.code !== 0) {
						await this.#failOutputs(
							item,
							`Task ${item.name} exited with code ${exit.code}`,
						);
						throw new Error(`Task ${item.name} exited with code ${exit.code}`);
					}
					await this.#verifyOutputs(item);
				} else {
					void handle.exit.then((exit) =>
						this.#processExited(item, handle, exit),
					);
				}
			},
			stop: async () => {
				this.#stopMonitor(item.id);
				const handle = this.#handles.get(item.id);
				if (!handle?.running) {
					this.#manualStops.delete(item.id);
					return;
				}
				handle.terminate();
				await Promise.race([
					handle.exit,
					runtime().capabilities.require("timers").delay(3000),
				]);
				if (handle.running) handle.terminate("SIGKILL");
				await handle.exit;
				this.#handles.delete(item.id);
				this.#manualStops.delete(item.id);
			},
			ready: async ({ signal }: { signal: AbortSignal }) => {
				if (item.kind === "task") return;
				if (!item.healthcheck) {
					this.#setHealth(item.id, "healthy");
					return;
				}
				const health = item.healthcheck;
				if (health.type === "process") {
					if (!this.#handles.get(item.id)?.running)
						throw new Error(`Process ${item.name} is not running`);
					this.#startMonitor(item);
					return;
				}
				const timers = runtime().capabilities.require("timers");
				let last: unknown;
				for (let attempt = 0; attempt < (health.retries ?? 20); attempt++) {
					try {
						if (health.type === "tcp")
							await runtime()
								.capabilities.require("network")
								.connect(health.host ?? "127.0.0.1", health.port, {
									timeoutMs: health.timeoutMs ?? 2000,
									signal,
								});
						else {
							const response = await runtime()
								.capabilities.require("http")
								.fetch(health.url, {
									signal: AbortSignal.timeout(health.timeoutMs ?? 2000),
								});
							if (!response.ok) throw new Error(`HTTP ${response.status}`);
						}
						this.#startMonitor(item);
						return;
					} catch (cause) {
						last = cause;
					}
					await timers.delay(health.intervalMs ?? 250, signal);
				}
				throw last ?? new Error(`Readiness failed for ${item.name}`);
			},
		};
	}
	#startMonitor(item: NormalizedExecutable): void {
		this.#stopMonitor(item.id);
		const controller = new AbortController(),
			generation = (this.#generations.get(item.id) ?? 0) + 1;
		this.#generations.set(item.id, generation);
		this.#monitors.set(item.id, controller);
		this.#setHealth(item.id, "checking");
		void (async () => {
			while (
				!controller.signal.aborted &&
				this.#handles.get(item.id)?.running
			) {
				const started = new Date().toISOString();
				this.#event("node.health.check.started", item.id, item.id, {});
				let diagnostic: string | undefined;
				try {
					await this.#checkHealth(item, controller.signal);
				} catch (cause) {
					diagnostic = cause instanceof Error ? cause.message : String(cause);
				}
				if (
					controller.signal.aborted ||
					this.#generations.get(item.id) !== generation ||
					this.#disposed
				)
					break;
				const previous = this.#healthDetails.get(item.id) ?? {
					restartCount: 0,
					consecutiveSuccesses: 0,
					consecutiveFailures: 0,
					restartPending: false,
					currentRestartAttempt: 0,
				};
				const successes = diagnostic ? 0 : previous.consecutiveSuccesses + 1,
					failures = diagnostic ? previous.consecutiveFailures + 1 : 0;
				const unhealthyThreshold = item.healthcheck?.unhealthyThreshold ?? 3,
					healthyThreshold = item.healthcheck?.healthyThreshold ?? 1;
				const old = this.#health.get(item.id) ?? "unknown";
				const health: HealthState = diagnostic
					? failures >= unhealthyThreshold
						? "unhealthy"
						: "degraded"
					: successes >= healthyThreshold
						? "healthy"
						: old === "unhealthy"
							? "degraded"
							: "checking";
				this.#healthDetails.set(item.id, {
					...previous,
					consecutiveSuccesses: successes,
					consecutiveFailures: failures,
					lastCheckAt: started,
					...(diagnostic
						? { lastFailedCheckAt: started, lastHealthDiagnostic: diagnostic }
						: {
								lastSuccessfulCheckAt: started,
								lastHealthDiagnostic: undefined,
							}),
					healthProviderId: item.healthcheck?.type,
				});
				this.#event(
					diagnostic
						? "node.health.check.failed"
						: "node.health.check.succeeded",
					item.id,
					item.id,
					diagnostic ? { diagnostic } : {},
				);
				this.#setHealth(item.id, health);
				if (
					health === "unhealthy" &&
					old !== "unhealthy" &&
					item.restart.policy !== "never" &&
					item.restart.restartOnUnhealthy
				)
					void this.#scheduleRestart(item, "unhealthy");
				try {
					await this.#runtime(item)
						.capabilities.require("timers")
						.delay(
							item.healthcheck && "intervalMs" in item.healthcheck
								? (item.healthcheck.intervalMs ?? 5000)
								: 5000,
							controller.signal,
						);
				} catch {
					break;
				}
			}
		})();
	}
	async #checkHealth(
		item: NormalizedExecutable,
		signal: AbortSignal,
	): Promise<void> {
		const health = item.healthcheck;
		if (!health || health.type === "process") {
			if (!this.#handles.get(item.id)?.running)
				throw new Error("Process exited");
			return;
		}
		if (health.type === "tcp")
			return this.#runtime(item)
				.capabilities.require("network")
				.connect(health.host ?? "127.0.0.1", health.port, {
					timeoutMs: health.timeoutMs ?? 2000,
					signal,
				});
		const timeout = AbortSignal.timeout(health.timeoutMs ?? 2000),
			combined = AbortSignal.any([signal, timeout]);
		const response = await this.#runtime(item)
			.capabilities.require("http")
			.fetch(health.url, { signal: combined });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
	}
	#runtime(item: NormalizedExecutable) {
		return required(
			this.#runtimes.get(this.definition().runtimes[item.runtime].provider),
			`Runtime unavailable: ${item.runtime}`,
		);
	}
	#stopMonitor(id: string) {
		this.#generations.set(id, (this.#generations.get(id) ?? 0) + 1);
		this.#monitors.get(id)?.abort();
		this.#monitors.delete(id);
	}
	#setHealth(id: string, health: HealthState) {
		const old = this.#health.get(id) ?? "unknown";
		if (old === health) return;
		this.#health.set(id, health);
		if (health === "degraded") this.#event("node.health.degraded", id, id, {});
		if (health === "unhealthy")
			this.#event("node.health.unhealthy", id, id, {});
		if (health === "healthy" && ["degraded", "unhealthy"].includes(old))
			this.#event("node.health.recovered", id, id, {});
		this.#changed();
	}
	async #processExited(
		item: NormalizedExecutable,
		handle: ProcessHandle,
		exit: { code: number | null; signal: string | null },
	) {
		if (this.#handles.get(item.id) !== handle) return;
		this.#handles.delete(item.id);
		this.#stopMonitor(item.id);
		const manual = this.#manualStops.has(item.id),
			expected = manual || this.#disposed;
		const previous = this.#details(item.id),
			correlationId = crypto.randomUUID();
		this.#healthDetails.set(item.id, {
			...previous,
			exit: {
				...exit,
				timestamp: new Date().toISOString(),
				expected,
				duringManualStop: manual,
			},
		});
		try {
			this.#engine?.processExited(item.id, expected, correlationId);
		} catch {}
		this.#setHealth(item.id, expected ? "unknown" : "unhealthy");
		this.#event(
			expected ? "node.process.exited" : "node.process.unexpected-exit",
			item.id,
			correlationId,
			{ ...exit, expected },
		);
		if (expected) this.#manualStops.delete(item.id);
		else await this.#scheduleRestart(item, "exit", exit);
	}
	async #scheduleRestart(
		item: NormalizedExecutable,
		reason: string,
		exit?: { code: number | null; signal: string | null },
	) {
		const policy = item.restart;
		if (
			policy.policy === "never" ||
			(policy.policy === "on-failure" && exit?.code === 0 && !exit.signal)
		)
			return;
		if (
			this.#restartControllers.has(item.id) ||
			this.#disposed ||
			this.#manualStops.has(item.id)
		)
			return;
		const previous = this.#details(item.id),
			attempt = previous.currentRestartAttempt + 1,
			attempts = policy.attempts ?? 3;
		if (attempt > attempts) {
			this.#healthDetails.set(item.id, {
				...previous,
				restartPending: false,
				nextRestartAt: undefined,
			});
			this.#event("node.restart.exhausted", item.id, item.id, { attempts });
			this.#changed();
			return;
		}
		const base = Math.max(0, policy.delayMs ?? 1000),
			maximum = Math.max(base, policy.maximumDelayMs ?? 30_000),
			exponential = base * 2 ** Math.min(attempt - 1, 30),
			delay = Math.min(
				policy.backoff === "exponential" ? exponential : base,
				maximum,
			);
		const controller = new AbortController();
		this.#restartControllers.set(item.id, controller);
		this.#healthDetails.set(item.id, {
			...previous,
			restartPending: true,
			currentRestartAttempt: attempt,
			nextRestartAt: new Date(Date.now() + delay).toISOString(),
		});
		this.#event("node.restart.scheduled", item.id, item.id, {
			attempt,
			delay,
			reason,
		});
		this.#changed();
		try {
			await this.#runtime(item)
				.capabilities.require("timers")
				.delay(delay, controller.signal);
			if (
				controller.signal.aborted ||
				this.#disposed ||
				this.#manualStops.has(item.id)
			)
				throw (
					controller.signal.reason ??
					new DOMException("Restart cancelled", "AbortError")
				);
			this.#event("node.restart.started", item.id, item.id, { attempt });
			this.#restartControllers.delete(item.id);
			await this.start([item.id]);
			const current = this.#details(item.id);
			this.#healthDetails.set(item.id, {
				...current,
				restartPending: false,
				restartCount: current.restartCount + 1,
				nextRestartAt: undefined,
			});
			this.#event("node.restart.completed", item.id, item.id, { attempt });
			this.#changed();
		} catch (cause) {
			const cancelled =
				controller.signal.aborted ||
				this.#disposed ||
				this.#manualStops.has(item.id);
			const current = this.#details(item.id);
			this.#healthDetails.set(item.id, {
				...current,
				restartPending: false,
				nextRestartAt: undefined,
			});
			this.#event(
				cancelled ? "node.restart.cancelled" : "node.restart.failed",
				item.id,
				item.id,
				{ attempt, error: String(cause) },
			);
			this.#changed();
		} finally {
			if (this.#restartControllers.get(item.id) === controller)
				this.#restartControllers.delete(item.id);
		}
	}
	#cancelRestart(id: string, reason: string) {
		const controller = this.#restartControllers.get(id);
		if (!controller) return;
		controller.abort(new DOMException(reason, "AbortError"));
		this.#restartControllers.delete(id);
	}
	#details(id: string) {
		return (
			this.#healthDetails.get(id) ?? {
				restartCount: 0,
				consecutiveSuccesses: 0,
				consecutiveFailures: 0,
				restartPending: false,
				currentRestartAttempt: 0,
			}
		);
	}
	async #invalidateOutputs(item: NormalizedExecutable) {
		for (const artifact of this.#artifacts.values())
			if (
				artifact.producer === item.name ||
				item.outputs.some((o) => `artifact:${o.artifact}` === artifact.id)
			) {
				const now = new Date().toISOString();
				this.#artifacts.set(artifact.id, {
					...artifact,
					status: "invalid",
					invalidatedAt: now,
				});
				this.#event("artifact.invalidated", artifact.id, item.id, {});
			}
		this.#changed();
	}
	async #failOutputs(item: NormalizedExecutable, message: string) {
		for (const artifact of this.#artifacts.values())
			if (artifact.producer === item.name)
				this.#artifacts.set(artifact.id, {
					...artifact,
					status: "failed",
					diagnostics: [
						{
							code: "WSRT_ARTIFACT_GENERATION_FAILED",
							severity: "error",
							message,
							source: item.source,
						},
					],
				});
		this.#changed();
	}
	async #verifyOutputs(item: NormalizedExecutable) {
		const outputs = item.outputs.length
			? item.outputs
			: [...this.#artifacts.values()]
					.filter((a) => a.producer === item.name && a.location)
					.map((a) => ({
						artifact: a.id.replace(/^artifact:/, ""),
						path: a.location ?? "",
					}));
		for (const output of outputs) {
			const id = `artifact:${output.artifact}`,
				artifact = this.#artifacts.get(id);
			if (!artifact) throw new Error(`WSRT_ARTIFACT_OUTPUT_MISSING: ${id}`);
			const file = path.resolve(item.root, output.path);
			if (
				!file.startsWith(`${this.definition().root}${path.sep}`) &&
				file !== this.definition().root
			)
				throw new Error(`WSRT_ARTIFACT_PATH_INVALID: ${file}`);
			let bytes: Uint8Array;
			try {
				bytes = await fs.readFile(file);
			} catch {
				await this.#failOutputs(
					item,
					`Declared output does not exist: ${file}`,
				);
				throw new Error(`WSRT_ARTIFACT_OUTPUT_MISSING: ${file}`);
			}
			const hash = createHash("sha256").update(bytes).digest("hex"),
				now = new Date().toISOString(),
				unchanged = artifact.hash === hash;
			this.#artifacts.set(id, {
				...artifact,
				location: file,
				status: unchanged ? "unchanged" : "ready",
				hash,
				size: bytes.byteLength,
				createdAt: artifact.createdAt ?? now,
				updatedAt: now,
				diagnostics: [],
			});
			this.#event(
				unchanged ? "artifact.unchanged" : "artifact.generated",
				id,
				item.id,
				{ hash, size: bytes.byteLength },
			);
		}
		this.#changed();
	}
	#event(
		type: string,
		source: string,
		correlationId: string,
		payload: unknown,
	) {
		this.#events.push({
			id: crypto.randomUUID(),
			type,
			timestamp: new Date().toISOString(),
			source,
			correlationId,
			payload,
		});
		if (this.#events.length > 1000) this.#events.shift();
	}
	#resolve(value: string, kind?: NormalizedExecutable["kind"]) {
		const match = this.definition().executables.find(
			(item) => item.id === value || item.name === value,
		);
		if (!match || (kind && match.kind !== kind))
			throw new Error(`Unknown ${kind ?? "executable"}: ${value}`);
		return match.id;
	}
	#executableIds() {
		return this.definition().executables.map((item) => item.id);
	}
	#longRunningIds() {
		return this.definition()
			.executables.filter(
				(item) => item.kind !== "task" && !item.id.includes("/process:"),
			)
			.map((item) => item.id);
	}
	#closure(ids: readonly string[]) {
		const result = new Set(ids),
			visit = (id: string) => {
				const related = [
					...this.graph().dependencies(id),
					...this.graph().neighbors(id, "out", "contains"),
				];
				for (const node of related)
					if (node.kind !== "artifact" && !result.has(node.id)) {
						result.add(node.id);
						visit(node.id);
					}
			};
		for (const id of ids) visit(id);
		return [...result];
	}
	#dependants(ids: readonly string[]) {
		const result = new Set(ids),
			visit = (id: string) => {
				const related = [
					...this.graph().consumers(id),
					...this.graph().neighbors(id, "out", "contains"),
				];
				for (const node of related)
					if (!result.has(node.id)) {
						result.add(node.id);
						visit(node.id);
					}
			};
		for (const id of ids) visit(id);
		return [...result];
	}
	#result(operationId: string, ids: readonly string[]): OperationResult {
		return {
			operationId,
			nodes: ids,
			states: Object.fromEntries(
				ids.map((id) => [id, this.getNodeState(id) ?? "resolved"]),
			),
			status: "completed",
			results: ids.map((nodeId) => ({
				nodeId,
				status: "completed",
				changed: true,
				diagnostics: [],
			})),
		};
	}
	async #operate(
		type: OperationSnapshot["type"],
		requested: readonly string[],
		affected: readonly string[],
		run: (signal: AbortSignal) => Promise<void>,
	): Promise<OperationResult> {
		const conflict = affected
			.map((node) => this.#nodeOperations.get(node))
			.find(Boolean);
		if (conflict)
			throw new Error(
				`WSRT_OPERATION_CONFLICT: operation ${conflict} is running`,
			);
		const id = crypto.randomUUID(),
			correlationId = crypto.randomUUID(),
			startedAt = new Date().toISOString();
		let operation: OperationSnapshot = Object.freeze({
			id,
			type,
			status: "running",
			requestedNodes: Object.freeze([...requested]),
			affectedNodes: Object.freeze([...affected]),
			startedAt,
			correlationId,
			diagnostics: Object.freeze([]),
			results: Object.freeze([]),
		});
		this.#operations.push(operation);
		if (this.#operations.length > 100) this.#operations.shift();
		const controller = new AbortController();
		this.#operationControllers.set(id, controller);
		for (const node of affected) this.#nodeOperations.set(node, id);
		this.#changed();
		try {
			if (controller.signal.aborted) throw controller.signal.reason;
			await run(controller.signal);
			if (controller.signal.aborted) throw controller.signal.reason;
			const results = affected.map((nodeId) =>
				Object.freeze({
					nodeId,
					status: "completed" as const,
					changed: true,
					diagnostics: Object.freeze([]),
				}),
			);
			operation = Object.freeze({
				...operation,
				status: "completed",
				completedAt: new Date().toISOString(),
				results: Object.freeze(results),
			});
			return { ...this.#result(id, affected), results };
		} catch (cause) {
			const cancelled =
				controller.signal.aborted ||
				(cause instanceof DOMException && cause.name === "AbortError");
			const diagnostic: SystemDiagnostic = {
				code: cancelled
					? "WSRT_OPERATION_CANCELLED"
					: "WSRT_OPERATION_PARTIAL_FAILURE",
				severity: "error",
				message: cause instanceof Error ? cause.message : String(cause),
				source: { file: this.definition().sourceFile, path: "" },
			};
			operation = Object.freeze({
				...operation,
				status: cancelled ? "cancelled" : "failed",
				completedAt: new Date().toISOString(),
				diagnostics: Object.freeze([diagnostic]),
				results: Object.freeze(
					affected.map((nodeId) =>
						Object.freeze({
							nodeId,
							status: cancelled ? ("cancelled" as const) : ("failed" as const),
							changed: false,
							diagnostics: Object.freeze([diagnostic]),
						}),
					),
				),
			});
			if (!cancelled) throw cause;
			return {
				...this.#result(id, affected),
				status: "cancelled",
				results: operation.results,
			};
		} finally {
			const index = this.#operations.findIndex((item) => item.id === id);
			if (index >= 0) this.#operations[index] = operation;
			this.#operationControllers.delete(id);
			for (const node of affected)
				if (this.#nodeOperations.get(node) === id)
					this.#nodeOperations.delete(node);
			this.#changed();
		}
	}
	#changed(): void {
		this.#revision += 1;
		const snapshot = this.snapshot();
		for (const subscriber of this.#subscribers) {
			try {
				subscriber(snapshot);
			} catch {}
		}
	}
	#assertMutable() {
		if (this.options.allowMutations === false)
			throw new Error("Mutating control-plane operations are disabled");
	}
}
function required<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
}
export async function createControlPlane(
	options: ControlPlaneOptions = {},
): Promise<WsrtControlPlane> {
	const plane = new WsrtControlPlane(options);
	await plane.load();
	return plane;
}

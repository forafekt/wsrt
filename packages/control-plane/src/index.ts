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
	status: "pending" | "generating" | "ready" | "failed";
	hash?: string;
	metadata: Readonly<Record<string, unknown>>;
};
export type OperationResult = {
	operationId: string;
	nodes: readonly string[];
	states: Readonly<Record<string, LifecycleState>>;
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
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	requestedNodes: readonly string[];
	affectedNodes: readonly string[];
	startedAt?: string;
	completedAt?: string;
	correlationId: string;
	diagnostics: readonly SystemDiagnostic[];
};
export type NodeSnapshot = {
	id: string;
	kind: SystemNode["kind"];
	state: LifecycleState;
	health: HealthState;
	runtime?: string;
	pid?: number;
	restartCount: number;
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
	#revision = 0;
	#activeOperation?: string;
	#definition?: NormalizedSystemDefinition;
	#graph?: SystemGraph;
	#engine?: LifecycleEngine;
	#diagnostics: SystemDiagnostic[] = [];
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
		const providers = this.options.providers ?? [new NodeRuntimeProvider()];
		for (const runtime of Object.values(loaded.definition.runtimes)) {
			const provider = providers.find((item) => item.id === runtime.provider);
			if (!provider)
				throw new Error(`Runtime provider not registered: ${runtime.provider}`);
			this.#runtimes.set(runtime.provider, await provider.create());
		}
		this.#engine = new LifecycleEngine(this.#graph, {
			onEvent: (event) => this.#events.push(event),
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
				this.#operations.map((item) => Object.freeze({ ...item })),
			),
			artifacts: Object.freeze(
				this.listArtifacts().map((item) => Object.freeze({ ...item })),
			),
			diagnostics: Object.freeze([...this.#diagnostics]),
			events: Object.freeze({ size: this.#events.length }),
		});
	}
	subscribeSnapshots(
		listener: (snapshot: ControlPlaneSnapshot) => void,
	): () => void {
		this.#subscribers.add(listener);
		listener(this.snapshot());
		return () => this.#subscribers.delete(listener);
	}
	listOperations(): readonly OperationSnapshot[] {
		return Object.freeze([...this.#operations]);
	}
	async start(ids?: readonly string[]): Promise<OperationResult> {
		this.#assertMutable();
		const targets =
			ids?.map((id) => this.#resolve(id)) ?? this.#longRunningIds();
		const selected = this.#closure(targets);
		return this.#operate("start", targets, selected, async () =>
			required(this.#engine, "Control plane is not loaded").start(selected),
		);
	}
	async stop(ids?: readonly string[]): Promise<OperationResult> {
		this.#assertMutable();
		const targets =
			ids?.map((id) => this.#resolve(id)) ?? this.#executableIds();
		const selected = this.#dependants(targets);
		return this.#operate("stop", targets, selected, async () =>
			required(this.#engine, "Control plane is not loaded").stop(selected),
		);
	}
	async restart(ids: readonly string[]): Promise<OperationResult> {
		await this.stop(ids);
		return this.start(ids);
	}
	async runTask(id: string): Promise<OperationResult> {
		const resolved = this.#resolve(id, "task");
		return this.#operate(
			"task",
			[resolved],
			this.#closure([resolved]),
			async () =>
				required(this.#engine, "Control plane is not loaded").start(
					this.#closure([resolved]),
				),
		);
	}
	async dispose(): Promise<void> {
		if (this.#engine)
			await this.#engine.stop(this.#executableIds()).catch(() => {});
		await Promise.all(
			[...this.#runtimes.values()].map((runtime) => runtime.dispose()),
		);
		this.#runtimes.clear();
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
					const exit = await handle.exit;
					if (exit.code !== 0)
						throw new Error(`Task ${item.name} exited with code ${exit.code}`);
					for (const artifact of this.#artifacts.values())
						if (artifact.producer === item.name)
							this.#artifacts.set(artifact.id, {
								...artifact,
								status: "ready",
							});
				}
			},
			stop: async () => {
				const handle = this.#handles.get(item.id);
				if (!handle?.running) return;
				handle.terminate();
				await Promise.race([
					handle.exit,
					runtime().capabilities.require("timers").delay(3000),
				]);
				if (handle.running) handle.terminate("SIGKILL");
				await handle.exit;
				this.#handles.delete(item.id);
			},
			ready: async ({ signal }: { signal: AbortSignal }) => {
				if (item.kind === "task" || !item.healthcheck) return;
				const health = item.healthcheck;
				if (health.type === "process") {
					if (!this.#handles.get(item.id)?.running)
						throw new Error(`Process ${item.name} is not running`);
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
		};
	}
	async #operate(
		type: OperationSnapshot["type"],
		requested: readonly string[],
		affected: readonly string[],
		run: () => Promise<void>,
	): Promise<OperationResult> {
		if (this.#activeOperation)
			throw new Error(
				`WSRT_OPERATION_CONFLICT: operation ${this.#activeOperation} is running`,
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
		});
		this.#operations.push(operation);
		if (this.#operations.length > 100) this.#operations.shift();
		this.#activeOperation = id;
		this.#changed();
		try {
			await run();
			operation = Object.freeze({
				...operation,
				status: "completed",
				completedAt: new Date().toISOString(),
			});
			return this.#result(id, affected);
		} catch (cause) {
			const diagnostic: SystemDiagnostic = {
				code: "WSRT_OPERATION_PARTIAL_FAILURE",
				severity: "error",
				message: cause instanceof Error ? cause.message : String(cause),
				source: { file: this.definition().sourceFile, path: "" },
			};
			operation = Object.freeze({
				...operation,
				status: "failed",
				completedAt: new Date().toISOString(),
				diagnostics: Object.freeze([diagnostic]),
			});
			throw cause;
		} finally {
			const index = this.#operations.findIndex((item) => item.id === id);
			if (index >= 0) this.#operations[index] = operation;
			this.#activeOperation = undefined;
			this.#changed();
		}
	}
	#changed(): void {
		this.#revision += 1;
		const snapshot = this.snapshot();
		for (const subscriber of this.#subscribers) subscriber(snapshot);
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

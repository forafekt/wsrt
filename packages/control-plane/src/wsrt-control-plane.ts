import path from "node:path";
import type { NormalizedExecutable, NormalizedSystemDefinition } from "@wsrt/config";
import type { ExecutionPlan, SystemNode } from "@wsrt/graph";
import type { LifecycleState } from "@wsrt/lifecycle";
import { type PersistenceProvider, pluginStorage } from "@wsrt/persistence";
import type { PluginContext, PluginContributions } from "@wsrt/plugins";
import { ArtifactManager } from "./artifact-manager.js";
import { CompletionService } from "./completion-service.js";
import { ControlPlaneLoader } from "./control-plane-loader.js";
import { ControlPlaneState } from "./control-plane-state.js";
import { EventJournal } from "./event-journal.js";
import { ExecutionManager } from "./execution-manager.js";
import { GraphSelector } from "./graph-selector.js";
import { HealthManager } from "./health-manager.js";
import { OperationManager } from "./operation-manager.js";
import { PersistenceManager } from "./persistence-manager.js";
import { PluginManager } from "./plugin-manager.js";
import { SnapshotManager } from "./snapshot-manager.js";
import type {
	ControlPlaneOptions,
	ControlPlaneSnapshot,
	OperationResult,
	SubmittedOperation,
} from "./types.js";
import { required } from "./utils.js";

export class WsrtControlPlane {
	readonly #state = new ControlPlaneState();
	readonly #selector = new GraphSelector(this.#state);
	readonly #snapshot: SnapshotManager;
	readonly #persistence: PersistenceManager;
	readonly #events: EventJournal;
	readonly #operations: OperationManager;
	readonly #health: HealthManager;
	readonly #loader: ControlPlaneLoader;
	readonly #completion: CompletionService;
	readonly #plugins: PluginManager;
	readonly #execution: ExecutionManager;
	readonly #artifacts = new ArtifactManager(this.#state);

	constructor(readonly options: ControlPlaneOptions = {}) {
		this.#snapshot = new SnapshotManager(
			this.#state,
			(id) => this.getNodeState(id),
			() => this.#persistence.scheduleSnapshot(),
		);

		this.#persistence = new PersistenceManager(this.#state, options, () => this.snapshot());

		this.#events = new EventJournal(this.#state, {
			persist: (event) => this.#persistence.persistEvent(event),
			changed: () => this.#snapshot.changed(),
		});

		this.#operations = new OperationManager(
			this.#state,
			this.#events,
			this.#persistence,
			() => this.#snapshot.changed(),
			(id) => this.getNodeState(id),
		);

		this.#health = new HealthManager(
			this.#state,
			this.#events,
			() => this.#snapshot.changed(),
			async (id) => {
				await this.restart([id]);
			},
		);

		this.#execution = new ExecutionManager(
			this.#state,
			this.#events,
			this.#health,
			this.#artifacts,
			this.#plugins,
			() => this.#snapshot.changed(),
			() => this.#pluginContext(),
		);

		this.#loader = new ControlPlaneLoader(
			this.#state,
			options,
			this.#persistence,
			this.#events,
			() => this.#pluginContext(),
			(item) => this.#execution.handler(item),
			(id, signal) => this.#health.awaitHealthy(id, signal),
		);

		this.#completion = new CompletionService(
			this.#state,
			() => this.snapshot(),
			() => this.#pluginContext(),
		);

		this.#plugins = new PluginManager(
			() => this.#state.pluginSession,
			() => this.#pluginContext(),
		);
	}

	load(): Promise<NormalizedSystemDefinition> {
		return this.#loader.load();
	}
	definition(): NormalizedSystemDefinition {
		return required(this.#state.definition, "Control plane is not loaded");
	}
	graph() {
		return required(this.#state.graph, "Control plane is not loaded");
	}
	validate() {
		return this.#state.diagnostics;
	}
	plan(ids?: readonly string[]): ExecutionPlan {
		return this.graph().plan(ids ? this.#selector.closure(ids) : this.#selector.executableIds());
	}
	getNode(id: string): SystemNode | undefined {
		return this.graph().node(id);
	}
	getNodeState(id: string): LifecycleState | undefined {
		try {
			return this.#state.engine?.state(id);
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
		return this.#events.list();
	}
	listArtifacts() {
		return [...this.#state.artifacts.values()];
	}
	snapshot(): ControlPlaneSnapshot {
		return this.#snapshot.create();
	}
	subscribeSnapshots(listener: (snapshot: ControlPlaneSnapshot) => void) {
		return this.#snapshot.subscribe(listener);
	}
	listOperations() {
		return this.#operations.list();
	}
	getOperation(id: string) {
		return this.#operations.get(id);
	}
	cancelOperation(id: string) {
		return this.#operations.cancel(id);
	}

	// pluginContributions<Kind extends keyof PluginContributions>(kind: Kind) {
	// 	return required(this.#state.pluginSession, "Control plane is not loaded").contributions(kind);
	// }

	pluginContributions<Kind extends keyof PluginContributions>(kind: Kind) {
		return this.#plugins.contributions(kind);
	}

	invokePluginContribution<T>(
		kind: keyof PluginContributions,
		id: string,
		run: (context: PluginContext) => T | Promise<T>,
	): Promise<T> {
		return this.#plugins.invoke(kind, id, run);
	}

	async start(ids?: readonly string[]): Promise<OperationResult> {
		this.#assertMutable();
		const targets = ids?.map((id) => this.#selector.resolve(id)) ?? this.#selector.longRunningIds();
		const selected = this.#selector.closure(targets);
		return this.#operations.run("start", targets, selected, (signal) =>
			required(this.#state.engine, "Control plane is not loaded").start(selected, signal),
		);
	}

	async stop(ids?: readonly string[]): Promise<OperationResult> {
		this.#assertMutable();
		const targets = ids?.map((id) => this.#selector.resolve(id)) ?? this.#selector.executableIds();
		const selected = this.#selector.dependants(targets);
		for (const node of selected) {
			this.#state.manualStops.add(node);
			this.#health.cancelRestart(node, "manual stop");
			this.#health.stopMonitor(node);
		}
		return this.#operations.run("stop", targets, selected, (signal) =>
			required(this.#state.engine, "Control plane is not loaded").stop(selected, signal),
		);
	}

	async restart(ids: readonly string[]): Promise<OperationResult> {
		const targets = ids.map((id) => this.#selector.resolve(id));
		const selected = this.#selector.dependants(targets);
		return this.#operations.run("restart", targets, selected, async (signal) => {
			const engine = required(this.#state.engine, "Control plane is not loaded");
			await engine.stop(selected, signal);
			await engine.start(this.#selector.closure(targets), signal);
		});
	}

	async runTask(id: string): Promise<OperationResult> {
		const resolved = this.#selector.resolve(id, "task");
		return this.#operations.run("task", [resolved], this.#selector.closure([resolved]), (signal) =>
			required(this.#state.engine, "Control plane is not loaded").start(
				this.#selector.closure([resolved]),
				signal,
			),
		);
	}

	complete(input: string): Promise<readonly string[]> {
		return this.#completion.complete(input);
	}

	submit(
		type: "start" | "stop" | "restart" | "task",
		ids: readonly string[],
		operationId: string = crypto.randomUUID(),
	): SubmittedOperation {
		this.#state.submittedOperationIds.push(operationId);
		const execution =
			type === "start"
				? this.start(ids)
				: type === "stop"
					? this.stop(ids)
					: type === "restart"
						? this.restart(ids)
						: this.runTask(required(ids[0], "Task operation requires one task"));
		void execution.catch(() => {});
		return { operationId, nodes: ids, status: "accepted" };
	}

	hasActiveProcesses(): boolean {
		return [...this.#state.handles.values()].some((handle) => handle.running);
	}

	async dispose(): Promise<void> {
		if (this.#state.disposed) return;
		this.#state.disposed = true;
		for (const controller of this.#state.operationControllers.values())
			controller.abort(new DOMException("Control plane disposed", "AbortError"));
		await this.#health.dispose();
		if (this.#state.engine)
			await this.#state.engine.stop(this.#selector.executableIds()).catch(() => {});
		await Promise.all([...this.#state.runtimes.values()].map((runtime) => runtime.dispose()));
		await this.#state.pluginSession?.dispose(this.#pluginContext());
		this.#snapshot.clear();
		await this.#persistence.dispose();
	}

	// TODO: Move the original #handler implementation into an ExecutionManager.
	#handler(_item: NormalizedExecutable) {
		// Move the original #handler implementation into an ExecutionManager.
		// It should receive ArtifactManager and HealthManager as collaborators.
		throw new Error("ExecutionManager wiring required");
	}

	#pluginContext(): PluginContext {
		const persistence: PersistenceProvider | undefined = this.#state.persistence;
		return Object.freeze({
			root: this.#state.definition?.root ?? path.resolve(this.options.root ?? "."),
			configuration: this.#state.definition,
			logger: {
				info: (message: string) =>
					this.#events.emit("plugin.log.info", "plugin", "plugin", { message }),
				warn: (message: string) =>
					this.#events.emit("plugin.log.warning", "plugin", "plugin", { message }),
				error: (message: string) =>
					this.#events.emit("plugin.log.error", "plugin", "plugin", { message }),
			},
			diagnostics: { add: (diagnostic: any) => this.#state.diagnostics.push(diagnostic) },
			events: {
				emit: (type: string, payload: unknown) =>
					this.#events.emit(type, "plugin", "plugin", payload),
			},
			services: Object.freeze({
				graph: this.#state.graph,
				controlPlane: this,
				...(persistence
					? { pluginStorage: (pluginId: string) => pluginStorage(persistence, pluginId) }
					: {}),
			}),
		});
	}

	#assertMutable(): void {
		if (this.options.allowMutations === false)
			throw new Error("Mutating control-plane operations are disabled");
	}
}

export async function createControlPlane(
	options: ControlPlaneOptions = {},
): Promise<WsrtControlPlane> {
	const plane = new WsrtControlPlane(options);
	try {
		await plane.load();
		return plane;
	} catch (cause) {
		await plane.dispose().catch(() => {});
		throw cause;
	}
}

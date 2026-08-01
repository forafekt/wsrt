import path from "node:path";
import type { NormalizedSystemDefinition } from "@wsrt/config";
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
	ControlPlaneCommand,
	ControlPlaneCommandResult,
	ControlPlaneOptions,
	ControlPlaneSnapshot,
	OperationResult,
	SubmittedOperation,
} from "./types.js";
import { required } from "./utils.js";

export class WsrtControlPlane {
	readonly #state: ControlPlaneState;
	readonly #selector: GraphSelector;
	readonly #snapshot: SnapshotManager;
	readonly #persistence: PersistenceManager;
	readonly #events: EventJournal;
	readonly #operations: OperationManager;
	readonly #health: HealthManager;
	readonly #loader: ControlPlaneLoader;
	readonly #completion: CompletionService;
	readonly #plugins: PluginManager;
	readonly #execution: ExecutionManager;
	readonly #artifacts: ArtifactManager;

	constructor(readonly options: ControlPlaneOptions = {}) {
		this.#state = new ControlPlaneState();

		this.#selector = new GraphSelector(this.#state);

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

		this.#artifacts = new ArtifactManager({
			state: this.#state,
			events: this.#events,
			changed: () => this.#snapshot.changed(),
			pluginContext: () => this.#pluginContext(),
			providerContext: (item, contributionId, signal) =>
				this.#execution.providerContext(item, contributionId, signal),
			operationId: (id) => this.#state.nodeOperations.get(id) ?? id,
		});

		this.#execution = new ExecutionManager({
			artifacts: this.#artifacts,
			state: this.#state,
			events: this.#events,
			health: this.#health,
			changed: () => this.#snapshot.changed(),
			pluginContext: () => this.#pluginContext(),
			restartNode: async (id) => {
				await this.restart([id]);
			},
		});

		this.#loader = new ControlPlaneLoader(
			this.#state,
			options,
			this.#persistence,
			this.#events,
			() => this.#pluginContext(),
			(definition) => this.#artifacts.initialize(definition),
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
		const targets =
			ids?.map((id) => this.#selector.resolveNode(id).id) ?? this.#selector.longRunningIds();
		return this.#start(targets);
	}

	#start(targets: readonly string[], operationId?: string): Promise<OperationResult> {
		const selected = this.#selector.closure(targets);
		return this.#operations.run(
			"start",
			targets,
			selected,
			(signal) =>
				required(this.#state.engine, "Control plane is not loaded").start(selected, signal),
			operationId,
		);
	}

	async stop(ids?: readonly string[]): Promise<OperationResult> {
		this.#assertMutable();
		const targets =
			ids?.map((id) => this.#selector.resolveNode(id).id) ?? this.#selector.executableIds();
		return this.#stop(targets);
	}

	#stop(targets: readonly string[], operationId?: string): Promise<OperationResult> {
		const selected = this.#selector.dependants(targets);
		for (const node of selected) {
			this.#state.manualStops.add(node);
			this.#health.cancelRestart(node, "manual stop");
			this.#health.stopMonitor(node);
		}
		return this.#operations.run(
			"stop",
			targets,
			selected,
			(signal) =>
				required(this.#state.engine, "Control plane is not loaded").stop(selected, signal),
			operationId,
		);
	}

	async restart(ids: readonly string[]): Promise<OperationResult> {
		const targets = ids.map((id) => this.#selector.resolveNode(id).id);
		return this.#restart(targets);
	}

	#restart(targets: readonly string[], operationId?: string): Promise<OperationResult> {
		const selected = this.#selector.dependants(targets);
		return this.#operations.run(
			"restart",
			targets,
			selected,
			async (signal) => {
				const engine = required(this.#state.engine, "Control plane is not loaded");
				await engine.stop(selected, signal);
				await engine.start(this.#selector.closure(targets), signal);
			},
			operationId,
		);
	}

	async runTask(id: string): Promise<OperationResult> {
		const resolved = this.#selector.resolveTask(id).id;
		return this.#runTask(resolved);
	}

	#runTask(resolved: string, operationId?: string): Promise<OperationResult> {
		return this.#operations.run(
			"task",
			[resolved],
			this.#selector.closure([resolved]),
			async (signal) => {
				const engine = required(this.#state.engine, "Control plane is not loaded");
				if (!["resolved", "stopped", "failed"].includes(engine.state(resolved)))
					await engine.stop([resolved], signal);
				await engine.start(this.#selector.closure([resolved]), signal);
			},
			operationId,
		);
	}

	complete(input: string): Promise<readonly string[]> {
		return this.#completion.complete(input);
	}

	submit(command: Exclude<ControlPlaneCommand, { type: "operation.cancel" }>): SubmittedOperation {
		const operationId = crypto.randomUUID();
		const nodes = this.#validateCommand(command);
		void this.#execute(command, operationId).catch(() => {});
		return { operationId, nodes, status: "accepted" };
	}

	execute(command: {
		type: "operation.cancel";
		operationId: string;
	}): Promise<{ operationId: string; cancelled: boolean }>;
	execute(
		command: Exclude<ControlPlaneCommand, { type: "operation.cancel" }>,
	): Promise<OperationResult>;
	async execute(command: ControlPlaneCommand): Promise<ControlPlaneCommandResult> {
		if (command.type === "operation.cancel")
			return {
				operationId: command.operationId,
				cancelled: this.cancelOperation(command.operationId),
			};
		this.#validateCommand(command);
		return await this.#execute(command);
	}

	#validateCommand(command: Exclude<ControlPlaneCommand, { type: "operation.cancel" }>): string[] {
		if (command.type === "task.run") return [this.#selector.resolveTask(command.taskId).id];
		return command.nodeIds.map((id) => this.#selector.resolveNode(id).id);
	}

	#execute(
		command: Exclude<ControlPlaneCommand, { type: "operation.cancel" }>,
		operationId?: string,
	): Promise<OperationResult> {
		this.#assertMutable();
		const nodes = this.#validateCommand(command);
		switch (command.type) {
			case "node.start":
				return this.#start(nodes, operationId);
			case "node.stop":
				return this.#stop(nodes, operationId);
			case "node.restart":
				return this.#restart(nodes, operationId);
			case "task.run":
				return this.#runTask(required(nodes[0], "Task command requires one task"), operationId);
		}
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

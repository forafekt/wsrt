import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
	ArtifactCandidate,
	ArtifactProvider,
	ExecutionAdapter,
	ExecutionTelemetryEvent,
	ProcessHandle,
	ProviderInvocationContext,
	ReadinessProvider,
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
import { LifecycleEngine, type LifecycleEvent, type LifecycleState } from "@wsrt/lifecycle";
import {
	createRecord,
	MigrationRegistry,
	type PersistedRecord,
	type PersistenceProvider,
	pluginStorage,
	type RuntimeSession,
	type WorkspaceIdentity,
} from "@wsrt/persistence";
import { filesystemPersistence } from "@wsrt/persistence-filesystem";
import {
	type ContributionDiagnostic,
	type PluginContext,
	type PluginContributions,
	PluginSession,
	type PluginSnapshot,
	resolveWorkspacePluginsReport,
} from "@wsrt/plugins";
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
	status: "pending" | "invalid" | "generating" | "ready" | "unchanged" | "failed";
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

export type SubmittedOperation = {
	operationId: string;
	nodes: readonly string[];
	status: "accepted";
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

export type HealthState = "unknown" | "checking" | "healthy" | "degraded" | "unhealthy";

export type OperationSnapshot = {
	id: string;
	type: "start" | "stop" | "restart" | "task" | "dispose";
	status: "pending" | "running" | "completed" | "partially-completed" | "failed" | "cancelled";
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
	terminationState?: ProcessHandle["terminationState"];
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
	plugins: readonly PluginSnapshot[];
	providers: readonly { id: string; kind: "runtime" }[];
};

export type ControlPlaneOptions = {
	root?: string;
	config?: string;
	providers?: RuntimeProvider[];
	allowMutations?: boolean;
	pluginSession?: PluginSession;
	/** Overrides normalized configuration. Use `false` for an ephemeral control plane. */
	persistence?: PersistenceProvider | false;
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
	readonly #submittedOperationIds: string[] = [];
	readonly #nodeOperations = new Map<string, string>();
	readonly #manualStops = new Set<string>();
	#disposed = false;
	#revision = 0;
	#definition?: NormalizedSystemDefinition;
	#graph?: SystemGraph;
	#engine?: LifecycleEngine;
	#diagnostics: SystemDiagnostic[] = [];
	#providerIds: string[] = [];
	#pluginSession?: PluginSession;
	#persistence?: PersistenceProvider;
	#workspaceIdentity?: WorkspaceIdentity;
	#session?: RuntimeSession;
	#snapshotTimer?: ReturnType<typeof setTimeout>;
	#persistenceFailure?: unknown;
	readonly #migrations = new MigrationRegistry();
	readonly #adapters = new Map<string, ExecutionAdapter>();
	readonly #readinessProviders = new Map<string, ReadinessProvider>();
	readonly #artifactProviders = new Map<string, ArtifactProvider>();
	readonly #executionMetadata = new Map<string, Record<string, unknown>>();
	readonly #closedExecutions = new Set<string>();
	readonly #completedExecutions = new Set<string>();
	readonly #executionSignals = new Map<string, AbortSignal>();
	readonly #executionCleanup = new Map<string, () => void | Promise<void>>();
	readonly #telemetryIngestion = new Map<string, Promise<void>>();
	constructor(readonly options: ControlPlaneOptions = {}) {}
	async load(): Promise<NormalizedSystemDefinition> {
		const loaded = await loadSystemDefinition(this.options.root, this.options.config);
		this.#diagnostics = [...loaded.diagnostics];
		if (!loaded.definition) throw new Error(this.#diagnostics.map((d) => d.message).join("\n"));
		this.#definition = loaded.definition;
		await this.#initializePersistence();
		const report = this.options.pluginSession
			? { plugins: this.options.pluginSession.list(), diagnostics: [] }
			: await resolveWorkspacePluginsReport(loaded.definition.plugins, loaded.definition.root);
		for (const diagnostic of report.diagnostics)
			this.#diagnostics.push(this.#pluginDiagnostic(diagnostic));
		if (report.diagnostics.length)
			throw new Error(report.diagnostics.map((item) => item.message).join("\n"));
		this.#pluginSession = this.options.pluginSession ?? new PluginSession(report.plugins);
		await this.#pluginSession.runStage("discover", this.#pluginContext());
		for (const contribution of this.#pluginSession.contributions("configuration")) {
			const reference = loaded.definition.plugins.find(
				(item) =>
					typeof item !== "string" && "provider" in item && item.provider === contribution.id,
			);
			for (const diagnostic of contribution.validate(
				typeof reference === "object" && "options" in reference ? reference.options : undefined,
			))
				this.#diagnostics.push(this.#pluginDiagnostic(diagnostic));
		}
		if (this.#diagnostics.some((item) => item.severity === "error"))
			throw new Error(this.#diagnostics.map((item) => item.message).join("\n"));
		await this.#pluginSession.runStage("configure", this.#pluginContext());
		for (const contribution of this.#pluginSession.contributions("workspace"))
			await contribution.compile(this.#pluginContext());
		await this.#pluginSession.runStage("workspace", this.#pluginContext());
		this.#graph = compileSystemGraph(loaded.definition);
		for (const contribution of this.#pluginSession.contributions("graph"))
			await contribution.contribute(this.#graph, this.#pluginContext());
		await this.#pluginSession.runStage("graph", this.#pluginContext());
		for (const plugin of this.#pluginSession.list())
			for (const adapter of plugin.contributions?.adapters ?? [])
				this.#adapters.set(adapter.id, adapter);
		for (const provider of this.#pluginSession.contributions("readiness"))
			this.#readinessProviders.set(provider.id, provider);
		for (const provider of this.#pluginSession.contributions("artifacts"))
			this.#artifactProviders.set(provider.id, provider);
		await this.#pluginSession.runStage("providers", this.#pluginContext());
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
		const providers = this.options.providers ?? [
			new NodeRuntimeProvider(),
			...this.#pluginSession.contributions("runtimes"),
		];
		this.#providerIds = providers.map((provider) => provider.id).sort();
		for (const runtime of Object.values(loaded.definition.runtimes)) {
			if (this.#runtimes.has(runtime.provider)) continue;
			const provider = providers.find((item) => item.id === runtime.provider);
			if (!provider) throw new Error(`Runtime provider not registered: ${runtime.provider}`);
			this.#runtimes.set(runtime.provider, await provider.create());
		}
		this.#engine = new LifecycleEngine(this.#graph, {
			onEvent: (event) => {
				this.#events.push(event);
				this.#persistEvent(event);
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
		await this.#pluginSession.runStage("runtime", this.#pluginContext());
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
	pluginContributions<Kind extends keyof PluginContributions>(kind: Kind) {
		return required(this.#pluginSession, "Control plane is not loaded").contributions(kind);
	}
	async invokePluginContribution<T>(
		kind: keyof PluginContributions,
		id: string,
		run: (context: PluginContext) => T | Promise<T>,
	): Promise<T> {
		return required(this.#pluginSession, "Control plane is not loaded").invoke(
			kind,
			id,
			this.#pluginContext(),
			run,
		);
	}
	async complete(input: string): Promise<readonly string[]> {
		const values = new Set<string>();
		for (const item of this.definition().executables) {
			values.add(item.id);
			values.add(item.name);
		}
		for (const plugin of this.snapshot().plugins) values.add(plugin.id);
		for (const provider of this.#providerIds) values.add(provider);
		for (const executable of required(
			this.#pluginSession,
			"Control plane is not loaded",
		).executables())
			values.add(executable.id);
		for (const contribution of this.pluginContributions("completion"))
			try {
				for (const value of await this.invokePluginContribution(
					"completion",
					contribution.id,
					(context) => contribution.complete(input, context),
				))
					values.add(value);
			} catch {}
		return Object.freeze([...values].filter((value) => value.startsWith(input)).sort());
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
					terminationState: this.#handles.get(item.id)?.terminationState,
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
			plugins: this.#pluginSession?.snapshots() ?? [],
			providers: Object.freeze(
				this.#providerIds.map((id) => Object.freeze({ id, kind: "runtime" as const })),
			),
		});
	}
	subscribeSnapshots(listener: (snapshot: ControlPlaneSnapshot) => void): () => void {
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
		const operation = this.#operations.find((item) => item.id === id);
		for (const node of operation?.affectedNodes ?? []) {
			this.#manualStops.add(node);
			this.#cancelRestart(node, "operation cancelled");
			this.#stopMonitor(node);
		}
		controller.abort(new DOMException("Operation cancelled", "AbortError"));
		this.#event("operation.cancelled", id, id, { operationId: id });
		return true;
	}
	/**
	 * Submits lifecycle work without coupling a transport request to its duration.
	 * Operation state, cancellation, and results remain owned by this control plane.
	 */
	submit(
		type: "start" | "stop" | "restart" | "task",
		ids: readonly string[],
		operationId: string = crypto.randomUUID(),
	): SubmittedOperation {
		const operationCount = this.#operations.length;
		this.#submittedOperationIds.push(operationId);
		const execution =
			type === "start"
				? this.start(ids)
				: type === "stop"
					? this.stop(ids)
					: type === "restart"
						? this.restart(ids)
						: this.runTask(required(ids[0], "Task operation requires exactly one task"));
		// #operate records structured terminal failure before rejecting.
		void execution.catch(() => {});
		const operation =
			this.#operations.length > operationCount ? this.#operations.at(-1) : undefined;
		if (!operation) {
			const index = this.#submittedOperationIds.indexOf(operationId);
			if (index >= 0) this.#submittedOperationIds.splice(index, 1);
			throw new Error("Control-plane operation was not accepted");
		}
		return {
			operationId: operation.id,
			nodes: operation.affectedNodes,
			status: "accepted",
		};
	}
	async start(ids?: readonly string[]): Promise<OperationResult> {
		this.#assertMutable();
		const targets = ids?.map((id) => this.#resolve(id)) ?? this.#longRunningIds();
		const selected = this.#closure(targets);
		return this.#operate("start", targets, selected, async (signal) =>
			required(this.#engine, "Control plane is not loaded").start(selected, signal),
		);
	}
	async stop(ids?: readonly string[]): Promise<OperationResult> {
		this.#assertMutable();
		const targets = ids?.map((id) => this.#resolve(id)) ?? this.#executableIds();
		const selected = this.#dependants(targets);
		for (const node of selected) {
			this.#manualStops.add(node);
			this.#cancelRestart(node, "manual stop");
			this.#stopMonitor(node);
		}
		return this.#operate("stop", targets, selected, async (signal) =>
			required(this.#engine, "Control plane is not loaded").stop(selected, signal),
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
			await required(this.#engine, "Control plane is not loaded").stop(selected, signal);
			for (const node of selected) this.#manualStops.delete(node);
			await required(this.#engine, "Control plane is not loaded").start(
				this.#closure(targets),
				signal,
			);
		});
	}
	async runTask(id: string): Promise<OperationResult> {
		const resolved = this.#resolve(id, "task");
		if (this.getNodeState(resolved) === "ready")
			await required(this.#engine, "Control plane is not loaded").stop([resolved]);
		return this.#operate("task", [resolved], this.#closure([resolved]), async (signal) =>
			required(this.#engine, "Control plane is not loaded").start(
				this.#closure([resolved]),
				signal,
			),
		);
	}
	hasActiveProcesses(): boolean {
		return [...this.#handles.values()].some((handle) => handle.running);
	}
	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const controller of this.#operationControllers.values())
			controller.abort(new DOMException("Control plane disposed", "AbortError"));
		for (const controller of this.#monitors.values()) controller.abort();
		for (const controller of this.#restartControllers.values())
			controller.abort(new DOMException("Control plane disposed", "AbortError"));
		this.#monitors.clear();
		if (this.#engine) await this.#engine.stop(this.#executableIds()).catch(() => {});
		await Promise.all([...this.#runtimes.values()].map((runtime) => runtime.dispose()));
		this.#runtimes.clear();
		this.#subscribers.clear();
		await this.#pluginSession?.dispose(this.#pluginContext());
		if (this.#snapshotTimer) clearTimeout(this.#snapshotTimer);
		this.#snapshotTimer = undefined;
		await this.#persistSnapshot();
		if (this.#persistence && this.#session) {
			this.#session = {
				...this.#session,
				endedAt: new Date().toISOString(),
				exitReason: "shutdown",
			};
			await this.#persistence.write(
				`session/${this.#session.id}`,
				createRecord("wsrt.runtime-session", this.#session, {
					workspaceId: this.#workspaceIdentity?.id ?? this.#session.workspaceId,
					sessionId: this.#session.id,
				}),
			);
			await this.#persistence.flush?.();
			await this.#persistence.dispose();
		}
	}
	#pluginContext(): PluginContext {
		const persistence = this.#persistence;
		return Object.freeze({
			root: this.#definition?.root ?? path.resolve(this.options.root ?? "."),
			configuration: this.#definition,
			logger: {
				info: (message) => this.#event("plugin.log.info", "plugin", "plugin", { message }),
				warn: (message) => this.#event("plugin.log.warning", "plugin", "plugin", { message }),
				error: (message) => this.#event("plugin.log.error", "plugin", "plugin", { message }),
			},
			diagnostics: {
				add: (diagnostic) => this.#diagnostics.push(this.#pluginDiagnostic(diagnostic)),
			},
			events: {
				emit: (type, payload) => this.#event(type, "plugin", "plugin", payload),
			},
			services: Object.freeze({
				graph: this.#graph,
				controlPlane: this,
				...(persistence
					? { pluginStorage: (pluginId: string) => pluginStorage(persistence, pluginId) }
					: {}),
			}),
		});
	}
	#pluginDiagnostic(diagnostic: ContributionDiagnostic): SystemDiagnostic {
		return {
			code: diagnostic.code,
			severity: diagnostic.severity,
			message: diagnostic.message,
			source: {
				file: this.#definition?.sourceFile ?? "<plugin>",
				path: diagnostic.plugin ? `plugins.${diagnostic.plugin}` : "plugins",
			},
		};
	}
	#handler(item: NormalizedExecutable) {
		const runtime = () =>
			required(
				this.#runtimes.get(this.definition().runtimes[item.runtime].provider),
				`Runtime unavailable: ${item.runtime}`,
			);
		return {
			start: async ({ signal }: { signal: AbortSignal }) => {
				this.#closedExecutions.delete(item.id);
				this.#completedExecutions.delete(item.id);
				this.#executionSignals.set(item.id, signal);
				let command = item.command;
				let completion: "process" | "exit" = "process";
				let providerEnvironment: Readonly<Record<string, string>> = {};
				if (item.provider) {
					const adapter = this.#adapters.get(item.provider.provider);
					if (!adapter)
						throw new Error(`Execution adapter not registered: ${item.provider.provider}`);
					const validation = adapter.validate(item.provider.options ?? {});
					if (!validation.options || validation.diagnostics.length)
						throw new Error(
							validation.diagnostics.join("\n") ||
								`Invalid adapter options: ${item.provider.provider}`,
						);
					const prepared = adapter.prepare(validation.options, {
						nodeId: item.id,
						workspaceRoot: this.definition().root,
						projectRoot: item.root,
						environment: item.environment,
					});
					completion = prepared.completion ?? "process";
					providerEnvironment = prepared.environment ?? {};
					this.#executionMetadata.set(item.id, {
						...(prepared.metadata ?? {}),
					});
					if (prepared.dispose) this.#executionCleanup.set(item.id, prepared.dispose);
					command = {
						command: prepared.command,
						args: prepared.args,
						shell: prepared.shell ?? false,
					};
				}
				if (!command) return;
				const handle = runtime()
					.capabilities.require("spawn")
					.spawn({
						command: command.command,
						args: command.args,
						cwd: item.root,
						environment: {
							...item.environment,
							...providerEnvironment,
							WSRT_NODE_ID: item.id,
							WSRT_OPERATION_ID: this.#operationId(item.id),
						},
						shell: command.shell,
						signal,
					});
				this.#handles.set(item.id, handle);
				this.#telemetry(item, {
					type: "execution.started",
					timestamp: new Date().toISOString(),
				});
				if (item.kind === "task" || completion === "exit") {
					try {
						if (item.kind === "task") await this.#invalidateOutputs(item);
						const exit = await handle.exit;
						if (exit.code !== 0) {
							if (item.kind === "task")
								await this.#failOutputs(item, `Task ${item.name} exited with code ${exit.code}`);
							throw new Error(
								`${item.kind === "task" ? "Task" : "Process"} ${item.name} exited with code ${exit.code}`,
							);
						}
						await this.#telemetryIngestion.get(item.id);
						await this.#collectArtifacts(item, signal);
						if (item.kind === "task") await this.#verifyOutputs(item);
						else this.#completedExecutions.add(item.id);
					} finally {
						this.#closedExecutions.add(item.id);
						await this.#cleanupExecution(item.id);
					}
				} else {
					void handle.exit
						.then((exit) => this.#processExited(item, handle, exit))
						.catch((cause) => {
							this.#diagnostics.push({
								code: "WSRT_PROCESS_EXIT_SUPERVISION_FAILED",
								severity: "warning",
								message: cause instanceof Error ? cause.message : String(cause),
								source: item.source,
							});
						});
				}
			},
			stop: async () => {
				this.#stopMonitor(item.id);
				const handle = this.#handles.get(item.id);
				if (!handle) {
					this.#handles.delete(item.id);
					this.#closedExecutions.add(item.id);
					await this.#cleanupExecution(item.id);
					this.#manualStops.delete(item.id);
					return;
				}
				await handle.terminateTree();
				this.#handles.delete(item.id);
				this.#closedExecutions.add(item.id);
				await this.#cleanupExecution(item.id);
			},
			ready: async ({ signal }: { signal: AbortSignal }) => {
				if (item.kind === "task") return;
				if (this.#completedExecutions.has(item.id)) {
					this.#setHealth(item.id, "healthy");
					return;
				}
				const providerId = item.provider?.provider;
				const provider = providerId ? this.#readinessProviders.get(providerId) : undefined;
				if (provider && providerId) {
					const validation = provider.validate(item.provider?.options ?? {});
					if (!validation.options || validation.diagnostics.length)
						throw new Error(
							validation.diagnostics.join("\n") || `Invalid readiness options: ${providerId}`,
						);
					await required(this.#pluginSession, "Plugin session unavailable").invoke(
						"readiness",
						providerId,
						this.#pluginContext(),
						() =>
							provider.wait(validation.options, this.#providerContext(item, providerId, signal)),
					);
					if (signal.aborted || !this.#handles.get(item.id)?.running)
						throw signal.reason ?? new Error(`Process ${item.name} exited before readiness`);
					this.#event("node.readiness.succeeded", item.id, this.#operationId(item.id), {
						provider: providerId,
					});
					this.#startMonitor(item);
					return;
				}
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
			while (!controller.signal.aborted && this.#handles.get(item.id)?.running) {
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
					diagnostic ? "node.health.check.failed" : "node.health.check.succeeded",
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
	async #checkHealth(item: NormalizedExecutable, signal: AbortSignal): Promise<void> {
		const health = item.healthcheck;
		if (!health || health.type === "process") {
			if (!this.#handles.get(item.id)?.running) throw new Error("Process exited");
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
		if (health === "unhealthy") this.#event("node.health.unhealthy", id, id, {});
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
		// The root may exit while descendants remain. Preserve ownership until the
		// runtime has verified that the complete resource tree is gone.
		await handle.terminateTree({ graceMs: 0 });
		this.#handles.delete(item.id);
		this.#closedExecutions.add(item.id);
		await this.#cleanupExecution(item.id);
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
		if (this.#restartControllers.has(item.id) || this.#disposed || this.#manualStops.has(item.id))
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
			delay = Math.min(policy.backoff === "exponential" ? exponential : base, maximum);
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
			await this.#runtime(item).capabilities.require("timers").delay(delay, controller.signal);
			if (controller.signal.aborted || this.#disposed || this.#manualStops.has(item.id))
				throw controller.signal.reason ?? new DOMException("Restart cancelled", "AbortError");
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
				controller.signal.aborted || this.#disposed || this.#manualStops.has(item.id);
			const current = this.#details(item.id);
			this.#healthDetails.set(item.id, {
				...current,
				restartPending: false,
				nextRestartAt: undefined,
			});
			this.#event(cancelled ? "node.restart.cancelled" : "node.restart.failed", item.id, item.id, {
				attempt,
				error: String(cause),
			});
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
	#operationId(nodeId: string): string {
		return this.#nodeOperations.get(nodeId) ?? nodeId;
	}
	async #cleanupExecution(nodeId: string): Promise<void> {
		const cleanup = this.#executionCleanup.get(nodeId);
		this.#executionCleanup.delete(nodeId);
		this.#executionMetadata.delete(nodeId);
		this.#executionSignals.delete(nodeId);
		this.#telemetryIngestion.delete(nodeId);
		if (!cleanup) return;
		try {
			await cleanup();
		} catch (cause) {
			this.#diagnostics.push({
				code: "WSRT_EXECUTION_CLEANUP_FAILED",
				severity: "warning",
				message: cause instanceof Error ? cause.message : String(cause),
				source: {
					file: this.#definition?.sourceFile ?? "<execution>",
					path: nodeId,
				},
			});
		}
	}
	#providerContext(
		item: NormalizedExecutable,
		contributionId: string,
		signal: AbortSignal,
	): ProviderInvocationContext {
		const pluginId =
			required(this.#pluginSession, "Plugin session unavailable").owner(
				this.#readinessProviders.has(contributionId) ? "readiness" : "artifacts",
				contributionId,
			) ?? "unknown";
		return Object.freeze({
			pluginId,
			contributionId,
			nodeId: item.id,
			operationId: this.#operationId(item.id),
			workspaceRoot: this.definition().root,
			projectRoot: item.root,
			runtimeProviderId: this.definition().runtimes[item.runtime].provider,
			environment: item.environment,
			process: this.#handles.get(item.id),
			executionMetadata: Object.freeze({
				...(this.#executionMetadata.get(item.id) ?? {}),
			}),
			signal,
			capabilities: this.#runtime(item).capabilities,
			report: (event) => this.#telemetry(item, event),
		});
	}
	#telemetry(item: NormalizedExecutable, event: ExecutionTelemetryEvent): void {
		if (
			this.#disposed ||
			this.#closedExecutions.has(item.id) ||
			this.#executionSignals.get(item.id)?.aborted
		)
			return;
		const operationId = this.#operationId(item.id);
		if (event.type === "diagnostic") {
			this.#diagnostics.push({
				...event.diagnostic,
				source: item.source,
			});
		} else if (event.type === "server.listening") {
			this.#executionMetadata.set(item.id, {
				...(this.#executionMetadata.get(item.id) ?? {}),
				host: event.host,
				port: event.port,
				urls: event.urls,
			});
		} else if (event.type === "readiness.available") {
			this.#executionMetadata.set(item.id, {
				...(this.#executionMetadata.get(item.id) ?? {}),
				readiness: event.details ?? true,
			});
		} else if (event.type === "artifact.discovered") {
			const pending = (this.#telemetryIngestion.get(item.id) ?? Promise.resolve())
				.then(() => this.#ingestCandidate(item, event.artifact))
				.catch((cause) => {
					this.#diagnostics.push({
						code: "WSRT_ARTIFACT_INVALID_CANDIDATE",
						severity: "warning",
						message: cause instanceof Error ? cause.message : String(cause),
						source: item.source,
					});
				});
			this.#telemetryIngestion.set(item.id, pending);
		}
		this.#event(`provider.${event.type}`, item.id, operationId, event);
		this.#changed();
	}
	async #collectArtifacts(item: NormalizedExecutable, signal: AbortSignal) {
		const providerId = item.provider?.provider;
		const provider = providerId ? this.#artifactProviders.get(providerId) : undefined;
		if (!provider || !providerId || signal.aborted) return;
		const candidates = await required(this.#pluginSession, "Plugin session unavailable").invoke(
			"artifacts",
			providerId,
			this.#pluginContext(),
			() =>
				provider.collect(
					item.provider?.options ?? {},
					this.#providerContext(item, providerId, signal),
				),
		);
		if (signal.aborted) return;
		const unique = new Map<string, ArtifactCandidate>();
		for (const candidate of candidates)
			unique.set(`${candidate.name ?? ""}:${candidate.path}`, candidate);
		for (const candidate of [...unique.values()].sort((a, b) => a.path.localeCompare(b.path)))
			await this.#ingestCandidate(item, candidate);
	}
	async #ingestCandidate(item: NormalizedExecutable, candidate: ArtifactCandidate) {
		const file = path.resolve(item.root, candidate.path);
		if (!file.startsWith(`${this.definition().root}${path.sep}`) && file !== this.definition().root)
			throw new Error(`WSRT_ARTIFACT_PATH_INVALID: ${file}`);
		const name = candidate.name ?? path.basename(candidate.path);
		const id = `artifact:${name}`;
		const existing = this.#artifacts.get(id);
		this.#artifacts.set(id, {
			...existing,
			id,
			type: candidate.kind ?? existing?.type ?? "file",
			producer: item.name,
			consumers: existing?.consumers ?? [],
			location: file,
			status: "generating",
			metadata: Object.freeze({
				...(existing?.metadata ?? {}),
				...(candidate.metadata ?? {}),
				mediaType: candidate.mediaType,
				outputGroup: candidate.outputGroup,
			}),
		});
		this.#event("artifact.discovered", id, this.#operationId(item.id), {
			path: file,
		});
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
				await this.#failOutputs(item, `Declared output does not exist: ${file}`);
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
			this.#event(unchanged ? "artifact.unchanged" : "artifact.generated", id, item.id, {
				hash,
				size: bytes.byteLength,
			});
		}
		this.#changed();
	}
	#event(type: string, source: string, correlationId: string, payload: unknown) {
		const event = {
			id: crypto.randomUUID(),
			type,
			timestamp: new Date().toISOString(),
			source,
			correlationId,
			payload,
		};
		this.#events.push(event);
		this.#persistEvent(event);
		if (this.#events.length > 1000) this.#events.shift();
	}
	#resolve(value: string, kind?: NormalizedExecutable["kind"]) {
		const match = this.definition().executables.find(
			(item) => item.id === value || item.name === value || processShorthand(item.id) === value,
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
			.executables.filter((item) => item.kind !== "task" && !item.id.includes("/process:"))
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
			states: Object.fromEntries(ids.map((id) => [id, this.getNodeState(id) ?? "resolved"])),
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
		const conflict = affected.map((node) => this.#nodeOperations.get(node)).find(Boolean);
		if (conflict) throw new Error(`WSRT_OPERATION_CONFLICT: operation ${conflict} is running`);
		const id = this.#submittedOperationIds.shift() ?? crypto.randomUUID(),
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
		await this.#persistOperation(operation);
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
				controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError");
			const diagnostic: SystemDiagnostic = {
				code: cancelled ? "WSRT_OPERATION_CANCELLED" : "WSRT_OPERATION_PARTIAL_FAILURE",
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
			await this.#persistOperation(operation);
			this.#operationControllers.delete(id);
			for (const node of affected)
				if (this.#nodeOperations.get(node) === id) this.#nodeOperations.delete(node);
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
		if (this.#persistence && !this.#disposed && !this.#snapshotTimer) {
			this.#snapshotTimer = setTimeout(() => {
				this.#snapshotTimer = undefined;
				void this.#persistSnapshot();
			}, 100);
			this.#snapshotTimer.unref?.();
		}
	}
	async #initializePersistence(): Promise<void> {
		const definition = required(this.#definition, "Control plane definition unavailable");
		const configured = definition.persistence;
		if (
			this.options.persistence === false ||
			(this.options.persistence === undefined && configured === false)
		)
			return;
		const sessionId = crypto.randomUUID();
		const provider =
			this.options.persistence ??
			filesystemPersistence({
				root: configured === false ? ".wsrt" : configured.root,
				journals: configured === false ? undefined : configured.journals,
			});
		try {
			await provider.initialize({ workspaceRoot: definition.root, sessionId });
			this.#persistence = provider;
			const existing =
				await provider.read<PersistedRecord<WorkspaceIdentity>>("workspace/identity");
			const existingIdentity = existing
				? this.#migrations.read<WorkspaceIdentity>(existing.value, "wsrt.workspace-identity")
				: undefined;
			const now = new Date().toISOString();
			const identity: WorkspaceIdentity = existingIdentity
				? { ...existingIdentity.data, root: definition.root }
				: { id: crypto.randomUUID(), createdAt: now, root: definition.root };
			this.#workspaceIdentity = identity;
			await provider.write(
				"workspace/identity",
				createRecord("wsrt.workspace-identity", identity, {
					workspaceId: identity.id,
					previous: existingIdentity,
				}),
			);
			for (const entry of await provider.list("session")) {
				try {
					const value = await provider.read<PersistedRecord<RuntimeSession>>(entry.key);
					if (!value) continue;
					const stored = this.#migrations.read<RuntimeSession>(value.value, "wsrt.runtime-session");
					if (stored.data.endedAt) continue;
					const interrupted = {
						...stored.data,
						endedAt: now,
						exitReason: "unknown" as const,
					};
					await provider.write(
						entry.key,
						createRecord("wsrt.runtime-session", interrupted, {
							workspaceId: identity.id,
							sessionId: interrupted.id,
							previous: stored,
						}),
					);
					this.#diagnostics.push({
						code: "WSRT_PREVIOUS_SESSION_INTERRUPTED",
						severity: "warning",
						message: `Previous session ${interrupted.id} did not shut down cleanly`,
						source: { file: definition.sourceFile, path: "persistence" },
					});
				} catch (cause) {
					this.#diagnostics.push({
						code: "WSRT_PERSISTED_SESSION_INVALID",
						severity: "warning",
						message: `Unable to recover ${entry.key}: ${
							cause instanceof Error ? cause.message : String(cause)
						}`,
						source: { file: definition.sourceFile, path: "persistence" },
					});
				}
			}
			this.#session = {
				id: sessionId,
				workspaceId: identity.id,
				startedAt: now,
				wsrtVersion: "0.1.0-alpha.0",
				host: { hostname: os.hostname(), platform: process.platform, arch: process.arch },
			};
			await provider.write(
				`session/${sessionId}`,
				createRecord("wsrt.runtime-session", this.#session, {
					workspaceId: identity.id,
					sessionId,
				}),
			);
		} catch (cause) {
			await provider.dispose().catch(() => {});
			this.#persistence = undefined;
			throw cause;
		}
	}
	async #persistSnapshot(): Promise<void> {
		if (!this.#persistence || !this.#workspaceIdentity || !this.#session || !this.#definition)
			return;
		try {
			const snapshot = JSON.parse(JSON.stringify(this.snapshot())) as ControlPlaneSnapshot;
			await this.#persistence.write(
				"snapshot/latest",
				createRecord("wsrt.control-plane-snapshot", snapshot, {
					workspaceId: this.#workspaceIdentity.id,
					sessionId: this.#session.id,
				}),
			);
		} catch (cause) {
			this.#recordPersistenceFailure(cause);
		}
	}
	async #persistOperation(operation: OperationSnapshot): Promise<void> {
		if (!this.#persistence || !this.#workspaceIdentity || !this.#session) return;
		try {
			await this.#persistence.write(
				`operation/${operation.id}`,
				createRecord("wsrt.operation", JSON.parse(JSON.stringify(operation)), {
					workspaceId: this.#workspaceIdentity.id,
					sessionId: this.#session.id,
				}),
			);
		} catch (cause) {
			this.#recordPersistenceFailure(cause);
		}
	}
	#persistEvent(event: WorkspaceEvent): void {
		if (!this.#persistence || !this.#workspaceIdentity || !this.#session) return;
		void this.#persistence
			.append(
				"journal/events",
				createRecord("wsrt.event", JSON.parse(JSON.stringify(event)), {
					workspaceId: this.#workspaceIdentity.id,
					sessionId: this.#session.id,
				}),
			)
			.catch((cause) => this.#recordPersistenceFailure(cause));
		if (event.type.startsWith("plugin.log."))
			void this.#persistence
				.append(
					"journal/logs",
					createRecord("wsrt.log", JSON.parse(JSON.stringify(event)), {
						workspaceId: this.#workspaceIdentity.id,
						sessionId: this.#session.id,
					}),
				)
				.catch((cause) => this.#recordPersistenceFailure(cause));
	}
	#recordPersistenceFailure(cause: unknown): void {
		if (this.#persistenceFailure) return;
		this.#persistenceFailure = cause;
		this.#diagnostics.push({
			code: "WSRT_PERSISTENCE_WRITE_FAILED",
			severity: "warning",
			message: cause instanceof Error ? cause.message : String(cause),
			source: { file: this.#definition?.sourceFile ?? "<persistence>", path: "persistence" },
		});
	}
	#assertMutable() {
		if (this.options.allowMutations === false)
			throw new Error("Mutating control-plane operations are disabled");
	}
}

function processShorthand(id: string): string | undefined {
	const match = /^application:([^/]+)\/process:(.+)$/.exec(id);
	return match ? `${match[1]}.${match[2]}` : undefined;
}

function required<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
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

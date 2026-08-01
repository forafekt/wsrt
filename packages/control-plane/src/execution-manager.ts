import type {
	ExecutionTelemetryEvent,
	ProcessHandle,
	ProviderInvocationContext,
	RuntimeInstance,
} from "@wsrt/capabilities";
import type { NormalizedExecutable, NormalizedSystemDefinition } from "@wsrt/config";
import type { PluginContext } from "@wsrt/plugins";
import type { ArtifactManager } from "./artifact-manager.js";
import type { ControlPlaneState } from "./control-plane-state.js";
import type { EventJournal } from "./event-journal.js";
import type { HealthManager } from "./health-manager.js";
import { required } from "./utils.js";

export interface ExecutionManagerOptions {
	readonly state: ControlPlaneState;
	readonly events: EventJournal;
	readonly health: HealthManager;
	readonly artifacts: ArtifactManager;
	readonly changed: () => void;
	readonly pluginContext: () => PluginContext;
	readonly restartNode: (id: string) => Promise<void>;
}

/**
 * Owns executable preparation, process supervision, readiness and provider
 * telemetry. Artifact and health state are delegated to their managers.
 */
export class ExecutionManager {
	constructor(private readonly options: ExecutionManagerOptions) {}

	handler(item: NormalizedExecutable) {
		return {
			start: ({ signal }: { signal: AbortSignal }) => this.start(item, signal),
			stop: () => this.stop(item),
			ready: ({ signal }: { signal: AbortSignal }) => this.ready(item, signal),
		};
	}

	async start(item: NormalizedExecutable, signal: AbortSignal): Promise<void> {
		const state = this.options.state;
		state.closedExecutions.delete(item.id);
		state.completedExecutions.delete(item.id);
		state.executionSignals.set(item.id, signal);

		let command = item.command;
		let completion: "process" | "exit" = "process";
		let providerEnvironment: Readonly<Record<string, string>> = {};

		if (item.provider) {
			const adapter = state.adapters.get(item.provider.provider);
			if (!adapter) {
				throw new Error(`Execution adapter not registered: ${item.provider.provider}`);
			}

			const validation = adapter.validate(item.provider.options ?? {});
			if (!validation.options || validation.diagnostics.length) {
				throw new Error(
					validation.diagnostics.join("\n") || `Invalid adapter options: ${item.provider.provider}`,
				);
			}

			const prepared = adapter.prepare(validation.options, {
				nodeId: item.id,
				workspaceRoot: this.definition().root,
				projectRoot: item.root,
				environment: item.environment,
			});

			completion = prepared.completion ?? "process";
			providerEnvironment = prepared.environment ?? {};
			state.executionMetadata.set(item.id, { ...(prepared.metadata ?? {}) });
			if (prepared.dispose) state.executionCleanup.set(item.id, prepared.dispose);

			command = {
				command: prepared.command,
				args: prepared.args,
				shell: prepared.shell ?? false,
			};
		}

		if (!command) return;

		const handle = this.runtime(item)
			.capabilities.require("spawn")
			.spawn({
				command: command.command,
				args: command.args,
				cwd: item.root,
				environment: {
					...item.environment,
					...providerEnvironment,
					WSRT_NODE_ID: item.id,
					WSRT_OPERATION_ID: this.operationId(item.id),
				},
				shell: command.shell,
				signal,
			});

		state.handles.set(item.id, handle);
		this.telemetry(item, {
			type: "execution.started",
			timestamp: new Date().toISOString(),
		});

		if (item.kind === "task" || completion === "exit") {
			try {
				if (item.kind === "task") {
					await this.options.artifacts.invalidateOutputs(item);
				}

				const exit = await handle.exit;
				if (exit.code !== 0) {
					if (item.kind === "task") {
						await this.options.artifacts.failOutputs(
							item,
							`Task ${item.name} exited with code ${exit.code}`,
						);
					}

					throw new Error(
						`${item.kind === "task" ? "Task" : "Process"} ${item.name} exited with code ${exit.code}`,
					);
				}

				await this.options.artifacts.awaitReported(item.id);
				await this.options.artifacts.collect(item, signal);

				if (item.kind === "task") {
					await this.options.artifacts.verifyOutputs(item);
				} else {
					state.completedExecutions.add(item.id);
				}
			} finally {
				state.closedExecutions.add(item.id);
				await this.cleanup(item.id);
			}
			return;
		}

		void handle.exit
			.then((exit) => this.processExited(item, handle, exit))
			.catch((cause) => {
				state.diagnostics.push({
					code: "WSRT_PROCESS_EXIT_SUPERVISION_FAILED",
					severity: "warning",
					message: cause instanceof Error ? cause.message : String(cause),
					source: item.source,
				});
			});
	}

	async stop(item: NormalizedExecutable): Promise<void> {
		const state = this.options.state;
		this.options.health.stopMonitor(item.id);
		const handle = state.handles.get(item.id);

		if (!handle) {
			state.handles.delete(item.id);
			state.closedExecutions.add(item.id);
			await this.cleanup(item.id);
			state.manualStops.delete(item.id);
			return;
		}

		await handle.terminateTree();
		state.handles.delete(item.id);
		state.closedExecutions.add(item.id);
		await this.cleanup(item.id);
	}

	async ready(item: NormalizedExecutable, signal: AbortSignal): Promise<void> {
		if (item.kind === "task") return;

		if (this.options.state.completedExecutions.has(item.id)) {
			this.options.health.set(item.id, "healthy");
			return;
		}

		const providerId = item.provider?.provider;
		const provider = providerId ? this.options.state.readinessProviders.get(providerId) : undefined;

		if (provider && providerId) {
			const validation = provider.validate(item.provider?.options ?? {});
			if (!validation.options || validation.diagnostics.length) {
				throw new Error(
					validation.diagnostics.join("\n") || `Invalid readiness options: ${providerId}`,
				);
			}

			await required(this.options.state.pluginSession, "Plugin session unavailable").invoke(
				"readiness",
				providerId,
				this.options.pluginContext(),
				() => provider.wait(validation.options, this.providerContext(item, providerId, signal)),
			);

			if (signal.aborted || !this.options.state.handles.get(item.id)?.running) {
				throw signal.reason ?? new Error(`Process ${item.name} exited before readiness`);
			}

			this.options.events.emit("node.readiness.succeeded", item.id, this.operationId(item.id), {
				provider: providerId,
			});
			this.startMonitor(item);
			return;
		}

		if (!item.healthcheck) {
			this.options.health.set(item.id, "healthy");
			return;
		}

		const health = item.healthcheck;
		if (health.type === "process") {
			if (!this.options.state.handles.get(item.id)?.running) {
				throw new Error(`Process ${item.name} is not running`);
			}
			this.startMonitor(item);
			return;
		}

		const timers = this.runtime(item).capabilities.require("timers");
		let last: unknown;
		for (let attempt = 0; attempt < (health.retries ?? 20); attempt += 1) {
			try {
				await this.checkHealth(item, signal);
				this.startMonitor(item);
				return;
			} catch (cause) {
				last = cause;
			}
			await timers.delay(health.intervalMs ?? 250, signal);
		}

		throw last ?? new Error(`Readiness failed for ${item.name}`);
	}

	providerContext(
		item: NormalizedExecutable,
		contributionId: string,
		signal: AbortSignal,
	): ProviderInvocationContext {
		const session = required(this.options.state.pluginSession, "Plugin session unavailable");
		const kind = this.options.state.readinessProviders.has(contributionId)
			? "readiness"
			: "artifacts";
		const pluginId = session.owner(kind, contributionId) ?? "unknown";

		return Object.freeze({
			pluginId,
			contributionId,
			nodeId: item.id,
			operationId: this.operationId(item.id),
			workspaceRoot: this.definition().root,
			projectRoot: item.root,
			runtimeProviderId: this.definition().runtimes[item.runtime].provider,
			environment: item.environment,
			process: this.options.state.handles.get(item.id),
			executionMetadata: Object.freeze({
				...(this.options.state.executionMetadata.get(item.id) ?? {}),
			}),
			signal,
			capabilities: this.runtime(item).capabilities,
			report: (event) => this.telemetry(item, event),
		});
	}

	telemetry(item: NormalizedExecutable, event: ExecutionTelemetryEvent): void {
		const state = this.options.state;
		if (
			state.disposed ||
			state.closedExecutions.has(item.id) ||
			state.executionSignals.get(item.id)?.aborted
		) {
			return;
		}

		const operationId = this.operationId(item.id);
		if (event.type === "diagnostic") {
			state.diagnostics.push({ ...event.diagnostic, source: item.source });
		} else if (event.type === "server.listening") {
			state.executionMetadata.set(item.id, {
				...(state.executionMetadata.get(item.id) ?? {}),
				host: event.host,
				port: event.port,
				urls: event.urls,
			});
		} else if (event.type === "readiness.available") {
			state.executionMetadata.set(item.id, {
				...(state.executionMetadata.get(item.id) ?? {}),
				readiness: event.details ?? true,
			});
		} else if (event.type === "artifact.discovered") {
			this.options.artifacts.ingestReported(item, event.artifact);
		}

		this.options.events.emit(`provider.${event.type}`, item.id, operationId, event);
	}

	async cleanup(nodeId: string): Promise<void> {
		const state = this.options.state;
		const cleanup = state.executionCleanup.get(nodeId);
		state.executionCleanup.delete(nodeId);
		state.executionMetadata.delete(nodeId);
		state.executionSignals.delete(nodeId);
		state.telemetryIngestion.delete(nodeId);
		if (!cleanup) return;

		try {
			await cleanup();
		} catch (cause) {
			state.diagnostics.push({
				code: "WSRT_EXECUTION_CLEANUP_FAILED",
				severity: "warning",
				message: cause instanceof Error ? cause.message : String(cause),
				source: {
					file: state.definition?.sourceFile ?? "<execution>",
					path: nodeId,
				},
			});
		}
	}

	private startMonitor(item: NormalizedExecutable): void {
		this.options.health.startMonitor(item, (signal) => this.checkHealth(item, signal));
	}

	private async checkHealth(item: NormalizedExecutable, signal: AbortSignal): Promise<void> {
		const health = item.healthcheck;
		if (!health || health.type === "process") {
			if (!this.options.state.handles.get(item.id)?.running) {
				throw new Error("Process exited");
			}
			return;
		}

		if (health.type === "tcp") {
			await this.runtime(item)
				.capabilities.require("network")
				.connect(health.host ?? "127.0.0.1", health.port, {
					timeoutMs: health.timeoutMs ?? 2000,
					signal,
				});
			return;
		}

		const timeout = AbortSignal.timeout(health.timeoutMs ?? 2000);
		const response = await this.runtime(item)
			.capabilities.require("http")
			.fetch(health.url, { signal: AbortSignal.any([signal, timeout]) });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
	}

	private async processExited(
		item: NormalizedExecutable,
		handle: ProcessHandle,
		exit: { code: number | null; signal: string | null },
	): Promise<void> {
		const state = this.options.state;
		if (state.handles.get(item.id) !== handle) return;

		await handle.terminateTree({ graceMs: 0 });
		state.handles.delete(item.id);
		state.closedExecutions.add(item.id);
		await this.cleanup(item.id);
		this.options.health.stopMonitor(item.id);

		const manual = state.manualStops.has(item.id);
		const expected = manual || state.disposed || state.engine?.state(item.id) === "stopping";
		const previous = this.details(item.id);
		const correlationId = crypto.randomUUID();

		state.healthDetails.set(item.id, {
			...previous,
			exit: {
				...exit,
				timestamp: new Date().toISOString(),
				expected,
				duringManualStop: manual,
			},
		});

		try {
			state.engine?.processExited(item.id, expected, correlationId);
		} catch {}

		this.options.health.set(item.id, expected ? "unknown" : "unhealthy");
		this.options.events.emit(
			expected ? "node.process.exited" : "node.process.unexpected-exit",
			item.id,
			correlationId,
			{ ...exit, expected },
		);

		if (expected) {
			state.manualStops.delete(item.id);
			return;
		}

		if (
			item.restart.policy !== "never" &&
			!(item.restart.policy === "on-failure" && exit.code === 0 && !exit.signal)
		) {
			try {
				await this.options.restartNode(item.id);
			} catch (cause) {
				state.diagnostics.push({
					code: "WSRT_PROCESS_RESTART_FAILED",
					severity: "warning",
					message: cause instanceof Error ? cause.message : String(cause),
					source: item.source,
				});
			}
		}
	}

	private runtime(item: NormalizedExecutable): RuntimeInstance {
		return required(
			this.options.state.runtimes.get(this.definition().runtimes[item.runtime].provider),
			`Runtime unavailable: ${item.runtime}`,
		);
	}

	private definition(): NormalizedSystemDefinition {
		return required(this.options.state.definition, "Control plane is not loaded");
	}

	private operationId(nodeId: string): string {
		return this.options.state.nodeOperations.get(nodeId) ?? nodeId;
	}

	private details(id: string) {
		return (
			this.options.state.healthDetails.get(id) ?? {
				restartCount: 0,
				consecutiveSuccesses: 0,
				consecutiveFailures: 0,
				restartPending: false,
				currentRestartAttempt: 0,
			}
		);
	}
}

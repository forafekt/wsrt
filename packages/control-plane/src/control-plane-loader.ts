import { compileSystemGraph, loadSystemDefinition, type NormalizedExecutable } from "@wsrt/config";
import { LifecycleEngine, type LifecycleHandler } from "@wsrt/lifecycle";
import { type PluginContext, PluginSession, resolveWorkspacePluginsReport } from "@wsrt/plugins";
import { NodeRuntimeProvider } from "@wsrt/runtime-node";
import type { ControlPlaneState } from "./control-plane-state.js";
import type { EventJournal } from "./event-journal.js";
import type { PersistenceManager } from "./persistence-manager.js";
import type { ControlPlaneOptions } from "./types.js";

export class ControlPlaneLoader {
	constructor(
		private readonly state: ControlPlaneState,
		private readonly options: ControlPlaneOptions,
		private readonly persistence: PersistenceManager,
		private readonly events: EventJournal,
		private readonly pluginContext: () => PluginContext,
		private readonly initializeArtifacts: (
			definition: NonNullable<ControlPlaneState["definition"]>,
		) => void,
		private readonly handlerFor: (item: NormalizedExecutable) => LifecycleHandler,
		private readonly awaitHealthy: (id: string, signal: AbortSignal) => Promise<void>,
	) {}

	async load() {
		const loaded = await loadSystemDefinition(this.options.root, this.options.config);
		this.state.diagnostics = [...loaded.diagnostics];

		if (!loaded.definition) {
			throw new Error(this.state.diagnostics.map((item) => item.message).join("\n"));
		}

		this.state.definition = loaded.definition;
		this.initializeArtifacts(loaded.definition);

		await this.persistence.initialize();

		const report = this.options.pluginSession
			? { plugins: this.options.pluginSession.list(), diagnostics: [] }
			: await resolveWorkspacePluginsReport(loaded.definition.plugins, loaded.definition.root);

		if (report.diagnostics.length) {
			throw new Error(report.diagnostics.map((item) => item.message).join("\n"));
		}

		this.state.pluginSession = this.options.pluginSession ?? new PluginSession(report.plugins);

		await this.state.pluginSession.runStage("discover", this.pluginContext());
		for (const contribution of this.state.pluginSession.contributions("configuration")) {
			const reference = loaded.definition.plugins.find(
				(item) =>
					typeof item !== "string" && "provider" in item && item.provider === contribution.id,
			);
			for (const diagnostic of contribution.validate(
				typeof reference === "object" && "options" in reference ? reference.options : undefined,
			))
				this.state.diagnostics.push({
					code: diagnostic.code,
					severity: diagnostic.severity,
					message: diagnostic.message,
					source: {
						file: loaded.definition.sourceFile,
						path: diagnostic.plugin ? `plugins.${diagnostic.plugin}` : "plugins",
					},
				});
		}
		if (this.state.diagnostics.some((item) => item.severity === "error"))
			throw new Error(this.state.diagnostics.map((item) => item.message).join("\n"));
		await this.state.pluginSession.runStage("configure", this.pluginContext());

		for (const contribution of this.state.pluginSession.contributions("workspace")) {
			await contribution.compile(this.pluginContext());
		}

		await this.state.pluginSession.runStage("workspace", this.pluginContext());

		this.state.graph = compileSystemGraph(loaded.definition);

		for (const contribution of this.state.pluginSession.contributions("graph")) {
			await contribution.contribute(this.state.graph, this.pluginContext());
		}

		await this.state.pluginSession.runStage("graph", this.pluginContext());
		for (const issue of this.state.graph.validate())
			this.state.diagnostics.push({
				code: `graph.${issue.code}`,
				severity: "error",
				message: issue.message,
				source: {
					file: loaded.definition.sourceFile,
					path: issue.path.join("."),
				},
			});
		if (this.state.diagnostics.some((item) => item.severity === "error"))
			throw new Error(this.state.diagnostics.map((item) => item.message).join("\n"));

		for (const plugin of this.state.pluginSession.list()) {
			for (const adapter of plugin.contributions?.adapters ?? []) {
				this.state.adapters.set(adapter.id, adapter);
			}
		}

		for (const provider of this.state.pluginSession.contributions("readiness")) {
			this.state.readinessProviders.set(provider.id, provider);
		}

		for (const provider of this.state.pluginSession.contributions("artifacts")) {
			this.state.artifactProviders.set(provider.id, provider);
		}

		await this.state.pluginSession.runStage("providers", this.pluginContext());

		const providers = this.options.providers ?? [
			new NodeRuntimeProvider(),
			...this.state.pluginSession.contributions("runtimes"),
		];

		this.state.providerIds = providers.map((provider) => provider.id).sort();

		for (const runtime of Object.values(loaded.definition.runtimes)) {
			if (this.state.runtimes.has(runtime.provider)) {
				continue;
			}

			const provider = providers.find((item) => item.id === runtime.provider);
			if (!provider) throw new Error(`Runtime provider not registered: ${runtime.provider}`);

			this.state.runtimes.set(runtime.provider, await provider.create());
		}

		this.state.engine = new LifecycleEngine(this.state.graph, {
			onEvent: (event) =>
				this.events.emit(event.type, event.source, event.correlationId, event.payload),
			awaitHealthy: this.awaitHealthy,
		});

		for (const executable of loaded.definition.executables) {
			this.state.engine.register(executable.id, this.handlerFor(executable));
		}

		await this.state.pluginSession.runStage("runtime", this.pluginContext());
		return loaded.definition;
	}
}

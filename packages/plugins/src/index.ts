import type {
	ArtifactProvider,
	ExecutionAdapter,
	ReadinessProvider,
	RuntimeProvider,
} from "@wsrt/capabilities";

export type PluginIdentity = { readonly id: string; readonly version: string };

export type PluginCapability =
	| "runtime-provider"
	| "execution-provider"
	| "readiness-provider"
	| "artifact-provider"
	| "workspace-provider"
	| "graph"
	| "cli"
	| "configuration"
	| "diagnostics"
	| "dashboard"
	| "mcp"
	| "completion";

export type PluginDependency =
	| string
	| {
			readonly id: string;
			readonly minVersion?: string;
			readonly maxVersion?: string;
	  };

export type PluginMetadata = PluginIdentity & {
	readonly name?: string;
	readonly description?: string;
	readonly capabilities?: readonly PluginCapability[];
	readonly requires?: readonly PluginDependency[];
	readonly optional?: readonly PluginDependency[];
	readonly incompatible?: readonly PluginDependency[];
};

export type ContributionDiagnostic = {
	readonly code: string;
	readonly severity: "info" | "warning" | "error";
	readonly message: string;
	readonly plugin?: string;
	readonly contributionId?: string;
	readonly contributionKind?: keyof PluginContributions;
	readonly lifecycleStage?: string;
	readonly detail?: Readonly<Record<string, unknown>>;
};

export type ValidationResult<T> =
	| {
			readonly value: T;
			readonly diagnostics?: readonly ContributionDiagnostic[];
	  }
	| { readonly diagnostics: readonly ContributionDiagnostic[] };

export type PluginLogger = {
	debug?(message: string, attributes?: Readonly<Record<string, unknown>>): void;
	info(message: string, attributes?: Readonly<Record<string, unknown>>): void;
	warn(message: string, attributes?: Readonly<Record<string, unknown>>): void;
	error(message: string, attributes?: Readonly<Record<string, unknown>>): void;
};

export type PluginContext = {
	readonly root: string;
	readonly configuration: unknown;
	readonly logger: PluginLogger;
	readonly diagnostics: { add(value: ContributionDiagnostic): void };
	readonly events: { emit(type: string, payload: unknown): void };
	readonly services: Readonly<Record<string, unknown>>;
};

export type PluginLifecycleStage =
	| "discover"
	| "configure"
	| "workspace"
	| "graph"
	| "providers"
	| "runtime"
	| "shutdown";

export type PluginLifecycle = Partial<
	Record<PluginLifecycleStage, (context: PluginContext) => void | Promise<void>>
>;

export interface ExecutableHandle<TResult = unknown> {
	readonly result?: TResult;
	wait?(): Promise<void>;
	close(): Promise<void>;
}

export type ExecutableContext = {
	readonly controlPlane: unknown;
	readonly signal: AbortSignal;
	readonly arguments: readonly string[];
	readonly logger: Pick<PluginLogger, "info" | "warn" | "error">;
};

export interface ExecutableContribution<TOptions = unknown, TResult = unknown> {
	readonly id: string;
	readonly description?: string;
	readonly owner: PluginIdentity;
	validateOptions?(input: unknown): ValidationResult<TOptions>;
	execute(
		context: ExecutableContext,
		options: TOptions,
	): Promise<ExecutableHandle<TResult> | TResult>;
}

export type CliContribution = {
	readonly id: string;
	readonly path: string;
	readonly description: string;
	readonly owner: PluginIdentity;
	run(context: PluginContext, args: readonly string[]): unknown | Promise<unknown>;
};

export type WorkspaceContribution = {
	readonly id: string;
	compile(context: PluginContext): unknown | Promise<unknown>;
};

export type GraphContribution = {
	readonly id: string;
	contribute(graph: unknown, context: PluginContext): void | Promise<void>;
};

export type ConfigurationContribution = {
	readonly id: string;
	validate(value: unknown): readonly ContributionDiagnostic[];
};

export type DashboardContribution = {
	readonly id: string;
	readonly kind:
		| "page"
		| "widget"
		| "panel"
		| "action"
		| "command"
		| "inspector"
		| "badge"
		| "graph-decoration"
		| "diagnostic-renderer"
		| "artifact-action"
		| "operation-action"
		| "event-renderer"
		| "metric-panel"
		| "status-item"
		| "navigation";
	readonly title?: string;
	readonly description?: string;
	readonly target?: string;
	readonly group?: string;
	readonly order?: number;
	readonly refreshMs?: number;
	readonly mutation?: boolean;
	load?(context: PluginContext, signal: AbortSignal): unknown | Promise<unknown>;
	run?(input: unknown, context: PluginContext, signal: AbortSignal): unknown | Promise<unknown>;
};

export type McpContribution = {
	readonly id: string;
	readonly kind: "tool" | "resource" | "prompt";
	readonly description?: string;
	readonly mutation?: boolean;
	validate?(input: unknown): readonly ContributionDiagnostic[];
	run(input: unknown, context: PluginContext, signal: AbortSignal): unknown | Promise<unknown>;
};

export type CompletionContribution = {
	readonly id: string;
	complete(input: string, context: PluginContext): readonly string[] | Promise<readonly string[]>;
};

export type PluginContributions = {
	runtimes?: readonly RuntimeProvider[];
	adapters?: readonly ExecutionAdapter[];
	readiness?: readonly ReadinessProvider[];
	artifacts?: readonly ArtifactProvider[];
	diagnostics?: readonly ContributionDiagnostic[];
	cli?: readonly CliContribution[];
	workspace?: readonly WorkspaceContribution[];
	graph?: readonly GraphContribution[];
	configuration?: readonly ConfigurationContribution[];
	dashboard?: readonly DashboardContribution[];
	mcp?: readonly McpContribution[];
	completion?: readonly CompletionContribution[];
	executables?: readonly ExecutableContribution[];
};

export interface WsrtPlugin extends PluginMetadata {
	readonly contributions?: PluginContributions;
	readonly lifecycle?: PluginLifecycle;
	dispose?(): void | Promise<void>;
}

export function definePlugin<const Plugin extends WsrtPlugin>(plugin: Plugin): Plugin {
	return Object.freeze(plugin);
}

const contributionCapability: Partial<Record<keyof PluginContributions, PluginCapability>> = {
	runtimes: "runtime-provider",
	adapters: "execution-provider",
	readiness: "readiness-provider",
	artifacts: "artifact-provider",
	workspace: "workspace-provider",
	graph: "graph",
	cli: "cli",
	configuration: "configuration",
	diagnostics: "diagnostics",
	dashboard: "dashboard",
	mcp: "mcp",
	completion: "completion",
};

export function orderPlugins(plugins: readonly WsrtPlugin[]): readonly WsrtPlugin[] {
	validatePluginSet(plugins);
	const result: WsrtPlugin[] = [];
	const remaining = new Map(plugins.map((plugin) => [plugin.id, plugin]));
	while (remaining.size) {
		const ready = [...remaining.values()]
			.filter((plugin) =>
				dependencies(plugin.requires).every((dependency) =>
					result.some((item) => item.id === dependency.id),
				),
			)
			.sort((a, b) => a.id.localeCompare(b.id));
		if (!ready.length)
			throw new PluginResolutionError(
				"plugin.dependency_cycle",
				`Plugin dependency cycle: ${[...remaining.keys()].sort().join(", ")}`,
			);
		for (const plugin of ready) {
			result.push(plugin);
			remaining.delete(plugin.id);
		}
	}
	return Object.freeze(result);
}

export type PluginState =
	| "discovered"
	| "configured"
	| "compiled"
	| "registered"
	| "running"
	| "failed"
	| "disposed";

export type ContributionOperationalStatus =
	| "operational"
	| "declarative"
	| "experimental"
	| "inactive";

export type ContributionSnapshot = {
	readonly id: string;
	readonly kind: keyof PluginContributions;
	readonly status: ContributionOperationalStatus;
	readonly registered: boolean;
	readonly activeInvocations: number;
	readonly lastInvokedAt?: string;
	readonly lastFailure?: string;
};

export type PluginSnapshot = PluginMetadata & {
	readonly state: PluginState;
	readonly registrations: Readonly<Record<string, readonly string[]>>;
	readonly diagnostics: readonly ContributionDiagnostic[];
	readonly contributions: readonly ContributionSnapshot[];
};

export class PluginSession {
	readonly #plugins: readonly WsrtPlugin[];
	readonly #states = new Map<string, PluginState>();
	readonly #diagnostics: ContributionDiagnostic[] = [];
	readonly #invocations = new Map<
		string,
		{ active: number; lastInvokedAt?: string; lastFailure?: string }
	>();
	#disposed = false;
	constructor(plugins: readonly WsrtPlugin[]) {
		this.#plugins = orderPlugins(plugins);
		assertUniqueContributions(this.#plugins);
		for (const plugin of this.#plugins) this.#states.set(plugin.id, "discovered");
	}
	list(): readonly WsrtPlugin[] {
		return this.#plugins;
	}
	executables(): readonly ExecutableContribution[] {
		return Object.freeze(
			this.#plugins.flatMap((plugin) => [...(plugin.contributions?.executables ?? [])]),
		);
	}
	executable(id: string): ExecutableContribution | undefined {
		return this.executables().find((item) => item.id === id);
	}
	contributions<Kind extends keyof PluginContributions>(
		kind: Kind,
	): readonly NonNullable<PluginContributions[Kind]>[number][] {
		return Object.freeze(
			this.#plugins.flatMap((plugin) => [
				...((plugin.contributions?.[kind] ?? []) as readonly NonNullable<
					PluginContributions[Kind]
				>[number][]),
			]),
		);
	}
	owner(kind: keyof PluginContributions, id: string): string | undefined {
		return this.#plugins.find((plugin) =>
			(plugin.contributions?.[kind] as readonly { id?: string }[] | undefined)?.some(
				(item) => item.id === id,
			),
		)?.id;
	}
	async invoke<T>(
		kind: keyof PluginContributions,
		id: string,
		context: PluginContext,
		run: (context: PluginContext) => T | Promise<T>,
	): Promise<T> {
		if (this.#disposed)
			throw new Error("WSRT_PLUGIN_INVOCATION_DISPOSED: Plugin session is disposed");
		const plugin = this.owner(kind, id);
		if (!plugin) throw new Error(`Unknown ${kind} contribution: ${id}`);
		const key = `${kind}:${id}`;
		const state = this.#invocations.get(key) ?? { active: 0 };
		state.active++;
		state.lastInvokedAt = new Date().toISOString();
		this.#invocations.set(key, state);
		try {
			return await run(scopedContext(context, plugin, this.#diagnostics));
		} catch (cause) {
			state.lastFailure = cause instanceof Error ? cause.message : String(cause);
			const diagnostic: ContributionDiagnostic = {
				code: "plugin.contribution_failed",
				severity: "error",
				message: `${kind} contribution ${id} failed: ${state.lastFailure}`,
				plugin,
				contributionId: id,
				contributionKind: kind,
			};
			this.#diagnostics.push(diagnostic);
			context.diagnostics.add(diagnostic);
			throw cause;
		} finally {
			state.active--;
		}
	}
	async initialize(context: PluginContext): Promise<void> {
		for (const stage of [
			"discover",
			"configure",
			"workspace",
			"graph",
			"providers",
			"runtime",
		] as const)
			await this.runStage(stage, context);
	}
	async runStage(
		stage: Exclude<PluginLifecycleStage, "shutdown">,
		context: PluginContext,
	): Promise<void> {
		for (const plugin of this.#plugins) {
			try {
				await plugin.lifecycle?.[stage]?.(scopedContext(context, plugin.id, this.#diagnostics));
				this.#states.set(plugin.id, stageState(stage));
			} catch (cause) {
				this.#states.set(plugin.id, "failed");
				const diagnostic = failureDiagnostic(plugin.id, stage, cause);
				this.#diagnostics.push(diagnostic);
				context.diagnostics.add(diagnostic);
				throw new PluginLifecycleError(plugin.id, stage, cause);
			}
		}
	}
	snapshots(): readonly PluginSnapshot[] {
		return Object.freeze(
			this.#plugins.map((plugin) =>
				Object.freeze({
					...metadata(plugin),
					capabilities: Object.freeze(inferredCapabilities(plugin)),
					state: this.#states.get(plugin.id) ?? "discovered",
					registrations: Object.freeze(registrations(plugin)),
					diagnostics: Object.freeze(this.#diagnostics.filter((item) => item.plugin === plugin.id)),
					contributions: Object.freeze(contributionSnapshots(plugin, this.#invocations)),
				}),
			),
		);
	}
	async dispose(context?: PluginContext): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		const errors: unknown[] = [];
		for (const plugin of [...this.#plugins].reverse()) {
			try {
				if (context)
					await plugin.lifecycle?.shutdown?.(scopedContext(context, plugin.id, this.#diagnostics));
				await plugin.dispose?.();
				this.#states.set(plugin.id, "disposed");
			} catch (cause) {
				this.#states.set(plugin.id, "failed");
				const diagnostic = failureDiagnostic(plugin.id, "shutdown", cause);
				this.#diagnostics.push(diagnostic);
				context?.diagnostics.add(diagnostic);
				errors.push(new PluginLifecycleError(plugin.id, "shutdown", cause));
			}
		}
		if (errors.length) throw new AggregateError(errors, "Plugin disposal failed");
	}
}

export class PluginResolutionError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "PluginResolutionError";
	}
}

export class PluginLifecycleError extends Error {
	constructor(
		readonly plugin: string,
		readonly stage: PluginLifecycleStage,
		cause: unknown,
	) {
		super(
			`Plugin ${plugin} failed during ${stage}: ${cause instanceof Error ? cause.message : String(cause)}`,
			{ cause },
		);
		this.name = "PluginLifecycleError";
	}
}

function validatePluginSet(plugins: readonly WsrtPlugin[]): void {
	const duplicates = duplicateIds(plugins.map((plugin) => plugin.id));
	if (duplicates.length)
		throw new PluginResolutionError(
			"plugin.duplicate",
			`Duplicate plugin ID: ${duplicates.join(", ")}`,
		);
	const available = new Map(plugins.map((plugin) => [plugin.id, plugin]));
	for (const plugin of plugins) {
		if (!plugin.id || !plugin.version)
			throw new PluginResolutionError(
				"plugin.metadata_invalid",
				"Plugins require an id and version",
			);
		for (const dependency of dependencies(plugin.requires))
			validateDependency(plugin, dependency, available, true);
		for (const dependency of dependencies(plugin.optional))
			if (available.has(dependency.id)) validateDependency(plugin, dependency, available, false);
		for (const dependency of dependencies(plugin.incompatible))
			if (
				available.has(dependency.id) &&
				versionMatches(available.get(dependency.id)?.version ?? "0.0.0", dependency)
			)
				throw new PluginResolutionError(
					"plugin.incompatible",
					`Plugin ${plugin.id} is incompatible with ${dependency.id} ${available.get(dependency.id)?.version}`,
				);
	}
}

function validateDependency(
	plugin: WsrtPlugin,
	dependency: Exclude<PluginDependency, string>,
	available: Map<string, WsrtPlugin>,
	required: boolean,
): void {
	const target = available.get(dependency.id);
	if (!target) {
		if (required)
			throw new PluginResolutionError(
				"plugin.dependency_missing",
				`Plugin ${plugin.id} requires missing plugin ${dependency.id}`,
			);
		return;
	}
	if (!versionMatches(target.version, dependency))
		throw new PluginResolutionError(
			"plugin.version_mismatch",
			`Plugin ${plugin.id} requires ${dependency.id}${dependency.minVersion ? ` >=${dependency.minVersion}` : ""}${dependency.maxVersion ? ` <=${dependency.maxVersion}` : ""}; found ${target.version}`,
		);
}

function versionMatches(version: string, dependency: Exclude<PluginDependency, string>): boolean {
	return (
		(!dependency.minVersion || compareVersions(version, dependency.minVersion) >= 0) &&
		(!dependency.maxVersion || compareVersions(version, dependency.maxVersion) <= 0)
	);
}

function compareVersions(a: string, b: string): number {
	const left = versionParts(a),
		right = versionParts(b);
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference) return difference;
	}
	return 0;
}

function versionParts(value: string): number[] {
	const match = value.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
	if (!match)
		throw new PluginResolutionError("plugin.version_invalid", `Invalid plugin version: ${value}`);
	return match.slice(1).map((item) => Number(item ?? 0));
}

function dependencies(
	values?: readonly PluginDependency[],
): Array<Exclude<PluginDependency, string>> {
	return (values ?? []).map((value) => (typeof value === "string" ? { id: value } : value));
}

function inferredCapabilities(plugin: WsrtPlugin): PluginCapability[] {
	const values = new Set(plugin.capabilities ?? []);
	for (const [kind, items] of Object.entries(plugin.contributions ?? {}))
		if (Array.isArray(items) && items.length) {
			const capability = contributionCapability[kind as keyof PluginContributions];
			if (capability) values.add(capability);
		}
	return [...values].sort();
}

function registrations(plugin: WsrtPlugin): Record<string, readonly string[]> {
	return Object.fromEntries(
		Object.entries(plugin.contributions ?? {})
			.filter(([, value]) => Array.isArray(value) && value.length)
			.map(([kind, values]) => [
				kind,
				Object.freeze(
					(values as readonly { id?: string }[]).map((value) => value.id ?? "anonymous").sort(),
				),
			]),
	);
}

function contributionSnapshots(
	plugin: WsrtPlugin,
	invocations: Map<string, { active: number; lastInvokedAt?: string; lastFailure?: string }>,
): ContributionSnapshot[] {
	const operational = new Set<keyof PluginContributions>([
		"runtimes",
		"adapters",
		"readiness",
		"artifacts",
		"cli",
		"workspace",
		"graph",
		"configuration",
		"dashboard",
		"mcp",
		"completion",
		"executables",
	]);
	return Object.entries(plugin.contributions ?? {}).flatMap(([kind, values]) =>
		Array.isArray(values)
			? (values as readonly { id?: string }[]).map((value) => {
					const id = value.id ?? "anonymous";
					const invocation = invocations.get(`${kind}:${id}`);
					return Object.freeze({
						id,
						kind: kind as keyof PluginContributions,
						status: (kind === "diagnostics"
							? "declarative"
							: operational.has(kind as keyof PluginContributions)
								? "operational"
								: "inactive") as ContributionOperationalStatus,
						registered: true,
						activeInvocations: invocation?.active ?? 0,
						lastInvokedAt: invocation?.lastInvokedAt,
						lastFailure: invocation?.lastFailure,
					});
				})
			: [],
	);
}

function metadata(plugin: WsrtPlugin): PluginMetadata {
	return {
		id: plugin.id,
		name: plugin.name,
		version: plugin.version,
		description: plugin.description,
		requires: plugin.requires,
		optional: plugin.optional,
		incompatible: plugin.incompatible,
	};
}

function stageState(stage: Exclude<PluginLifecycleStage, "shutdown">): PluginState {
	if (stage === "discover") return "discovered";
	if (stage === "configure") return "configured";
	if (stage === "workspace" || stage === "graph") return "compiled";
	if (stage === "providers") return "registered";
	return "running";
}

function scopedContext(
	context: PluginContext,
	plugin: string,
	diagnostics: ContributionDiagnostic[],
): PluginContext {
	return Object.freeze({
		...context,
		diagnostics: {
			add(value) {
				const item = { ...value, plugin: value.plugin ?? plugin };
				diagnostics.push(item);
				context.diagnostics.add(item);
			},
		},
	});
}

function failureDiagnostic(
	plugin: string,
	stage: PluginLifecycleStage,
	cause: unknown,
): ContributionDiagnostic {
	return {
		code: "plugin.lifecycle_failed",
		severity: "error",
		plugin,
		message: `Plugin ${plugin} failed during ${stage}: ${cause instanceof Error ? cause.message : String(cause)}`,
		detail: { stage },
	};
}

function assertUniqueContributions(plugins: readonly WsrtPlugin[]): void {
	const seen = new Map<string, string>();
	for (const plugin of plugins)
		for (const [kind, values] of Object.entries(plugin.contributions ?? {}))
			if (Array.isArray(values))
				for (const value of values) {
					const id =
						value && typeof value === "object" && "id" in value ? String(value.id) : undefined;
					if (!id) continue;
					if (
						(kind === "executables" || kind === "cli") &&
						(!(value as { owner?: PluginIdentity }).owner?.id ||
							(value as { owner?: PluginIdentity }).owner?.id !== plugin.id)
					)
						throw new PluginResolutionError(
							"plugin.owner_invalid",
							`${kind} contribution ${id} has missing or incorrect owner; expected ${plugin.id}`,
						);
					const key = `${kind}:${id}`,
						owner = seen.get(key);
					if (owner)
						throw new PluginResolutionError(
							"plugin.contribution_duplicate",
							`Duplicate ${kind} contribution ${id} from ${plugin.id}; already owned by ${owner}`,
						);
					seen.set(key, plugin.id);
				}
}

function duplicateIds(ids: readonly string[]): string[] {
	return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

export {
	type PluginLoadReport,
	type PluginReference,
	resolveWorkspacePlugins,
	resolveWorkspacePluginsReport,
} from "./resolver.js";

import type {
	ArtifactProvider,
	ExecutionAdapter,
	ReadinessProvider,
	RuntimeProvider,
} from "@wsrt/capabilities";
export type PluginIdentity = { readonly id: string; readonly version: string };
export type ContributionDiagnostic = {
	readonly code: string;
	readonly severity: "info" | "warning" | "error";
	readonly message: string;
};
export type ValidationResult<T> =
	| {
			readonly value: T;
			readonly diagnostics?: readonly ContributionDiagnostic[];
	  }
	| { readonly diagnostics: readonly ContributionDiagnostic[] };
export interface ExecutableHandle<TResult = unknown> {
	readonly result?: TResult;
	wait?(): Promise<void>;
	close(): Promise<void>;
}
export type ExecutableContext = {
	readonly controlPlane: unknown;
	readonly signal: AbortSignal;
	/** Lossless arguments owned by the contributed tool, in original order. */
	readonly arguments: readonly string[];
	readonly logger: {
		info(message: string): void;
		warn(message: string): void;
		error(message: string): void;
	};
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
export type PluginContributions = {
	runtimes?: readonly RuntimeProvider[];
	adapters?: readonly ExecutionAdapter[];
	readiness?: readonly ReadinessProvider[];
	artifacts?: readonly ArtifactProvider[];
	diagnostics?: readonly unknown[];
	cli?: readonly { id: string; run: unknown }[];
	mcp?: readonly { id: string; run: unknown }[];
	executables?: readonly ExecutableContribution[];
};
export interface WsrtPlugin {
	readonly id: string;
	readonly version: string;
	readonly requires?: readonly string[];
	readonly optional?: readonly string[];
	readonly contributions?: PluginContributions;
	dispose?(): void | Promise<void>;
}
export function orderPlugins(
	plugins: readonly WsrtPlugin[],
): readonly WsrtPlugin[] {
	const duplicates = duplicateIds(plugins.map((plugin) => plugin.id));
	if (duplicates.length)
		throw new Error(`Duplicate plugin ID: ${duplicates.join(", ")}`);
	const result: WsrtPlugin[] = [],
		remaining = new Map(plugins.map((plugin) => [plugin.id, plugin]));
	for (const plugin of plugins)
		for (const dependency of plugin.requires ?? [])
			if (!remaining.has(dependency))
				throw new Error(
					`Plugin ${plugin.id} requires missing plugin ${dependency}`,
				);
	while (remaining.size) {
		const ready = [...remaining.values()]
			.filter((plugin) =>
				(plugin.requires ?? []).every((name) =>
					result.some((item) => item.id === name),
				),
			)
			.sort((a, b) => a.id.localeCompare(b.id));
		if (!ready.length)
			throw new Error(
				`Plugin dependency cycle: ${[...remaining.keys()].sort().join(", ")}`,
			);
		for (const plugin of ready) {
			result.push(plugin);
			remaining.delete(plugin.id);
		}
	}
	return Object.freeze(result);
}
export class PluginSession {
	readonly #plugins: readonly WsrtPlugin[];
	constructor(plugins: readonly WsrtPlugin[]) {
		this.#plugins = orderPlugins(plugins);
		assertUniqueContributions(this.#plugins);
	}
	list(): readonly WsrtPlugin[] {
		return this.#plugins;
	}
	executables(): readonly ExecutableContribution[] {
		return Object.freeze(
			this.#plugins.flatMap((plugin) => [
				...(plugin.contributions?.executables ?? []),
			]),
		);
	}
	executable(id: string): ExecutableContribution | undefined {
		return this.executables().find((item) => item.id === id);
	}
	async dispose(): Promise<void> {
		const errors: unknown[] = [];
		for (const plugin of [...this.#plugins].reverse())
			try {
				await plugin.dispose?.();
			} catch (cause) {
				errors.push(cause);
			}
		if (errors.length)
			throw new AggregateError(errors, "Plugin disposal failed");
	}
}
function assertUniqueContributions(plugins: readonly WsrtPlugin[]): void {
	const seen = new Map<string, string>();
	for (const plugin of plugins)
		for (const [kind, values] of Object.entries(plugin.contributions ?? {}))
			if (Array.isArray(values))
				for (const value of values) {
					const id =
						value && typeof value === "object" && "id" in value
							? String(value.id)
							: undefined;
					if (!id) continue;
					if (
						kind === "executables" &&
						(!(value as ExecutableContribution).owner?.id ||
							(value as ExecutableContribution).owner.id !== plugin.id)
					)
						throw new Error(
							`Executable contribution ${id} has missing or incorrect owner; expected ${plugin.id}`,
						);
					const key = `${kind}:${id}`,
						owner = seen.get(key);
					if (owner)
						throw new Error(
							`Duplicate ${kind} contribution ${id} from ${plugin.id}; already owned by ${owner}`,
						);
					seen.set(key, plugin.id);
				}
}
function duplicateIds(ids: readonly string[]): string[] {
	return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

export { type PluginReference, resolveWorkspacePlugins } from "./resolver.js";

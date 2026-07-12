import type {
	ArtifactProvider,
	ExecutionAdapter,
	ReadinessProvider,
	RuntimeProvider,
} from "@wsrt/capabilities";
export type PluginContributions = {
	runtimes?: readonly RuntimeProvider[];
	adapters?: readonly ExecutionAdapter[];
	readiness?: readonly ReadinessProvider[];
	artifacts?: readonly ArtifactProvider[];
	diagnostics?: readonly unknown[];
	cli?: readonly { id: string; run: unknown }[];
	mcp?: readonly { id: string; run: unknown }[];
	dashboard?: readonly { id: string; title: string }[];
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

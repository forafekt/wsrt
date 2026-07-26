import { viteAdapter } from "./adapter.js";

export { createViteAdapter, viteAdapter } from "./adapter.js";

export { mergeAliases, workspaceAliasEntries } from "./aliases.js";

export { createViteBridge } from "./bridge.js";

export { composeViteConfig } from "./config.js";

export { default, default as vite } from "./plugin.js";

export type {
	AliasPrecedence,
	ViteAdapterOptions,
	ViteBridge,
	VitePluginOptions,
} from "./types.js";

/** Compatibility helper for the pre-plugin-system configuration shape. */
export function viteContribution(options: import("./types.js").ViteAdapterOptions = {}) {
	const prepared = viteAdapter.prepare(options);
	return {
		name: "vite" as const,
		provider: { provider: "vite" as const, options },
		command: {
			command: prepared.command,
			args: [...prepared.args],
			shell: false as const,
		},
		healthcheck:
			options.command === "build"
				? undefined
				: {
						type: "http" as const,
						url: `http://${options.host ?? "127.0.0.1"}:${options.port ?? 5173}`,
					},
	};
}

export function hasWsrtVitePlugin(plugins: unknown): boolean {
	const flatten = (value: unknown): unknown[] =>
		Array.isArray(value) ? value.flatMap(flatten) : value ? [value] : [];
	return flatten(plugins).some(
		(plugin) =>
			!!plugin &&
			typeof plugin === "object" &&
			(("name" in plugin && (plugin as { name?: unknown }).name === "wsrt:workspace") ||
				("id" in plugin && (plugin as { id?: unknown }).id === "@wsrt/plugin-vite")),
	);
}

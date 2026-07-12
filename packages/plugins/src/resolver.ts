import path from "node:path";
import { pathToFileURL } from "node:url";
import type { WsrtPlugin } from "./index.js";

export type PluginReference = string | { provider: string; options?: unknown };

export async function resolveWorkspacePlugins(
	references: readonly PluginReference[],
	workspaceRoot: string,
): Promise<readonly WsrtPlugin[]> {
	const parent = pathToFileURL(path.join(workspaceRoot, "package.json")).href;
	const plugins: WsrtPlugin[] = [];
	for (const reference of references) {
		const packageName =
			typeof reference === "string" ? reference : reference.provider;
		const options =
			typeof reference === "string" ? undefined : reference.options;
		let url: string;
		try {
			url = import.meta.resolve(packageName, parent);
		} catch (cause) {
			throw new Error(
				`WSRT_PLUGIN_PACKAGE_NOT_FOUND: Plugin package "${packageName}" could not be resolved from "${workspaceRoot}".\n\nInstall it with:\n\n  pnpm add -D ${packageName}`,
				{ cause },
			);
		}
		try {
			const module = await import(url);
			const factory = module.default ?? module.plugin;
			const plugin =
				typeof factory === "function" ? await factory(options) : factory;
			if (!plugin || typeof plugin !== "object" || !plugin.id)
				throw new Error("default export did not produce a WSRT plugin");
			plugins.push(plugin as WsrtPlugin);
		} catch (cause) {
			throw new Error(
				`WSRT_PLUGIN_LOAD_FAILED: Plugin package "${packageName}" failed to load: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause },
			);
		}
	}
	return Object.freeze(plugins);
}

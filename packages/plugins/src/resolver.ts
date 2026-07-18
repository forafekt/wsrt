import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { WsrtPlugin } from "./index.js";

export type PluginReference =
	| string
	| { provider: string; options?: unknown }
	| WsrtPlugin;
export type PluginLoadReport = {
	plugins: readonly WsrtPlugin[];
	diagnostics: readonly {
		code: string;
		severity: "error";
		message: string;
		plugin: string;
	}[];
};

export async function resolveWorkspacePluginsReport(
	references: readonly PluginReference[],
	workspaceRoot: string,
): Promise<PluginLoadReport> {
	const plugins: WsrtPlugin[] = [],
		diagnostics: Array<{
			code: string;
			severity: "error";
			message: string;
			plugin: string;
		}> = [];
	for (const reference of references) {
		const plugin =
			typeof reference === "string"
				? reference
				: "id" in reference
					? reference.id
					: reference.provider;
		try {
			plugins.push(
				...(await resolveWorkspacePlugins([reference], workspaceRoot)),
			);
		} catch (cause) {
			diagnostics.push({
				code:
					cause instanceof Error &&
					cause.message.startsWith("WSRT_PLUGIN_PACKAGE_NOT_FOUND")
						? "plugin.not_found"
						: "plugin.load_failed",
				severity: "error",
				plugin,
				message: cause instanceof Error ? cause.message : String(cause),
			});
		}
	}
	return {
		plugins: Object.freeze(plugins),
		diagnostics: Object.freeze(diagnostics),
	};
}

export async function resolveWorkspacePlugins(
	references: readonly PluginReference[],
	workspaceRoot: string,
): Promise<readonly WsrtPlugin[]> {
	const parent = pathToFileURL(path.join(workspaceRoot, "package.json")).href;
	const plugins: WsrtPlugin[] = [];
	for (const reference of references) {
		if (typeof reference === "object" && "id" in reference) {
			plugins.push(reference);
			continue;
		}
		const packageName =
			typeof reference === "string" ? reference : reference.provider;
		const options =
			typeof reference === "string" ? undefined : reference.options;
		let url: string;
		try {
			url = packageName.startsWith("file:")
				? packageName
				: path.isAbsolute(packageName)
					? pathToFileURL(packageName).href
					: packageName.startsWith(".")
						? pathToFileURL(
								path.resolve(path.dirname(fileURLToPath(parent)), packageName),
							).href
						: import.meta.resolve(packageName, parent);
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

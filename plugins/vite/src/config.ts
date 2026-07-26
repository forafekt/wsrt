import path from "node:path";
import type { ConfigEnv, UserConfig, UserConfigExport } from "vite";
import { loadConfigFromFile, mergeConfig } from "vite";
import { mergeAliases } from "./aliases.js";
import { createViteBridge } from "./bridge.js";
import type { VitePluginOptions } from "./types.js";
import { wsrt } from "./vite.js";

export async function composeViteConfig(
	options: VitePluginOptions & {
		workspaceRoot: string;
		projectRoot?: string;
		configFile?: string | false;
		env?: ConfigEnv;
	},
): Promise<{
	config: UserConfig;
	bridge: Awaited<ReturnType<typeof createViteBridge>>;
	configFile?: string;
}> {
	const bridge = await createViteBridge(options);
	const env = options.env ?? {
		command: "serve",
		mode: "development",
		isSsrBuild: false,
		isPreview: false,
	};
	const loaded =
		options.configFile === false
			? null
			: await loadConfigFromFile(env, options.configFile, bridge.projectRoot);
	const user = loaded?.config ?? {};
	const aliases = mergeAliases(user.resolve?.alias, bridge.aliases, options.aliasPrecedence);
	const plugins = hasNativePlugin(user.plugins)
		? user.plugins
		: [...(user.plugins ?? []), wsrt({ ...options, bridge })];
	const contribution: UserConfig = {
		root: bridge.projectRoot,
		resolve: { alias: aliases },
		plugins,
	};
	return {
		config: mergeConfig(user, contribution),
		bridge,
		configFile: loaded?.path,
	};
}

function hasNativePlugin(plugins: UserConfig["plugins"]): boolean {
	return flatten(plugins).some(
		(item) => item && typeof item === "object" && "name" in item && item.name === "wsrt:workspace",
	);
}

function flatten(value: unknown): unknown[] {
	return Array.isArray(value) ? value.flatMap(flatten) : value ? [value] : [];
}

export async function resolveUserConfig(
	value: UserConfigExport,
	env: ConfigEnv,
): Promise<UserConfig> {
	return typeof value === "function" ? await value(env) : await value;
}

export function projectRoot(workspaceRoot: string, project?: string): string {
	return path.resolve(workspaceRoot, project ?? ".");
}

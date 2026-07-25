import { randomInt } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExecutionAdapter, ExecutionAdapterContext } from "@wsrt/capabilities";
import { createOwnedExecutionState, removeOwnedExecutionState } from "./telemetry.js";
import type { ViteAdapterOptions, VitePluginOptions } from "./types.js";

export const viteAdapter = createViteAdapter();

export function createViteAdapter(
	pluginOptions: VitePluginOptions = {},
): ExecutionAdapter<ViteAdapterOptions> {
	return {
		id: "vite",
		validate(input) {
			if (input && typeof input !== "object")
				return { diagnostics: ["Vite adapter options must be an object"] };
			const options = (input ?? {}) as ViteAdapterOptions;
			return {
				options,
				diagnostics:
					options.command && !["dev", "build", "preview"].includes(options.command)
						? [`Unsupported Vite command: ${options.command}`]
						: [],
			};
		},
		prepare(options, context) {
			const args = [options.command ?? "dev", ...(options.args ?? [])];
			if (options.host) args.push("--host", options.host);
			const selectedPort = options.port === 0 ? randomInt(30_000, 60_000) : options.port;
			if (selectedPort !== undefined) args.push("--port", String(selectedPort));
			if (selectedPort !== undefined && options.strictPort !== false) args.push("--strictPort");
			const executionState = createOwnedExecutionState();
			const configState = context
				? createConfigWrapper(options, pluginOptions, context)
				: undefined;
			const wrapper = configState?.file ?? options.configFile;
			if (wrapper) args.push("--config", wrapper);
			return {
				command: process.execPath,
				args: [viteExecutable(context?.projectRoot), ...args],
				shell: false,
				completion: options.command === "build" ? "exit" : "process",
				environment: {
					WSRT_EXECUTION_TELEMETRY: executionState.telemetryFile,
					WSRT_EXECUTION_ID: executionState.executionId,
					WSRT_VITE_REPORT: "1",
					...(context
						? {
								WSRT_WORKSPACE_ROOT: context.workspaceRoot,
								WSRT_PROJECT_ROOT: context.projectRoot,
							}
						: {}),
				},
				metadata: { executionState },
				dispose: async () => {
					await removeOwnedExecutionState(executionState);
					if (configState)
						await fs.promises.rm(configState.directory, { recursive: true, force: true });
				},
			};
		},
	};
}

function viteExecutable(projectRoot?: string): string {
	let require = createRequire(import.meta.url);
	if (projectRoot)
		try {
			const consumer = createRequire(path.join(projectRoot, "package.json"));
			consumer.resolve("vite");
			require = consumer;
		} catch {}
	return path.resolve(path.dirname(require.resolve("vite")), "../../bin/vite.js");
}

function createConfigWrapper(
	options: ViteAdapterOptions,
	pluginOptions: VitePluginOptions,
	context: ExecutionAdapterContext,
): { directory: string; file: string } {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wsrt-vite-config-"));
	const configured = options.configFile
		? path.resolve(context.projectRoot, options.configFile)
		: findViteConfig(context.projectRoot);
	const wrapper = path.join(directory, "vite.config.mjs");
	const nativePlugin = new URL("./vite.js", import.meta.url).href;
	const userImport = configured
		? `import userExport from ${JSON.stringify(pathToFileURL(configured).href)};`
		: "const userExport = {};";
	fs.writeFileSync(
		wrapper,
		`${userImport}
import { wsrt } from ${JSON.stringify(nativePlugin)};
const pluginOptions = ${JSON.stringify(pluginOptions)};
export default async (env) => {
	const user = typeof userExport === "function" ? await userExport(env) : await userExport;
	return { ...user, plugins: [...(user.plugins || []), wsrt(pluginOptions)] };
};
`,
	);
	return { directory, file: wrapper };
}

function findViteConfig(root: string): string | undefined {
	for (const name of [
		"vite.config.ts",
		"vite.config.mts",
		"vite.config.js",
		"vite.config.mjs",
		"vite.config.cts",
		"vite.config.cjs",
	]) {
		const file = path.join(root, name);
		if (fs.existsSync(file)) return file;
	}
}

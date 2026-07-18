import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	definePlugin,
	type ExecutableContribution,
	type WsrtPlugin,
} from "@wsrt/plugins";
import { viteAdapter } from "./adapter.js";
import type { VitePluginOptions } from "./types.js";

const owner = { id: "@wsrt/plugin-vite", version: "0.1.0" } as const;
export default function vite(options: VitePluginOptions = {}): WsrtPlugin {
	const executable: ExecutableContribution<Record<string, unknown>> = {
		id: "vite",
		owner,
		description: "Run the installed Vite CLI with WSRT workspace context",
		async execute(context) {
			const plane = context.controlPlane as { definition(): { root: string } };
			const workspaceRoot = plane.definition().root;
			const cwd = path.resolve(workspaceRoot, options.project ?? ".");
			const runtime = await import("@wsrt/runtime-node");
			const instance = await new runtime.NodeRuntimeProvider().create();
			const configured = takeConfigArgument(context.arguments, cwd);
			const discovered = configured.file ?? (await findViteConfig(cwd));
			const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "wsrt-vite-"));
			const wrapper = path.join(temporary, "vite.config.mjs");
			const nativePlugin = new URL("./vite.js", import.meta.url).href;
			const userImport = discovered
				? `import userExport from ${JSON.stringify(pathToFileURL(discovered).href)};`
				: "const userExport = {};";
			await fs.writeFile(
				wrapper,
				`${userImport}\nimport { wsrt } from ${JSON.stringify(nativePlugin)};\nexport default async (env) => { const user = typeof userExport === 'function' ? await userExport(env) : await userExport; return { ...user, plugins: [...(user.plugins || []), wsrt(${JSON.stringify(options)})] }; };\n`,
			);
			const args = [...configured.args, "--config", wrapper];
			const handle = instance.capabilities.require("spawn").spawn({
				command: "vite",
				args: args.length > 2 ? args : ["dev", ...args],
				cwd,
				environment: {
					WSRT_WORKSPACE_ROOT: workspaceRoot,
					WSRT_PROJECT_ROOT: cwd,
					WSRT_VITE_REPORT: "1",
				},
				signal: context.signal,
			});
			return {
				wait: async () => {
					const exit = await handle.exit;
					if (exit.code && !context.signal.aborted)
						throw new Error(`Vite exited with code ${exit.code}`);
				},
				close: async () => {
					handle.terminate();
					await handle.exit;
					await instance.dispose();
					await fs.rm(temporary, { recursive: true, force: true });
				},
			};
		},
	};
	return definePlugin({
		id: owner.id,
		name: "Vite",
		version: owner.version,
		description: "Vite execution, configuration, and workspace integration",
		capabilities: ["execution-provider", "workspace-provider"],
		contributions: { adapters: [viteAdapter], executables: [executable] },
	});
}

function takeConfigArgument(
	args: readonly string[],
	cwd: string,
): { args: string[]; file?: string } {
	const result = [...(args.length ? args : ["dev"])];
	for (let index = 0; index < result.length; index++) {
		if (result[index] !== "--config" && result[index] !== "-c") continue;
		const value = result[index + 1];
		if (!value) return { args: result };
		result.splice(index, 2);
		return { args: result, file: path.resolve(cwd, value) };
	}
	return { args: result };
}
async function findViteConfig(root: string): Promise<string | undefined> {
	for (const name of [
		"vite.config.ts",
		"vite.config.mts",
		"vite.config.js",
		"vite.config.mjs",
		"vite.config.cts",
		"vite.config.cjs",
	]) {
		const file = path.join(root, name);
		try {
			await fs.access(file);
			return file;
		} catch {}
	}
}

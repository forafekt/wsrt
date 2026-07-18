import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtifactProvider, ReadinessProvider } from "@wsrt/capabilities";
import {
	definePlugin,
	type ExecutableContribution,
	type WsrtPlugin,
} from "@wsrt/plugins";
import { viteAdapter } from "./adapter.js";
import type { ViteAdapterOptions, VitePluginOptions } from "./types.js";

const owner = { id: "@wsrt/plugin-vite", version: "0.1.0" } as const;
export default function vite(options: VitePluginOptions = {}): WsrtPlugin {
	const readiness: ReadinessProvider<ViteAdapterOptions> = {
		id: "vite",
		validate: (input) => ({
			options: isRecord(input) ? (input as ViteAdapterOptions) : {},
			diagnostics: [],
		}),
		async wait(_input, context) {
			if (context.signal.aborted) throw context.signal.reason;
			if (!context.process?.running)
				throw new Error(`Vite process for ${context.nodeId} is not running`);
			const telemetryFile = context.executionMetadata.telemetryFile;
			if (typeof telemetryFile !== "string") return;
			const deadline = Date.now() + 30_000;
			try {
				while (Date.now() < deadline) {
					if (context.signal.aborted) throw context.signal.reason;
					if (!context.process.running)
						throw new Error("Vite exited before reporting readiness");
					try {
						const contents = await fs.readFile(telemetryFile, "utf8");
						for (const line of contents.split("\n").filter(Boolean)) {
							const record = JSON.parse(line) as {
								version?: number;
								event?: unknown;
							};
							if (record.version !== 1 || !isTelemetryEvent(record.event))
								continue;
							context.report(record.event);
							if (record.event.type === "server.listening") return;
						}
					} catch (cause) {
						if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
					}
					await context.capabilities
						.require("timers")
						.delay(50, context.signal);
				}
				throw new Error("Timed out waiting for structured Vite readiness");
			} finally {
				await fs.rm(telemetryFile, { force: true }).catch(() => {});
			}
		},
	};
	const artifacts: ArtifactProvider<ViteAdapterOptions> = {
		id: "vite",
		async collect(input, context) {
			if (input.command !== "build") return [];
			const telemetryFile = context.executionMetadata.telemetryFile;
			if (typeof telemetryFile === "string") {
				try {
					const contents = await fs.readFile(telemetryFile, "utf8");
					for (const line of contents.split("\n").filter(Boolean)) {
						const record = JSON.parse(line) as {
							version?: number;
							event?: unknown;
						};
						if (record.version === 1 && isTelemetryEvent(record.event))
							context.report(record.event);
					}
				} finally {
					await fs.rm(telemetryFile, { force: true }).catch(() => {});
				}
			}
			const outputRoot = path.resolve(
				context.projectRoot,
				argumentValue(input.args ?? [], "--outDir") ?? "dist",
			);
			const files = await walkFiles(outputRoot, context.signal);
			return files.map((file) => ({
				name: `vite-${path.relative(outputRoot, file).replaceAll(path.sep, "-")}`,
				path: path.relative(context.projectRoot, file),
				kind: "file",
				outputGroup: "vite-build",
				metadata: { provider: "vite" },
			}));
		},
	};
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
		capabilities: [
			"execution-provider",
			"readiness-provider",
			"artifact-provider",
			"workspace-provider",
			"dashboard",
		],
		contributions: {
			adapters: [viteAdapter],
			readiness: [readiness],
			artifacts: [artifacts],
			executables: [executable],
			dashboard: [
				{
					id: "vite-status",
					kind: "widget",
					title: "Vite",
					load: () => ({
						kind: "status",
						state: "configured",
						message: "Vite provider is active",
					}),
				},
			],
		},
	});
}

async function walkFiles(root: string, signal: AbortSignal): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await fs.readdir(root, { withFileTypes: true })) {
		if (signal.aborted) throw signal.reason;
		const file = path.join(root, entry.name);
		if (entry.isDirectory()) result.push(...(await walkFiles(file, signal)));
		else if (entry.isFile()) result.push(file);
	}
	return result.sort();
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
function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function argumentValue(
	args: readonly string[],
	name: string,
): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}
function isTelemetryEvent(
	value: unknown,
): value is import("@wsrt/capabilities").ExecutionTelemetryEvent {
	return (
		isRecord(value) &&
		[
			"server.listening",
			"readiness.available",
			"artifact.discovered",
			"diagnostic",
			"custom",
		].includes(String(value.type))
	);
}
